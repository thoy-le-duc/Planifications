import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T09b — se déconnecter depuis l'appli (téléphone partagé).
 *
 * Contrat (fonction : src/connexion/deconnexion.test.ts) :
 *   - connecté (session dans localStorage), l'appli montre un bouton « Se déconnecter »
 *     (cible d'au moins 48 px, comme les autres) ;
 *   - un tap : POST {API}/auth/deconnexion { jetonRenouvellement } (sans Authorization), session
 *     effacée (localStorage `planif.session`), base locale de l'utilisateur effacée
 *     (effacerDonneesLocales, chargée à la demande : PowerSync hors du JavaScript de
 *     démarrage), puis retour à l'écran de connexion ; au rechargement, on y reste ;
 *   - hors ligne (appli servie par le service worker, API et PowerSync injoignables), pareil :
 *     on rend le téléphone sans réseau ;
 *   - aucune violation de la CSP pendant tout cela (PowerSync compris, s'il est chargé).
 *
 * Relecture sécurité — base ouverte dans un autre onglet (contrat : deconnexion.test.ts) :
 *   - l'effacement échoue (autre onglet) : session effacée, retour à l'écran de connexion,
 *     marqueur `planif.effacement-en-attente` rangé, et une alerte (role="alert") dit
 *     « Fermez les autres onglets de Planifications ; l'effacement se terminera tout seul. » ;
 *   - l'effacement est retenté au démarrage et sur l'écran de connexion (5 s au plus entre deux
 *     essais) jusqu'à réussite : l'autre onglet fermé, la base disparaît, le marqueur et
 *     l'alerte aussi, sans rien toucher.
 *   Ici, l'« autre onglet » est une seconde page du même contexte qui garde la base IndexedDB
 *   de l'utilisateur ouverte (sans céder à versionchange), comme le ferait PowerSync.
 *
 * 2e relecture sécurité :
 *   - À corriger 1 — confirmation : si une base locale de l'utilisateur existe
 *     (`planif-<id>.sqlite` dans indexedDB.databases()), un tap sur « Se déconnecter » montre
 *     d'abord une confirmation (data-testid="confirmation-deconnexion", comme la page de
 *     diagnostic) qui contient « Des saisies pas encore envoyées pourraient être perdues. »,
 *     avec deux boutons d'au moins 48 px : « Se déconnecter quand même » et « Annuler ».
 *     Annuler : rien ne change (ni appel à l'API, ni session, ni base). Sans base locale : pas
 *     de confirmation ;
 *   - B2 — l'effacement en attente ne touche jamais l'utilisateur connecté : déconnexion avec
 *     un autre onglet ouvert, reconnexion du même compte, saisie, fermeture de l'autre onglet →
 *     la base et la saisie existent toujours, y compris après un redémarrage de l'appli ; après
 *     la reconnexion, aucune nouvelle demande deleteDatabase pour cet utilisateur, et l'alerte
 *     « Fermez les autres onglets… » disparaît ;
 *   - B2 — sur l'écran de connexion, la reprise n'empile pas de nouvelle demande deleteDatabase
 *     tant que la précédente est en file (une demande abandonnée reste en file dans IndexedDB).
 *   Les appels à indexedDB.deleteDatabase sont notés par un script d'initialisation (clé
 *   localStorage `e2e.suppressions`, partagée par les pages et gardée au rechargement).
 *
 * 3e relecture — déconnexion dans un autre onglet (contrat : src/connexion/autre-onglet.test.ts) :
 *   deux pages du même contexte, connectées au même compte. La page A se déconnecte : la page B,
 *   sans rechargement, montre l'écran de connexion (champ « Adresse e-mail ») et plus le bouton
 *   « Se déconnecter » ni l'adresse du compte. Un autre compte rangé par la page A fait de même
 *   dans la page B ; des jetons tournés (même compte) ne la déconnectent pas.
 *
 * L'API est simulée (page.route), comme dans connexion.e2e.ts.
 *
 * T16 — adapté à l'habillage : « Se déconnecter » est sur l'écran Ferme (maquette « Ferme »),
 * atteint par la barre de navigation basse (« Navigation principale », onglet « Ferme »).
 * `ouvrirConnecte` et `allerFerme` y mènent avant chaque tap sur « Se déconnecter » ; « l'appli
 * est connectée » se lit à la barre de navigation (présente connecté, absente sur l'écran de
 * connexion) au lieu du bouton. Ce que vérifient les tests ne change pas.
 */

const CIBLE_MIN_PX = 48;
/** Effacer la base locale peut charger PowerSync (WASM) : on laisse le temps. */
const DELAI_EFFACEMENT_MS = 15_000;

const SESSION = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

// Le service worker intercepterait les requêtes avant page.route.
test.use({ serviceWorkers: 'block' });

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });

/** T16 : écran Ferme, qui porte « Se déconnecter ». */
async function allerFerme(page: Page): Promise<void> {
  await navigation(page).locator('button').filter({ hasText: 'Ferme' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ferme' })).toBeVisible();
}

/** Appli connectée (session rangée), sur l'écran Ferme. */
async function ouvrirConnecte(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(([cle, valeur]) => {
    localStorage.setItem(cle, valeur);
  }, [CLE_SESSION, JSON.stringify(SESSION)] as const);
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
  await allerFerme(page);
}

function sessionRangee(page: Page): Promise<string | null> {
  return page.evaluate((cle) => localStorage.getItem(cle), CLE_SESSION);
}

const CLE_EFFACEMENT_EN_ATTENTE = 'planif.effacement-en-attente';
const MESSAGE_AUTRE_ONGLET = /Fermez les autres onglets de Planifications ; l['’]effacement se terminera tout seul\./;
/** Blocage de 10 s par essai (DELAI_BASE_OUVERTE_MS), puis nouvel essai : on laisse large. */
const DELAI_REPRISE_MS = 40_000;

function nomBase(utilisateurId: string): string {
  return `planif-${utilisateurId}.sqlite`;
}

function marqueur(page: Page): Promise<string | null> {
  return page.evaluate((cle) => localStorage.getItem(cle), CLE_EFFACEMENT_EN_ATTENTE);
}

async function basesIndexedDb(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((b) => b.name ?? ''));
}

/** Crée la base IndexedDB `nom` ; la garde ouverte (sans céder à versionchange) si `garder`. */
async function creerBase(page: Page, nom: string, garder: boolean): Promise<void> {
  await page.evaluate(
    ([n, g]) =>
      new Promise<void>((ok, echec) => {
        const requete = indexedDB.open(n, 1);
        requete.onupgradeneeded = () => {
          requete.result.createObjectStore('blocs');
        };
        requete.onsuccess = () => {
          if (g) (window as unknown as { __baseGardee?: IDBDatabase }).__baseGardee = requete.result;
          else requete.result.close();
          ok();
        };
        requete.onerror = () => {
          echec(requete.error ?? new Error('ouverture impossible'));
        };
      }),
    [nom, garder] as const,
  );
}

const confirmation = (page: Page) => page.getByTestId('confirmation-deconnexion');
const MESSAGE_GENERIQUE = 'Des saisies pas encore envoyées pourraient être perdues.';

/** Confirmation affichée (message générique, deux cibles d'au moins 48 px) : « quand même ». */
async function confirmerDeconnexion(page: Page): Promise<void> {
  await expect(confirmation(page)).toBeVisible();
  await expect(confirmation(page)).toContainText(MESSAGE_GENERIQUE);
  await confirmation(page).getByRole('button', { name: 'Se déconnecter quand même' }).click();
}

const CLE_SUPPRESSIONS = 'e2e.suppressions';

/** Note chaque appel à indexedDB.deleteDatabase dans localStorage (toutes les pages du contexte). */
async function noterSuppressions(context: BrowserContext): Promise<void> {
  await context.addInitScript((cle) => {
    const origine = indexedDB.deleteDatabase.bind(indexedDB);
    indexedDB.deleteDatabase = (nom: string) => {
      const notees = JSON.parse(localStorage.getItem(cle) ?? '[]') as string[];
      notees.push(nom);
      localStorage.setItem(cle, JSON.stringify(notees));
      return origine(nom);
    };
  }, CLE_SUPPRESSIONS);
}

async function suppressions(page: Page, nom: string): Promise<number> {
  const notees = await page.evaluate((cle) => JSON.parse(localStorage.getItem(cle) ?? '[]') as string[], CLE_SUPPRESSIONS);
  return notees.filter((n) => n === nom).length;
}

/** Écrit un témoin dans la base `nom` (créée si besoin), puis la ferme. Attend si la base est bloquée. */
async function saisir(page: Page, nom: string): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((ok, echec) => {
        const requete = indexedDB.open(n);
        requete.onupgradeneeded = () => {
          if (!requete.result.objectStoreNames.contains('blocs')) requete.result.createObjectStore('blocs');
        };
        requete.onsuccess = () => {
          const base = requete.result;
          const tx = base.transaction('blocs', 'readwrite');
          tx.objectStore('blocs').put({ quantite: 99.5 }, 'temoin');
          tx.oncomplete = () => {
            base.close();
            ok();
          };
          tx.onerror = () => {
            echec(tx.error ?? new Error('écriture impossible'));
          };
        };
        requete.onerror = () => {
          echec(requete.error ?? new Error('ouverture impossible'));
        };
      }),
    nom,
  );
}

/** Le témoin est-il lisible dans la base `nom` ? (Sans la créer si elle n'existe plus.) */
async function temoinPresent(page: Page, nom: string): Promise<boolean> {
  if (!(await basesIndexedDb(page)).includes(nom)) return false;
  return page.evaluate(
    (n) =>
      new Promise<boolean>((ok) => {
        const requete = indexedDB.open(n);
        requete.onsuccess = () => {
          const base = requete.result;
          if (!base.objectStoreNames.contains('blocs')) {
            base.close();
            ok(false);
            return;
          }
          const lecture = base.transaction('blocs', 'readonly').objectStore('blocs').get('temoin');
          lecture.onsuccess = () => {
            base.close();
            ok((lecture.result as { quantite?: number } | undefined)?.quantite === 99.5);
          };
          lecture.onerror = () => {
            base.close();
            ok(false);
          };
        };
        requete.onerror = () => {
          ok(false);
        };
      }),
    nom,
  );
}

test('se déconnecter : jeton révoqué auprès de l’API, session effacée, retour à l’écran de connexion', async ({ page }) => {
  const requetes: { corps: unknown; autorisation: string | undefined }[] = [];
  await page.route('**/auth/deconnexion', async (route) => {
    requetes.push({ corps: route.request().postDataJSON(), autorisation: route.request().headers().authorization });
    await route.fulfill({ status: 204 });
  });
  const violations = await surveillerCsp(page);
  await ouvrirConnecte(page);

  const bouton = page.getByRole('button', { name: /se déconnecter/i });
  await expect(bouton).toBeVisible();
  const boite = await bouton.boundingBox();
  expect(boite?.height ?? 0).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
  expect(boite?.width ?? 0).toBeGreaterThanOrEqual(CIBLE_MIN_PX);

  await bouton.click();
  await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: DELAI_EFFACEMENT_MS });
  // Pas de base locale : pas de confirmation (2e relecture sécurité).
  await expect(page.getByTestId('confirmation-deconnexion')).toHaveCount(0);
  expect(requetes).toEqual([{ corps: { jetonRenouvellement: SESSION.jetonRenouvellement }, autorisation: undefined }]);
  expect(await sessionRangee(page)).toBeNull();

  await page.reload();
  await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /se déconnecter/i })).toHaveCount(0);
  expect(await violations()).toEqual([]);
});

test.describe('hors ligne, appli servie par le service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  // Au champ, sans réseau : l'appli vient du service worker, l'API et les fichiers hors
  // précache (PowerSync : assets/sqlite/) sont injoignables. La déconnexion doit aboutir quand
  // même (effacer la base locale sans télécharger PowerSync, ou avec ce qui est en cache).
  test('se déconnecter hors ligne : session effacée, retour à l’écran de connexion', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.evaluate(([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    }, [CLE_SESSION, JSON.stringify(SESSION)] as const);

    await context.setOffline(true);
    await page.reload();
    await allerFerme(page);
    await page.getByRole('button', { name: /se déconnecter/i }).click();
    await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: DELAI_EFFACEMENT_MS });
    expect(await sessionRangee(page)).toBeNull();
  });
});

test.describe('base ouverte dans un autre onglet (relecture sécurité)', () => {
  test('effacement en attente : message, puis effacement terminé tout seul quand l’autre onglet se ferme', async ({ page, context }) => {
    test.setTimeout(150_000);
    await page.route('**/auth/deconnexion', (route) => route.fulfill({ status: 204 }));

    const autreOnglet = await context.newPage();
    await autreOnglet.goto('/');
    await creerBase(autreOnglet, nomBase(SESSION.utilisateurId), true);

    await ouvrirConnecte(page);
    // Adapté (2e relecture sécurité, À corriger 1) : la base existe, la confirmation vient d'abord.
    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await confirmerDeconnexion(page);
    await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: DELAI_REPRISE_MS });
    const alerte = page.getByRole('alert').filter({ hasText: MESSAGE_AUTRE_ONGLET });
    await expect(alerte).toBeVisible({ timeout: DELAI_REPRISE_MS });
    expect(await sessionRangee(page)).toBeNull();
    expect(JSON.parse((await marqueur(page)) ?? '[]')).toEqual([SESSION.utilisateurId]);

    // Redémarrage pendant que l'autre onglet garde la base : toujours en attente, toujours dit.
    await page.reload();
    await expect(alerte).toBeVisible({ timeout: DELAI_REPRISE_MS });
    expect(await marqueur(page)).not.toBeNull();

    // L'autre onglet se ferme : l'effacement se termine sans rien toucher.
    await autreOnglet.close();
    await expect(alerte).toBeHidden({ timeout: DELAI_REPRISE_MS });
    expect(await marqueur(page)).toBeNull();
    expect(await basesIndexedDb(page)).not.toContain(nomBase(SESSION.utilisateurId));
  });

  test('au démarrage, un effacement resté en attente est repris et terminé', async ({ page }) => {
    const autre = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b99';
    await page.goto('/');
    await creerBase(page, nomBase(autre), false);
    await page.evaluate(([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    }, [CLE_EFFACEMENT_EN_ATTENTE, JSON.stringify([autre])] as const);
    expect(await basesIndexedDb(page)).toContain(nomBase(autre));

    await page.reload();
    await expect.poll(() => marqueur(page), { timeout: DELAI_REPRISE_MS }).toBeNull();
    expect(await basesIndexedDb(page)).not.toContain(nomBase(autre));
    await expect(page.getByRole('alert').filter({ hasText: MESSAGE_AUTRE_ONGLET })).toHaveCount(0);
  });
});

test.describe('confirmation avant de se déconnecter (2e relecture sécurité, À corriger 1)', () => {
  test('base locale présente : confirmation générique ; Annuler ne change rien ; « quand même » déconnecte et efface', async ({ page }) => {
    const requetes: unknown[] = [];
    await page.route('**/auth/deconnexion', async (route) => {
      requetes.push(route.request().postDataJSON());
      await route.fulfill({ status: 204 });
    });
    await ouvrirConnecte(page);
    await creerBase(page, nomBase(SESSION.utilisateurId), false);

    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await expect(confirmation(page)).toBeVisible();
    await expect(confirmation(page)).toContainText(MESSAGE_GENERIQUE);
    const quandMeme = confirmation(page).getByRole('button', { name: 'Se déconnecter quand même' });
    const annuler = confirmation(page).getByRole('button', { name: 'Annuler' });
    for (const bouton of [quandMeme, annuler]) {
      const boite = await bouton.boundingBox();
      expect(boite?.height ?? 0).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
      expect(boite?.width ?? 0).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
    }

    await annuler.click();
    await expect(confirmation(page)).toBeHidden();
    expect(requetes).toEqual([]);
    expect(await sessionRangee(page)).not.toBeNull();
    expect(await basesIndexedDb(page)).toContain(nomBase(SESSION.utilisateurId));
    await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeEnabled();

    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await confirmerDeconnexion(page);
    await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: DELAI_EFFACEMENT_MS });
    expect(requetes).toEqual([{ jetonRenouvellement: SESSION.jetonRenouvellement }]);
    expect(await sessionRangee(page)).toBeNull();
    expect(await basesIndexedDb(page)).not.toContain(nomBase(SESSION.utilisateurId));
  });
});

test.describe('effacement en attente et reconnexion (2e relecture sécurité, B2)', () => {
  /** Déconnexion pendant qu'un autre onglet garde la base : retour à la connexion, alerte affichée. */
  async function deconnecterAvecAutreOnglet(page: Page, context: BrowserContext): Promise<Page> {
    await page.route('**/auth/deconnexion', (route) => route.fulfill({ status: 204 }));
    const autreOnglet = await context.newPage();
    await autreOnglet.goto('/');
    await creerBase(autreOnglet, nomBase(SESSION.utilisateurId), true);

    await ouvrirConnecte(page);
    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await confirmerDeconnexion(page);
    await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: DELAI_REPRISE_MS });
    await expect(page.getByRole('alert').filter({ hasText: MESSAGE_AUTRE_ONGLET })).toBeVisible({ timeout: DELAI_REPRISE_MS });
    return autreOnglet;
  }

  test('écran de connexion : la reprise n’empile pas de nouvelle demande tant que la précédente est en file', async ({ page, context }) => {
    test.setTimeout(120_000);
    await noterSuppressions(context);
    const autreOnglet = await deconnecterAvecAutreOnglet(page, context);
    // Plus d'un cycle de reprise (5 s d'intervalle, 10 s de blocage par essai).
    await page.waitForTimeout(20_000);
    expect(await suppressions(page, nomBase(SESSION.utilisateurId))).toBe(1);
    await autreOnglet.close();
    await expect.poll(() => marqueur(page), { timeout: DELAI_REPRISE_MS }).toBeNull();
    expect(await basesIndexedDb(page)).not.toContain(nomBase(SESSION.utilisateurId));
  });

  test('déconnexion avec un autre onglet, reconnexion du même compte, saisie, autre onglet fermé : la base et la saisie restent', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await noterSuppressions(context);
    const nom = nomBase(SESSION.utilisateurId);
    const autreOnglet = await deconnecterAvecAutreOnglet(page, context);
    // Demandes d'effacement déjà faites (déconnexion, reprise) : celles-là restent en file.
    const avant = await suppressions(page, nom);

    // Reconnexion du même compte (API simulée).
    await page.route('**/auth/code', (route) => route.fulfill({ status: 202, json: { ok: true } }));
    await page.route('**/auth/verifier', (route) =>
      route.fulfill({
        status: 200,
        json: { utilisateurId: SESSION.utilisateurId, jetonAcces: SESSION.jetonAcces, jetonRenouvellement: 's'.repeat(43) },
      }),
    );
    await page.getByLabel(/adresse e-mail/i).fill(SESSION.email);
    await page.getByRole('button', { name: /recevoir un code/i }).click();
    await expect(page.getByLabel(/code/i)).toBeVisible();
    await page.keyboard.type('012345');
    await expect(navigation(page)).toBeVisible();
    await allerFerme(page);
    await expect(page.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeVisible();

    // Connecté : l'utilisateur quitte le marqueur, l'alerte disparaît, aucune nouvelle demande.
    expect(JSON.parse((await marqueur(page)) ?? '[]')).not.toContain(SESSION.utilisateurId);
    await expect(page.getByRole('alert').filter({ hasText: MESSAGE_AUTRE_ONGLET })).toBeHidden({ timeout: DELAI_REPRISE_MS });
    expect(await suppressions(page, nom)).toBe(avant);

    // Saisie (la demande abandonnée, encore en file, passe d'abord), puis l'autre onglet se ferme
    // plus de 10 s après la reconnexion (délai d'un essai d'effacement dépassé).
    const saisie = saisir(page, nom);
    await page.waitForTimeout(12_000);
    await autreOnglet.close();
    await saisie;
    expect(await temoinPresent(page, nom)).toBe(true);

    // Plus d'un cycle de reprise, puis redémarrage de l'appli : toujours là.
    await page.waitForTimeout(20_000);
    expect(await temoinPresent(page, nom)).toBe(true);
    await page.reload();
    await expect(navigation(page)).toBeVisible();
    await page.waitForTimeout(12_000);
    expect(await temoinPresent(page, nom)).toBe(true);
    expect(await suppressions(page, nom)).toBe(avant);
    expect(JSON.parse((await marqueur(page)) ?? '[]')).not.toContain(SESSION.utilisateurId);
  });
});

test.describe('déconnexion dans un autre onglet (3e relecture)', () => {
  test('la page B bascule sur l’écran de connexion quand la page A se déconnecte', async ({ page, context }) => {
    await context.route('**/auth/deconnexion', (route) => route.fulfill({ status: 204 }));
    await ouvrirConnecte(page);
    const autre = await context.newPage();
    await autre.goto('/');
    await allerFerme(autre);
    await expect(autre.getByRole('button', { name: /se déconnecter/i })).toBeVisible();

    // Jetons tournés par la page A (même compte) : la page B reste connectée.
    await page.evaluate(([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    }, [CLE_SESSION, JSON.stringify({ ...SESSION, jetonAcces: 'xxx.yyy.zzz', jetonRenouvellement: 'n'.repeat(43) })] as const);
    await autre.waitForTimeout(500);
    await expect(autre.getByRole('button', { name: /se déconnecter/i })).toBeVisible();

    await page.getByRole('button', { name: /se déconnecter/i }).click();
    await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: DELAI_EFFACEMENT_MS });

    // Sans rechargement : écran de connexion, plus rien du compte.
    await expect(autre.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: 5_000 });
    await expect(autre.getByRole('button', { name: /se déconnecter/i })).toHaveCount(0);
    await expect(navigation(autre)).toHaveCount(0);
    await expect(autre.getByTestId('app')).not.toContainText(SESSION.email);
    await autre.close();
  });

  test('un autre compte rangé par la page A : la page B bascule sur l’écran de connexion', async ({ page, context }) => {
    await ouvrirConnecte(page);
    const autre = await context.newPage();
    await autre.goto('/');
    await allerFerme(autre);
    await expect(autre.getByRole('button', { name: /se déconnecter/i })).toBeVisible();

    await page.evaluate(([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    }, [CLE_SESSION, JSON.stringify({ ...SESSION, utilisateurId: '0192f0c1-0000-7000-8000-000000000002', email: 'autre@ferme.fr' })] as const);

    await expect(autre.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: 5_000 });
    await expect(autre.getByRole('button', { name: /se déconnecter/i })).toHaveCount(0);
    await expect(navigation(autre)).toHaveCount(0);
    await expect(autre.getByTestId('app')).not.toContainText(SESSION.email);
    await autre.close();
  });
});

import { expect, test, type Page } from '@playwright/test';
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
 * L'API est simulée (page.route), comme dans connexion.e2e.ts.
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

async function ouvrirConnecte(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(([cle, valeur]) => {
    localStorage.setItem(cle, valeur);
  }, [CLE_SESSION, JSON.stringify(SESSION)] as const);
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
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
    await page.getByRole('button', { name: /se déconnecter/i }).click();
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

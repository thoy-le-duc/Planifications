import { expect, test, type Locator, type Page } from '@playwright/test';
import { ajouterJours, type DateCalendaire } from '@planif/core';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { MARQUE_ITINERAIRES_AFFICHES_ATTENDUE, MARQUE_ITINERAIRE_AFFICHE_ATTENDUE } from '../src/ecrans/itineraires/test/contrat.ts';
import {
  datesDe,
  EMPLACEMENT,
  ESPECE,
  fermeItineraires,
  ITINERAIRE,
  NOMS_ITINERAIRES,
  OCCUPATION,
  PARAMETRES,
  SAISON,
  seriesDuJeu,
  typeDepart,
} from '../src/ecrans/itineraires/test/ferme-itineraires.ts';
import { decrireSerie, ralentirCpu, REPETITIONS_MESURE, repeterMesure, surveillerCsp } from './outils.ts';

/**
 * T24 — mes itinéraires et mes types d'intervention, de bout en bout, sur le build des essais
 * servi par `vite preview` (dist-essais/), CPU ralenti ×4, réseau coupé. Contrat :
 * src/ecrans/itineraires/test/contrat.ts.
 *
 * Amorçage : /diagnostic/amorcer.html?jeu=itineraires&date=<jour du navigateur> remplit la base
 * locale de l'utilisateur de test avec la ferme des itinéraires
 * (src/ecrans/itineraires/test/ferme-itineraires.ts), datée relativement au jour : l'écran
 * Aujourd'hui lit la date du téléphone. Mêmes garde-fous que T11, T12 et T13.
 *
 * Critères du ticket :
 *   - adapter l'itinéraire « Batavia » de la bibliothèque, y ajouter « grelinette 10 j avant la
 *     mise en place » et « désherbage tous les 14 j » ; les tâches apparaissent dans Aujourd'hui
 *     pour une nouvelle série (créée depuis Planches avec la copie) ;
 *   - modifier l'itinéraire et l'appliquer aux séries à venir ; les séries passées sont
 *     inchangées ; l'annulation rétablit tout (dates lues dans le détail des barres de Planches) ;
 *   - écran et formulaire affichés en moins de 300 ms (tap → marque), aperçu recalculé en moins
 *     de 100 ms, médianes de 5 (décision T20) ;
 *   - cibles ≥ 56 px et contraste AA ; à 360 px, pas de défilement horizontal ; aucune violation
 *     de la CSP.
 */

const BUDGET_AFFICHAGE_MS = 300;
const BUDGET_APERCU_MS = 100;
const CIBLE_MIN_PX = 56;
const DELAI_AMORCAGE_MS = 60_000;

test.use({ actionTimeout: 15_000 });

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const ecranItineraires = (page: Page) => page.getByRole('dialog', { name: 'Mes itinéraires' });
const formulaire = (page: Page) => page.getByTestId('formulaire-itineraire');
const itineraire = (page: Page, id: string) => page.locator(`[data-testid="itineraire"][data-itineraire="${id}"]`);
const travail = (page: Page, indice: number) => formulaire(page).locator(`[data-testid="travail-prevu"][data-indice="${String(indice)}"]`);
const etatSynchro = (page: Page) => page.getByTestId('etat-synchro');
const bandeau = (page: Page) => page.getByTestId('saisie-annulable');

async function amorcerEtConnecter(page: Page, jour: string): Promise<void> {
  const ferme = fermeItineraires(jour);
  await test.step('amorcer la base locale avec la ferme des itinéraires (page de diagnostic)', async () => {
    await page.goto(`/diagnostic/amorcer.html?jeu=itineraires&date=${jour}`);
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(ferme.utilisateurId);
    expect(a.fermeId).toBe(ferme.fermeId);
    expect(a.lignes, 'lignes insérées : exactement la ferme des itinéraires').toBe(ferme.total);
  });

  await test.step('connexion (session rangée), installation du service worker', async () => {
    await page.goto('/');
    await page.evaluate(
      ([cle, valeur]) => {
        localStorage.setItem(cle, valeur);
      },
      [
        CLE_SESSION,
        JSON.stringify({ utilisateurId: ferme.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }),
      ] as const,
    );
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  });
}

async function horsLigne(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await ralentirCpu(page);
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
  await expect(etatSynchro(page)).toContainText('Hors ligne');
}

/** Temps entre le prochain appui (pointerdown) et la marque `marque`. */
async function tapJusquA(page: Page, cible: Locator, marque: string): Promise<number> {
  await page.evaluate((m) => {
    performance.clearMarks(m);
    const f = window as unknown as { __tap?: number };
    delete f.__tap;
    document.addEventListener(
      'pointerdown',
      () => {
        f.__tap = performance.now();
      },
      { capture: true, once: true },
    );
  }, marque);
  await cible.click();
  await page.waitForFunction((m) => performance.getEntriesByName(m, 'mark').length > 0, marque);
  return page.evaluate((m) => {
    const tap = (window as unknown as { __tap?: number }).__tap ?? Number.NaN;
    return (performance.getEntriesByName(m, 'mark')[0]?.startTime ?? Number.NaN) - tap;
  }, marque);
}

async function ouvrirEcran(page: Page): Promise<void> {
  await onglet(page, 'Ferme').click();
  await page.getByRole('button', { name: 'Mes itinéraires' }).click();
  await expect(ecranItineraires(page)).toBeVisible();
  await expect(itineraire(page, ITINERAIRE.batavia)).toBeVisible();
}

async function fermerEcran(page: Page): Promise<void> {
  await ecranItineraires(page).getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await expect(ecranItineraires(page)).toHaveCount(0);
}

/** Commandes sous `racine` : taille de la cible (le <label> d'une case ou d'un radio natif) et contraste AA. */
async function verifierCommandes(page: Page, racine: string, ou: string): Promise<void> {
  const mesures = await page.evaluate((sel) => {
    const r = document.querySelector(sel);
    if (r === null) return [];
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0] ?? 0) + 0.7152 * lin(rgb[1] ?? 0) + 0.0722 * lin(rgb[2] ?? 0);
    const lire = (s: string): number[] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (m === null) return null;
      const p = (m[1] ?? '').split(/[ ,/]+/).filter((x) => x !== '').map(Number);
      if (p.length === 4 && p[3] === 0) return null;
      return p.slice(0, 3);
    };
    const fond = (el: Element | null): number[] => {
      for (let e = el; e !== null; e = e.parentElement) {
        const c = lire(getComputedStyle(e).backgroundColor);
        if (c !== null) return c;
      }
      return [255, 255, 255];
    };
    return [...r.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], input, select')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return (b.width > 0 && b.height > 0) || (el instanceof HTMLInputElement && el.closest('label') !== null);
      })
      .map((el) => {
        const cible = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox') ? (el.closest('label') ?? el) : el;
        const b = cible.getBoundingClientRect();
        const s = getComputedStyle(cible);
        const texte = el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? '' : cible.textContent.trim();
        const couleur = lire(s.color) ?? [0, 0, 0];
        const [a, c] = [lum(couleur), lum(fond(cible))];
        const ratio = (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
        const taille = parseFloat(s.fontSize);
        const grand = taille >= 24 || (taille >= 18.66 && Number(s.fontWeight) >= 700);
        return {
          nom: el.getAttribute('aria-label') ?? (texte === '' ? el.outerHTML.slice(0, 80) : texte),
          largeur: b.width,
          hauteur: b.height,
          aTexte: texte !== '' || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type !== 'radio' && el.type !== 'checkbox'),
          ratio,
          seuil: grand ? 3 : 4.5,
        };
      });
  }, racine);
  expect(mesures.length, `${ou} : des commandes à mesurer`).toBeGreaterThan(0);
  for (const m of mesures) {
    expect(m.largeur, `${ou} : largeur de « ${m.nom} »`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
    expect(m.hauteur, `${ou} : hauteur de « ${m.nom} »`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
    if (m.aTexte) expect(m.ratio, `${ou} : contraste de « ${m.nom} »`).toBeGreaterThanOrEqual(m.seuil);
  }
}

/** À 360 px : cibles, et aucun défilement horizontal (page et `racine`). */
async function verifierA360(page: Page, racine: string, ou: string): Promise<void> {
  const vue = page.viewportSize();
  await verifierCommandes(page, racine, `${ou}, largeur du téléphone`);
  await page.setViewportSize({ width: 360, height: 780 });
  await verifierCommandes(page, racine, `${ou}, 360 px`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${ou} : page à 360 px`).toBeLessThanOrEqual(360);
  const debordement = await page.locator(racine).evaluate((e) => e.scrollWidth - e.clientWidth);
  expect(debordement, `${ou} : pas de défilement horizontal`).toBeLessThanOrEqual(0);
  if (vue !== null) await page.setViewportSize(vue);
}

/**
 * Change « Jours » du travail `indice` pour `valeur` et mesure, dans la page, le temps jusqu'à ce
 * que ses dates d'aperçu changent (MutationObserver : pas de latence de Playwright).
 */
async function tempsApercu(page: Page, indice: number, valeur: string): Promise<number> {
  return page.evaluate(
    ({ indice, valeur }) =>
      new Promise<number>((resolve, reject) => {
        const racine = document.querySelector('[data-testid="formulaire-itineraire"]');
        const groupe = racine?.querySelector(`[data-testid="travail-prevu"][data-indice="${String(indice)}"]`);
        const champ = [...(groupe?.querySelectorAll<HTMLInputElement>('input') ?? [])].find((i) => {
          const lie = i.id === '' ? null : document.querySelector(`label[for="${i.id}"]`);
          return (i.getAttribute('aria-label') ?? lie?.textContent ?? i.closest('label')?.textContent ?? '').trim() === 'Jours';
        });
        if (racine === null || champ === undefined) {
          reject(new Error('formulaire ou champ « Jours » absent'));
          return;
        }
        const lire = () => racine.querySelector(`[data-testid="apercu-travail"][data-indice="${String(indice)}"]`)?.getAttribute('data-dates');
        const avant = lire();
        let t0 = 0;
        const observateur = new MutationObserver(() => {
          const d = lire();
          if (d !== undefined && d !== null && d !== avant) {
            observateur.disconnect();
            resolve(performance.now() - t0);
          }
        });
        observateur.observe(racine, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => {
          observateur.disconnect();
          reject(new Error(`aperçu du travail ${String(indice)} pas recalculé en 5 s`));
        }, 5_000);
        t0 = performance.now();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(champ, valeur);
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        champ.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    { indice, valeur },
  );
}

test('adapter la Batavia de la bibliothèque : grelinette et désherbage, les tâches dans Aujourd’hui ; 300 ms, 100 ms, hors ligne', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 240_000);
  const jour = jourLocal(new Date());
  await amorcerEtConnecter(page, jour);
  const violations = await surveillerCsp(page);

  await test.step('réouverture hors ligne, CPU ×4', async () => {
    await horsLigne(page);
  });

  await test.step('« Mes itinéraires » depuis l’onglet Ferme : écran en moins de 300 ms, médiane de 5', async () => {
    await onglet(page, 'Ferme').click();
    const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
      const ms = await tapJusquA(page, page.getByRole('button', { name: 'Mes itinéraires' }), MARQUE_ITINERAIRES_AFFICHES_ATTENDUE);
      await expect(ecranItineraires(page)).toBeVisible();
      await fermerEcran(page);
      return ms;
    });
    console.log(decrireSerie('écran des itinéraires, tap sur « Mes itinéraires »', serie, BUDGET_AFFICHAGE_MS));
    expect(serie.mediane).toBeLessThan(BUDGET_AFFICHAGE_MS);
  });

  await test.step('« Adapter pour ma ferme » : formulaire en moins de 300 ms, médiane de 5 ; rien n’est écrit', async () => {
    await ouvrirEcran(page);
    const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
      const ms = await tapJusquA(page, itineraire(page, ITINERAIRE.batavia).getByRole('button', { name: /^Adapter pour ma ferme/ }), MARQUE_ITINERAIRE_AFFICHE_ATTENDUE);
      await expect(formulaire(page)).toBeVisible();
      await formulaire(page).getByRole('button', { name: 'Fermer', exact: true }).click();
      await expect(formulaire(page)).toHaveCount(0);
      return ms;
    });
    console.log(decrireSerie('formulaire d’itinéraire, tap sur « Adapter pour ma ferme »', serie, BUDGET_AFFICHAGE_MS));
    expect(serie.mediane).toBeLessThan(BUDGET_AFFICHAGE_MS);
    await expect(etatSynchro(page), 'adapter puis fermer n’écrit rien').toHaveText('Hors ligne');
  });

  await test.step('écran des itinéraires : cibles ≥ 56 px, contraste AA, 360 px sans défilement horizontal', async () => {
    await verifierA360(page, '[data-testid="ecran-itineraires"]', 'écran des itinéraires');
  });

  await test.step('adapter : grelinette 10 j avant la mise en place, désherbage tous les 14 j', async () => {
    await itineraire(page, ITINERAIRE.batavia).getByRole('button', { name: /^Adapter pour ma ferme/ }).click();
    const f = formulaire(page);
    await expect(f).toBeVisible();
    await expect(f.getByLabel('Nom', { exact: true })).toHaveValue('Batavia (ma ferme)');

    await f.getByRole('button', { name: 'Ajouter un travail' }).click();
    await travail(page, 0).getByLabel('Type', { exact: true }).selectOption(typeDepart('travail_sol', 'grelinette'));
    await travail(page, 0).getByLabel('Jours', { exact: true }).fill('10');
    await travail(page, 0).getByLabel('Avant ou après').selectOption('avant');
    await travail(page, 0).getByLabel('Repère', { exact: true }).selectOption('mise_en_place');

    await f.getByRole('button', { name: 'Ajouter un travail' }).click();
    await travail(page, 1).getByLabel('Type', { exact: true }).selectOption(typeDepart('entretien', 'désherbage'));
    await travail(page, 1).getByLabel('Jours', { exact: true }).fill('0');
    await travail(page, 1).getByLabel('Avant ou après').selectOption('apres');
    await travail(page, 1).getByLabel('Repère', { exact: true }).selectOption('mise_en_place');
    await travail(page, 1).getByLabel('Répéter').check();
    await travail(page, 1).getByLabel('Période (jours)').fill('14');
    await travail(page, 1).getByLabel('Fin de la répétition').selectOption('debut_recolte');

    const miseEnPlace = (await f.getByTestId('apercu-itineraire').getAttribute('data-mise-en-place')) ?? '';
    expect(miseEnPlace).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(f.locator('[data-testid="apercu-travail"][data-indice="0"]')).toHaveAttribute('data-dates', ajouterJours(miseEnPlace as DateCalendaire, -10));
    const desherbage = [0, 14, 28].map((n) => ajouterJours(miseEnPlace as DateCalendaire, n)).join(',');
    await expect(f.locator('[data-testid="apercu-travail"][data-indice="1"]'), 'désherbage : 0, +14, +28 (début de récolte à +28, compris)').toHaveAttribute(
      'data-dates',
      desherbage,
    );
  });

  await test.step('aperçu recalculé en moins de 100 ms après un changement de « Jours », médiane de 5', async () => {
    const valeurs = ['11', '12', '13', '14', '15'];
    const serie = await repeterMesure(REPETITIONS_MESURE, async (i) => tempsApercu(page, 0, valeurs[i] ?? '11'));
    console.log(decrireSerie('aperçu d’un itinéraire (jours d’un travail changés)', serie, BUDGET_APERCU_MS));
    expect(serie.mediane).toBeLessThan(BUDGET_APERCU_MS);
    await travail(page, 0).getByLabel('Jours', { exact: true }).fill('10');
  });

  await test.step('formulaire : cibles ≥ 56 px, contraste AA, 360 px sans défilement horizontal', async () => {
    await verifierA360(page, '[data-testid="formulaire-itineraire"]', 'formulaire d’itinéraire');
  });

  await test.step('« Enregistrer » : la copie est dans la liste, 1 saisie en attente, bandeau « Annuler »', async () => {
    await formulaire(page).getByRole('button', { name: 'Enregistrer' }).click();
    await expect(formulaire(page)).toHaveCount(0);
    await expect(bandeau(page)).toContainText('Batavia (ma ferme)');
    await expect(ecranItineraires(page).locator('[data-testid="itineraire"][data-origine="ferme"]').filter({ hasText: 'Batavia (ma ferme)' })).toHaveCount(1);
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 1 saisie en attente');
    await fermerEcran(page);
  });

  await test.step('Planches : nouvelle série de Batavia avec la copie, plantée cette semaine sur T1-P01', async () => {
    await onglet(page, 'Planches').click();
    await expect(page.getByTestId('plan-defilement')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Nouvelle série' }).click();
    const s = page.getByRole('dialog', { name: 'Nouvelle série' });
    await expect(s).toBeVisible();
    await s.getByLabel('Culture').fill('bat');
    await s.locator(`[data-testid="choix-culture"][data-espece="${ESPECE.batavia}"][data-variete=""]`).click();
    await s.getByLabel('Itinéraire').selectOption({ label: 'Batavia (ma ferme)' });
    await s.getByRole('radio', { name: 'Plantation' }).click();
    await s.getByLabel('Ajouter une planche').selectOption(EMPLACEMENT.t1p01);
    await s.getByRole('button', { name: 'Planifier la série' }).click();
    await expect(s).toHaveCount(0);
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 2 saisies en attente');
  });

  await test.step('Aujourd’hui : la grelinette et le désherbage de la nouvelle série sont des tâches', async () => {
    await onglet(page, 'Aujourd').click();
    await expect(page.getByTestId('aujourdhui')).toBeVisible();
    const grelinette = page.locator('[data-testid="tache"][data-cle*=":travail:0:"]').filter({ hasText: /grelinette/i });
    const desherbage = page.locator('[data-testid="tache"][data-cle*=":travail:1:"]').filter({ hasText: /désherbage/i });
    await expect(grelinette.first()).toBeVisible();
    await expect(desherbage.first()).toBeVisible();
    await expect(grelinette.first()).toContainText('T1-P01');
  });

  await test.step('rechargement toujours hors ligne : les tâches restent', async () => {
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    await expect(page.locator('[data-testid="tache"][data-cle*=":travail:0:"]').filter({ hasText: /grelinette/i }).first()).toBeVisible();
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 2 saisies en attente');
  });

  expect(await violations()).toEqual([]);
});

test('modifier « Batavia de la ferme » et l’appliquer aux séries à venir ; les séries passées ne bougent pas ; l’annulation rétablit tout', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 240_000);
  const jour = jourLocal(new Date());
  await amorcerEtConnecter(page, jour);
  const violations = await surveillerCsp(page);
  const jeu = seriesDuJeu(jour);
  const annee = Number(jour.slice(0, 4));

  /** Saison (année civile) de la mise en place d'une série du jeu. */
  const saisonDe = (cle: 'aVenir1' | 'passee' | 'commencee'): string => {
    const d = datesDe(PARAMETRES.bataviaFerme, jeu[cle].ancre).miseEnPlace;
    const a = Number(d.slice(0, 4));
    return a < annee ? SAISON.precedente : a > annee ? SAISON.suivante : SAISON.courante;
  };

  /** Texte du détail de la barre de l'occupation de `cle` (dates « du … au … »), lu dans Planches. */
  async function detail(cle: 'aVenir1' | 'passee' | 'commencee'): Promise<string> {
    await onglet(page, 'Planches').click();
    await expect(page.getByTestId('plan-defilement')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Saison').selectOption(saisonDe(cle));
    const barre = page.locator(`[data-testid="barre"][data-occupation="${OCCUPATION[cle]}"]`);
    await expect(barre).toHaveCount(1);
    await barre.click();
    const d = page.getByRole('dialog', { name: 'Détail de la série' });
    await expect(d).toBeVisible();
    const t = (await d.textContent()) ?? '';
    await d.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(d).toHaveCount(0);
    return t.replace(/\s+/g, ' ').trim();
  }

  async function modifierEtEnregistrer(avantRecolte: string): Promise<void> {
    await ouvrirEcran(page);
    await itineraire(page, ITINERAIRE.bataviaFerme).getByRole('button', { name: `Modifier ${NOMS_ITINERAIRES.bataviaFerme}` }).click();
    const f = formulaire(page);
    await expect(f).toBeVisible();
    await f.getByLabel('Avant récolte (jours)').fill(avantRecolte);
    await f.getByRole('button', { name: 'Enregistrer' }).click();
  }

  await test.step('réouverture hors ligne, CPU ×4', async () => {
    await horsLigne(page);
  });

  const initial = { aVenir1: '', passee: '', commencee: '' };
  await test.step('dates des séries lues dans Planches avant la modification', async () => {
    initial.aVenir1 = await detail('aVenir1');
    initial.passee = await detail('passee');
    initial.commencee = await detail('commencee');
    expect(initial.aVenir1).toMatch(/\d/);
  });

  await test.step('avant récolte 49 → 56 j : « Appliquer aux 2 séries à venir ? », les deux séries listées, puis appliquer', async () => {
    await modifierEtEnregistrer('56');
    const c = page.getByRole('alertdialog', { name: /^Appliquer aux 2 séries à venir/ }).or(page.getByRole('dialog', { name: /^Appliquer aux 2 séries à venir/ }));
    await expect(c).toBeVisible();
    await expect(c.getByTestId('serie-a-venir')).toHaveCount(2);
    await verifierCommandes(page, '[data-testid="confirmation-series"]', 'confirmation');
    await c.getByRole('button', { name: 'Appliquer aux séries' }).click();
    await expect(c).toHaveCount(0);
    await expect(bandeau(page)).toBeVisible();
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 1 saisie en attente');
    await fermerEcran(page);
  });

  const applique = { aVenir1: '' };
  await test.step('Planches : la série à venir a changé, les séries passée et commencée non', async () => {
    applique.aVenir1 = await detail('aVenir1');
    expect(applique.aVenir1, 'la fin de récolte de la série à venir recule de 7 jours').not.toBe(initial.aVenir1);
    expect(await detail('passee'), 'série terminée : inchangée').toBe(initial.passee);
    expect(await detail('commencee'), 'série commencée : inchangée').toBe(initial.commencee);
  });

  await test.step('nouvelle modification (56 → 63 j) appliquée, puis « Annuler » dans les 10 s', async () => {
    await modifierEtEnregistrer('63');
    const c = page.getByRole('alertdialog', { name: /^Appliquer aux 2 séries à venir/ }).or(page.getByRole('dialog', { name: /^Appliquer aux 2 séries à venir/ }));
    await c.getByRole('button', { name: 'Appliquer aux séries' }).click();
    await expect(c).toHaveCount(0);
    await bandeau(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(bandeau(page)).toHaveCount(0);
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 3 saisies en attente');
    await itineraire(page, ITINERAIRE.bataviaFerme).getByRole('button', { name: `Modifier ${NOMS_ITINERAIRES.bataviaFerme}` }).click();
    await expect(formulaire(page).getByLabel('Avant récolte (jours)'), 'l’itinéraire est revenu à 56 j').toHaveValue('56');
    await formulaire(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await fermerEcran(page);
  });

  await test.step('Planches : l’annulation a tout rétabli (série à venir revenue, passées toujours intactes)', async () => {
    expect(await detail('aVenir1')).toBe(applique.aVenir1);
    expect(await detail('passee')).toBe(initial.passee);
    expect(await detail('commencee')).toBe(initial.commencee);
  });

  expect(await violations()).toEqual([]);
});

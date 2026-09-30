import { expect, test, type Page } from '@playwright/test';
import { MARQUE_APP_PRETE } from '../src/perf.ts';
import { ralentirCpu, tempsAppPrete } from './outils.ts';

/**
 * T20 — le service worker s'enregistre APRÈS le premier affichage de l'appli, et au repos.
 *
 * Constat de la CI de main : le script injecté par vite-plugin-pwa (`registerSW.js`) enregistre le
 * service worker au `load` de la fenêtre. Les écrans sont chargés à la demande : sur une machine
 * lente, `load` arrive AVANT le premier affichage, et le précache (2,8 Mio, WASM de SQLite compris)
 * concurrence l'affichage.
 *
 * Contrat attendu du code (à poser par le développeur) :
 *   - l'appli pose `performance.mark('planif:sw-enregistre')` (MARQUE_SW_ENREGISTRE) une seule fois,
 *     DANS le rappel de `requestIdleCallback` (repli permis ailleurs, par ex. setTimeout, mais
 *     Chromium a requestIdleCallback : c'est lui que le test attend), programmé APRÈS la marque de
 *     premier affichage (MARQUE_APP_PRETE, celle de tempsAppPrete) ;
 *   - juste après cette marque (dans le même rappel, ou après un import dynamique), elle appelle
 *     `navigator.serviceWorker.register` ; jamais avant, jamais au `load` ;
 *   - le service worker s'installe ensuite normalement (précache complet, `ready` résout) et la
 *     réouverture hors ligne marche.
 *
 * Méthode : un script d'initialisation (avant tout script de la page) espionne
 * `ServiceWorkerContainer.prototype.register` (instant de chaque appel, performance.now()),
 * `requestIdleCallback` (pour savoir si l'on est dans un rappel au repos) et `performance.mark`
 * (pour la marque MARQUE_SW_ENREGISTRE). Toutes les horloges sont celles de la page : aucune
 * tolérance.
 *
 * Deux cas, CPU ralenti ×4, première visite (contexte neuf) :
 *   1. visite ordinaire ;
 *   2. le cas de la CI reproduit de façon déterministe : le module de l'écran d'accueil (chargé à
 *      la demande avant le premier rendu, sans session) est retardé de RETARD_ACCUEIL_MS ; `load`
 *      arrive donc avant le premier affichage (vérifié par un témoin), et un enregistrement au
 *      `load` tombe avant la marque.
 */

const MARQUE_SW_ENREGISTRE = 'planif:sw-enregistre';

/** Retard imposé au module de l'écran d'accueil : `load` passe avant le premier affichage. */
const RETARD_ACCUEIL_MS = 600;

/** Module JS de l'écran d'accueil dans le build (`assets/Accueil-<hash>.js`). */
const MOTIF_MODULE_ACCUEIL = /\/assets\/Accueil-[^/]+\.js$/;

/** Temps laissé à l'appli pour enregistrer le service worker au repos, puis pour l'installer. */
const DELAI_SERVICE_WORKER_MS = 20_000;

interface JournalServiceWorker {
  /** performance.now() à chaque appel de navigator.serviceWorker.register. */
  readonly appels: number[];
  /** Chaque pose de MARQUE_SW_ENREGISTRE : instant, et si elle a eu lieu dans un rappel de requestIdleCallback. */
  readonly marques: { readonly t: number; readonly auRepos: boolean }[];
}

async function espionnerServiceWorker(page: Page): Promise<void> {
  await page.addInitScript((nomMarque) => {
    const journal: JournalServiceWorker = { appels: [], marques: [] };
    (window as unknown as { __journalSw: JournalServiceWorker }).__journalSw = journal;

    let profondeurRepos = 0;
    const ricOrigine = window.requestIdleCallback.bind(window);
    window.requestIdleCallback = (rappel, options) =>
      ricOrigine((echeance) => {
        profondeurRepos += 1;
        try {
          rappel(echeance);
        } finally {
          profondeurRepos -= 1;
        }
      }, options);

    const markOrigine = performance.mark.bind(performance);
    performance.mark = (nom, options) => {
      if (nom === nomMarque) journal.marques.push({ t: performance.now(), auRepos: profondeurRepos > 0 });
      return markOrigine(nom, options);
    };

    const prototype = ServiceWorkerContainer.prototype;
    // Lue par Reflect.get : la méthode est rappelée plus bas avec son `this` (le conteneur).
    const registerOrigine = Reflect.get(prototype, 'register');
    prototype.register = function (this: ServiceWorkerContainer, ...args: Parameters<ServiceWorkerContainer['register']>) {
      journal.appels.push(performance.now());
      return registerOrigine.apply(this, args);
    };
  }, MARQUE_SW_ENREGISTRE);
}

/** Début de l'événement `load` (ms depuis la navigation), une fois celui-ci passé. */
async function debutLoad(page: Page): Promise<number> {
  await page.waitForFunction(() => document.readyState === 'complete');
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.loadEventStart ?? Number.NaN;
  });
}

async function lireJournal(page: Page): Promise<JournalServiceWorker> {
  return page.evaluate(() => (window as unknown as { __journalSw: JournalServiceWorker }).__journalSw);
}

/** Tout ce qui doit être vrai une fois le premier affichage passé, quelle que soit la visite. */
async function verifierEnregistrementApresAffichage(page: Page, marqueAppMs: number): Promise<void> {
  // Enregistrement au repos : on attend qu'il ait eu lieu (sans condition de temps serrée).
  await page
    .waitForFunction(() => (window as unknown as { __journalSw: JournalServiceWorker }).__journalSw.appels.length > 0, undefined, {
      timeout: DELAI_SERVICE_WORKER_MS,
    })
    .catch(() => undefined);
  const journal = await lireJournal(page);
  const chargement = await debutLoad(page);
  console.log(
    `premier affichage à ${marqueAppMs.toFixed(0)} ms, load à ${chargement.toFixed(0)} ms ; ` +
      `register appelé à [${journal.appels.map((t) => t.toFixed(0)).join(', ')}] ms ; ` +
      `marque ${MARQUE_SW_ENREGISTRE} à [${journal.marques.map((m) => `${m.t.toFixed(0)}${m.auRepos ? ' au repos' : ' hors repos'}`).join(', ')}] ms`,
  );

  expect(journal.appels.length, 'navigator.serviceWorker.register appelé').toBeGreaterThan(0);
  const avantAffichage = journal.appels.filter((t) => t < marqueAppMs).map((t) => `${(t - marqueAppMs).toFixed(0)} ms`);
  expect(avantAffichage, 'service worker enregistré AVANT le premier affichage de l’appli').toEqual([]);

  expect(journal.marques.length, `marque ${MARQUE_SW_ENREGISTRE} posée une fois, juste avant l’enregistrement`).toBe(1);
  const marqueSw = journal.marques[0];
  if (marqueSw === undefined) throw new Error('inatteignable');
  expect(marqueSw.t, `${MARQUE_SW_ENREGISTRE} après ${MARQUE_APP_PRETE}`).toBeGreaterThanOrEqual(marqueAppMs);
  expect(marqueSw.auRepos, `${MARQUE_SW_ENREGISTRE} posée dans un rappel de requestIdleCallback (au repos)`).toBe(true);
  expect(
    journal.appels.filter((t) => t < marqueSw.t),
    `register appelé avant la marque ${MARQUE_SW_ENREGISTRE}`,
  ).toEqual([]);

  // Installé puis actif : le précache est terminé, et il contient bien la base locale.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: DELAI_SERVICE_WORKER_MS });
  const precacheWasm = await page.evaluate(async () => {
    for (const nom of await caches.keys()) {
      const requetes = await (await caches.open(nom)).keys();
      if (requetes.some((r) => /\.wasm(\?|$)/.test(r.url))) return true;
    }
    return false;
  });
  expect(precacheWasm, 'le précache contient le WASM de SQLite').toBe(true);
}

/** Réouverture hors ligne, CPU déjà ralenti : l'appli s'affiche, servie par le service worker. */
async function verifierReouvertureHorsLigne(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.reload();
  const ms = await tempsAppPrete(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), 'réouverture servie par le service worker').toBe(true);
  console.log(`réouverture hors ligne après la première visite : ${ms.toFixed(0)} ms`);
}

test('service worker enregistré après le premier affichage, au repos (première visite, CPU ×4)', async ({ page }) => {
  test.setTimeout(60_000);
  await espionnerServiceWorker(page);
  await ralentirCpu(page);
  await page.goto('/');
  const marqueAppMs = await tempsAppPrete(page);
  await verifierEnregistrementApresAffichage(page, marqueAppMs);
  await verifierReouvertureHorsLigne(page);
});

test('service worker enregistré après le premier affichage même quand load arrive avant (cas de la CI)', async ({ page }) => {
  test.setTimeout(60_000);
  await espionnerServiceWorker(page);
  let retardes = 0;
  await page.route(MOTIF_MODULE_ACCUEIL, async (route) => {
    retardes += 1;
    await new Promise((resolve) => setTimeout(resolve, RETARD_ACCUEIL_MS));
    await route.continue();
  });
  await ralentirCpu(page);
  await page.goto('/');
  const marqueAppMs = await tempsAppPrete(page);
  await page.unrouteAll({ behavior: 'wait' });

  // Témoin : le cas de la CI est bien reproduit (module retardé, load avant le premier affichage).
  expect(retardes, 'module de l’écran d’accueil retardé').toBeGreaterThan(0);
  const chargement = await debutLoad(page);
  expect(chargement, 'témoin : load arrive avant le premier affichage').toBeLessThan(marqueAppMs);

  await verifierEnregistrementApresAffichage(page, marqueAppMs);
  await verifierReouvertureHorsLigne(page);
});

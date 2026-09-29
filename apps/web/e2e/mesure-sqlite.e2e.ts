/**
 * T07 — mesure de la base SQLite PowerSync sur téléphone simulé (CPU ralenti ×4).
 *
 * Contrat attendu de la page de mesure :
 *
 * - URL : `/mesures/sqlite.html?variante=json` ou `?variante=raw`.
 *   Page Vite à part (seconde entrée du build : `apps/web/mesures/sqlite.html`, déclarée dans
 *   `build.rollupOptions.input` de `vite.config.ts`). Elle n'est pas liée depuis l'appli et son
 *   code (générateur, PowerSync, WASM) n'est jamais importé par `index.html` : le démarrage de
 *   l'appli ne s'alourdit pas.
 * - Déroulé, sans serveur PowerSync : base locale vide propre à la variante, chargement du jeu
 *   `genererFerme(graine)` (non chronométré), fermeture, puis chronométrage de :
 *     1. `ouvertureMs` : réouverture de la base déjà remplie, WASM déjà en cache ;
 *     2. `requete2dMs` : occupations d'une saison avec emplacement, zone et famille (jointures) ;
 *     3. `semainierMs` : requête du semainier d'une semaine ;
 *     4. `insertionMs` : insertion d'un événement.
 * - À la fin, la page pose `window.__mesuresSqlite` :
 *     { variante: 'json' | 'raw', graine: number,
 *       ouvertureMs: number, requete2dMs: number, semainierMs: number, insertionMs: number,
 *       lignes2d: number, lignesSemainier: number }
 *   ou, en cas d'échec, `{ variante, erreur: string }`.
 *
 * Rapport : chaque variante est attachée au rapport Playwright (`mesures-sqlite-<variante>.json`)
 * et écrite dans `apps/web/test-results/mesures-sqlite-<variante>.json` (ignoré par git), d'où
 * les chiffres sont reportés dans `docs/mesures/sqlite.md`.
 *
 * Ce test ENREGISTRE, il ne tranche pas : il n'impose pas ouverture + requête 2D < 300 ms.
 * Le ticket prévoit que, si les deux variantes dépassent, on s'arrête et on documente le
 * problème dans `docs/questions.md` au lieu de faire échouer la CI.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Request } from '@playwright/test';
import { ralentirCpu, tempsAppPrete } from './outils.ts';

const VARIANTES = ['json', 'raw'] as const;
type Variante = (typeof VARIANTES)[number];

interface MesuresSqlite {
  variante: Variante;
  graine: number;
  ouvertureMs: number;
  requete2dMs: number;
  semainierMs: number;
  insertionMs: number;
  lignes2d: number;
  lignesSemainier: number;
}

const DUREES = ['ouvertureMs', 'requete2dMs', 'semainierMs', 'insertionMs'] as const;

/**
 * Une mesure dure environ 7 s avec le CPU ralenti. 90 s de marge : un blocage échoue vite,
 * sans manger le job CI de 15 minutes.
 */
const DELAI_MESURE_MS = 90_000;

/** Temps laissé au service worker pour s'installer et précacher, après `ready`. */
const ATTENTE_PRECACHE_MS = 1_500;

const dossierRapport = join(import.meta.dirname, '..', 'test-results');

for (const variante of VARIANTES) {
  test(`mesure SQLite, variante ${variante}, CPU ralenti`, async ({ page }) => {
    test.setTimeout(DELAI_MESURE_MS);
    await ralentirCpu(page);
    await page.goto(`/mesures/sqlite.html?variante=${variante}`);

    const poignee = await page.waitForFunction(
      () => (window as unknown as { __mesuresSqlite?: unknown }).__mesuresSqlite,
      undefined,
      { timeout: DELAI_MESURE_MS - 10_000 },
    );
    const brut: unknown = await poignee.jsonValue();
    expect(brut, 'window.__mesuresSqlite doit être un objet').toBeInstanceOf(Object);
    const resultat = brut as Partial<MesuresSqlite> & { erreur?: unknown };
    expect(resultat.erreur, 'la page a signalé une erreur').toBeUndefined();
    expect(resultat.variante).toBe(variante);
    expect(Number.isInteger(resultat.graine)).toBe(true);

    for (const cle of DUREES) {
      const ms = resultat[cle];
      expect(typeof ms, cle).toBe('number');
      expect(Number.isFinite(ms), cle).toBe(true);
      expect(ms, cle).toBeGreaterThan(0);
    }
    // La page de mesure reste hors du service worker : aucun ne doit s'y installer.
    const inscriptions = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    expect(inscriptions, 'service worker inscrit sur la page de mesure').toBe(0);

    // La requête 2D doit vraiment ramener des occupations, sinon la mesure ne vaut rien.
    expect(resultat.lignes2d).toBeGreaterThan(0);
    expect(typeof resultat.lignesSemainier).toBe('number');

    const mesures = resultat as MesuresSqlite;
    const json = JSON.stringify(mesures, null, 2);
    await test.info().attach(`mesures-sqlite-${variante}.json`, { body: json, contentType: 'application/json' });
    mkdirSync(dossierRapport, { recursive: true });
    writeFileSync(join(dossierRapport, `mesures-sqlite-${variante}.json`), `${json}\n`);

    const total = mesures.ouvertureMs + mesures.requete2dMs;
    console.log(
      `SQLite ${variante} : ouverture ${mesures.ouvertureMs.toFixed(0)} ms, requête 2D ${mesures.requete2dMs.toFixed(0)} ms ` +
        `(total ${total.toFixed(0)} ms, budget 300 ms, non bloquant), semainier ${mesures.semainierMs.toFixed(0)} ms, ` +
        `insertion ${mesures.insertionMs.toFixed(0)} ms`,
    );
  });
}

test('le WASM SQLite ne se charge pas au démarrage de l’appli', async ({ page, context }) => {
  // Écoute au niveau du contexte : couvre aussi les requêtes du service worker (précache).
  const requetes: Request[] = [];
  context.on('request', (r) => requetes.push(r));
  await ralentirCpu(page);
  await page.goto('/');
  await tempsAppPrete(page);
  // Le service worker précache à son installation : on attend qu'il soit prêt, puis un instant.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(ATTENTE_PRECACHE_MS);

  const suspectes = requetes
    .map((r) => r.url())
    .filter((url) => /\.wasm(\?|$)|powersync|wa-sqlite|\/mesures\/|\/assets\/sqlite\//i.test(url));
  expect(suspectes, 'requêtes SQLite ou mesure au démarrage ou au précache').toEqual([]);
});

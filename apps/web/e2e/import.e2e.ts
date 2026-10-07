import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { preparerExport } from '@planif/core';
import { fermeComplete, VOLUMES } from '../../../packages/core/src/import/test/jeu-ferme.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { espece, fermeImport } from '../src/ecrans/import/test/ferme-import.ts';
import { ralentirCpu, surveillerCsp } from './outils.ts';

/**
 * T14b — l'import d'un tableur de bout en bout, sur le build des essais servi par `vite preview`
 * (dist-essais/), HORS LIGNE, CPU ralenti ×4. Contrat : src/ecrans/import/test/contrat.ts.
 *
 * Amorçage : /diagnostic/amorcer.html?jeu=import remplit la base locale de l'utilisateur de test
 * avec la ferme de l'import (src/ecrans/import/test/ferme-import.ts). Mêmes garde-fous que les
 * autres jeux.
 *
 * Critères du ticket :
 *   1. chaque fichier du jeu de T14 importé de bout en bout (déposer, dire ce que c'est,
 *      colonnes, valeurs, aperçu, importer), dont quatre (ici neuf) sans correction manuelle ;
 *      la préparation tourne dans un Web Worker (URL /preparation/) ;
 *   3. ferme complète (jeu de T07 exporté en tableur par T15 : emplacement.csv puis serie.csv)
 *      importée en moins de 60 s, CPU ×4, sans geler l'écran : aucune tâche longue de plus de
 *      50 ms sur le fil principal (PerformanceObserver « longtask », comme e2e/export.e2e.ts).
 * Ce que l'import écrit, table par table, et l'annulation : src/ecrans/import/*.test.tsx.
 */

const DELAI_AMORCAGE_MS = 120_000;
/** Critère 3 du ticket. */
const DUREE_MAX_FERME_COMPLETE_MS = 60_000;
/** « Sans geler l'écran » : même borne que l'export (T16b). */
const TACHE_MAX_MS = 50;
const CIBLE_GANT_PX = 56;

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

const DOSSIER_FIXTURES = new URL('../../../packages/core/src/import/__fixtures__/', import.meta.url);
const fixture = (nom: string): Buffer => readFileSync(new URL(nom, DOSSIER_FIXTURES));

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const ecran = (page: Page) => page.getByTestId('ecran-import');
const statut = (page: Page) => ecran(page).getByRole('status');

async function amorcerEtConnecter(page: Page): Promise<void> {
  const ferme = fermeImport();
  await test.step('amorcer la base locale avec la ferme de l’import', async () => {
    await page.goto('/diagnostic/amorcer.html?jeu=import');
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(ferme.utilisateurId);
    expect(a.fermeId).toBe(ferme.fermeId);
    expect(a.lignes).toBe(ferme.total);
  });
  await test.step('connexion (session rangée), service worker, puis hors ligne et CPU ×4', async () => {
    await page.goto('/');
    await page.evaluate(
      ([cle, valeur]) => {
        localStorage.setItem(cle, valeur);
      },
      [CLE_SESSION, JSON.stringify({ utilisateurId: ferme.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
    );
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await page.context().setOffline(true);
    await ralentirCpu(page);
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await expect(page.getByTestId('etat-synchro')).toContainText('Hors ligne');
  });
}

async function ouvrirImport(page: Page): Promise<void> {
  await navigation(page).locator('button').filter({ hasText: 'Ferme' }).click();
  const entree = page.getByRole('button', { name: 'Importer un tableur' });
  await expect(entree).toBeEnabled();
  expect((await entree.boundingBox())?.height ?? 0, 'cible au gant').toBeGreaterThanOrEqual(CIBLE_GANT_PX);
  await entree.click();
  await expect(page.getByRole('dialog', { name: 'Importer un tableur' })).toBeVisible();
  await expect(ecran(page)).toHaveAttribute('data-etape', 'depot');
}

async function deposer(page: Page, nom: string, octets: Buffer | string): Promise<void> {
  await expect(ecran(page)).toHaveAttribute('data-etape', 'depot');
  await ecran(page)
    .getByLabel('Choisir un fichier')
    .setInputFiles({ name: nom, mimeType: nom.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv', buffer: typeof octets === 'string' ? Buffer.from(octets, 'utf8') : octets });
  await expect(ecran(page)).toHaveAttribute('data-etape', 'type', { timeout: 30_000 });
}

async function continuer(page: Page): Promise<void> {
  const b = ecran(page).getByRole('button', { name: 'Continuer', exact: true });
  await expect(b).toBeEnabled();
  expect((await b.boundingBox())?.height ?? 0, '« Continuer » : cible au gant').toBeGreaterThanOrEqual(CIBLE_GANT_PX);
  await b.click();
}

const etape = (page: Page) => ecran(page).getAttribute('data-etape');

/** Va de l'étape 2 à l'aperçu ; `corriger` agit aux étapes 2 à 4 (sinon : aucun geste). */
async function jusquApercu(page: Page, corriger: { type?: (e: Locator) => Promise<void>; colonnes?: (e: Locator) => Promise<void>; valeurs?: (e: Locator) => Promise<void> } = {}): Promise<void> {
  await corriger.type?.(ecran(page));
  await continuer(page);
  await expect(ecran(page)).toHaveAttribute('data-etape', 'colonnes', { timeout: 30_000 });
  await corriger.colonnes?.(ecran(page));
  await continuer(page);
  await expect(ecran(page)).toHaveAttribute('data-etape', /^(valeurs|apercu)$/, { timeout: 60_000 });
  if ((await etape(page)) === 'valeurs') {
    await corriger.valeurs?.(ecran(page));
    await continuer(page);
  }
  await expect(ecran(page)).toHaveAttribute('data-etape', 'apercu', { timeout: 60_000 });
}

/** « Importer … », attend « N lignes importées » ; rend N. */
async function importer(page: Page): Promise<number> {
  const b = ecran(page)
    .getByRole('button', { name: /^Importer/ })
    .filter({ hasNotText: 'Importer un autre fichier' });
  await expect(b).toBeEnabled();
  await b.click();
  await expect(ecran(page)).toHaveAttribute('data-etape', 'fini', { timeout: 60_000 });
  const t = (await statut(page).textContent()) ?? '';
  const m = /(\d[\d\s\u202f\u00a0]*)\s+lignes?\s+import/i.exec(t);
  return m === null ? Number.NaN : Number((m[1] ?? '').replace(/[\s\u202f\u00a0]/g, ''));
}

async function autreFichier(page: Page): Promise<void> {
  await ecran(page).getByRole('button', { name: 'Importer un autre fichier' }).click();
  await expect(ecran(page)).toHaveAttribute('data-etape', 'depot');
}

/** Sondes du fil principal : tâches longues depuis la pose (comme e2e/export.e2e.ts). */
async function poserSondes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __sondes?: { taches: number[]; arreter: () => void } };
    w.__sondes?.arreter();
    const taches: number[] = [];
    const debut = performance.now();
    const obs = new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) if (e.startTime >= debut) taches.push(e.duration);
    });
    obs.observe({ type: 'longtask', buffered: false });
    w.__sondes = {
      taches,
      arreter: () => {
        obs.disconnect();
      },
    };
  });
}

async function lireSondes(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __sondes?: { taches: number[]; arreter: () => void } }).__sondes;
    s?.arreter();
    return [...(s?.taches ?? [])];
  });
}

test.use({ actionTimeout: 30_000 });

test('critère 1 : les dix fichiers du jeu de T14, de bout en bout, dont neuf sans correction ; préparation dans un Worker', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 300_000);
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await amorcerEtConnecter(page);
  const violations = await surveillerCsp(page);
  await ouvrirImport(page);

  const SANS_CORRECTION: readonly (readonly [string, number])[] = [
    ['parcellaire-anglais.csv', 4],
    ['parcellaire-3-niveaux-cp1252.csv', 5],
    ['t15-emplacement.csv', 3],
    ['cultures-itineraires.csv', 4],
    ['assolement-passe.csv', 4],
    ['series-semaines.tsv', 3],
    ['series-titre.xlsx', 3],
    // Radis N3 et tomate TA2 sont déjà en base (series-titre.xlsx) : doublons contre la base.
    ['series-anglais.csv', 1],
  ];
  for (const [nom, attendu] of SANS_CORRECTION) {
    await test.step(`${nom} : sans correction, ${String(attendu)} lignes`, async () => {
      await deposer(page, nom, fixture(nom));
      await jusquApercu(page);
      expect(await importer(page), nom).toBe(attendu);
      await autreFichier(page);
    });
  }

  await test.step('modele-a.csv : type, deux colonnes et une culture corrigés', async () => {
    await deposer(page, 'modele-a.csv', fixture('modele-a.csv'));
    await jusquApercu(page, {
      type: async (e) => {
        await e.getByRole('radio', { name: 'Séries', exact: true }).check();
      },
      colonnes: async (e) => {
        await e.getByLabel('Champ pour « Semaine de plantation »').selectOption('date_plantation');
        await e.getByLabel('Champ pour « Mètres »').selectOption('longueur_m');
      },
      valeurs: async (e) => {
        await e.getByLabel('Culture pour « Salade du jardin »').selectOption(espece('Laitue'));
      },
    });
    expect(await importer(page)).toBe(2);
    await autreFichier(page);
  });

  await test.step('modele-b.csv : le modèle de la ferme s’applique, aucune correction', async () => {
    await deposer(page, 'modele-b.csv', fixture('modele-b.csv'));
    await expect(ecran(page).getByRole('radio', { name: 'Séries', exact: true })).toBeChecked();
    await continuer(page);
    await expect(ecran(page).getByTestId('modele-applique')).toBeVisible();
    await continuer(page);
    await expect(ecran(page)).toHaveAttribute('data-etape', 'apercu', { timeout: 60_000 });
    expect(await importer(page)).toBe(3);
  });

  expect(
    workers.filter((u) => /preparation/i.test(u)).length,
    `Worker de préparation créé (workers vus : ${workers.join(', ')})`,
  ).toBeGreaterThan(0);
  expect(await violations()).toEqual([]);
});

test('critère 3 : ferme complète (T07 exportée par T15) en moins de 60 s, CPU ×4, sans tâche longue de plus de 50 ms', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 240_000);
  const ferme = fermeComplete();
  const fichiers = preparerExport({ fermeId: ferme.fermeId, genereLe: '2026-09-29T06:30:00.000Z', tables: ferme.tables }).fichiers;
  const contenu = (chemin: string): string => fichiers.find((f) => f.chemin === chemin)?.contenu ?? '';
  await amorcerEtConnecter(page);
  await ouvrirImport(page);

  await poserSondes(page);
  const debut = Date.now();
  await deposer(page, 'emplacement.csv', contenu('emplacement.csv'));
  await jusquApercu(page);
  expect(await importer(page), 'emplacement.csv').toBe(VOLUMES.emplacements);
  await autreFichier(page);
  await deposer(page, 'serie.csv', contenu('serie.csv'));
  await jusquApercu(page);
  const valides = Number(((await ecran(page).getByTestId('compteur-valides').textContent()) ?? '').replace(/\D/g, ''));
  const doublons = Number(((await ecran(page).getByTestId('compteur-doublons').textContent()) ?? '').replace(/\D/g, ''));
  expect(valides + doublons, 'les 3 000 séries lues').toBe(VOLUMES.series);
  expect(await importer(page), 'serie.csv').toBe(valides);
  const duree = Date.now() - debut;
  const taches = await lireSondes(page);
  const pire = Math.max(0, ...taches);
  console.log(`ferme complète, CPU ×4, hors ligne : ${String(duree)} ms (borne ${String(DUREE_MAX_FERME_COMPLETE_MS)}), ${String(taches.length)} tâches longues, pire ${pire.toFixed(0)} ms (limite ${String(TACHE_MAX_MS)})`);
  expect(duree, 'dépôt du premier fichier → second import terminé').toBeLessThan(DUREE_MAX_FERME_COMPLETE_MS);
  expect(pire, 'tâche longue sur le fil principal pendant l’import').toBeLessThanOrEqual(TACHE_MAX_MS);
});

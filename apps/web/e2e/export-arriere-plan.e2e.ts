import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { lireZip, texteZip, verifierAvecUnzip } from '../../../packages/sync/src/test/zip.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ralentirCpu, surveillerCsp } from './outils.ts';

/**
 * T15e — l'export de toute la ferme continue en arrière-plan quand on change d'onglet (Q28),
 * de bout en bout : même banc que e2e/export.e2e.ts (build de production servi par `vite
 * preview`, ferme de T07 dans la base locale amorcée par /diagnostic/amorcer.html, HORS LIGNE,
 * CPU ralenti ×4). Ce fichier est repris par le `testMatch` de playwright.config.ts
 * (`**\/*.e2e.ts`), comme export.e2e.ts : aucun changement de configuration.
 *
 * ── Ce que mesure ce test ───────────────────────────────────────────────────────────────────
 *   1. un export de référence, sans changement d'onglet (tap sur « Exporter toute ma ferme »,
 *      archive téléchargée) ;
 *   2. un second export : tap, puis onglet « Aujourd’hui » PENDANT l'export (le bandeau
 *      data-testid="export-bandeau", role="status", « Export en cours », avancement, « Annuler »,
 *      y est visible ; il n'est pas sur Ferme), retour sur « Ferme » (barre reprise, bouton
 *      d'export désactivé), puis l'archive arrive : UNE seule, valide (`unzip -t`) ;
 *   3. les deux archives sont IDENTIQUES : mêmes fichiers (mêmes chemins) et mêmes contenus
 *      décompressés, octet pour octet, à l'instant d'export près (`genere_le`, remplacé par un
 *      repère dans tous les fichiers avant comparaison : c'est la seule valeur qui dépend de
 *      l'heure du tap) ;
 *   4. aucune tâche longue (PerformanceObserver « longtask ») de plus de 50 ms, du tap au
 *      téléchargement, dans chacun des deux exports, changement d'onglet compris (seuil de
 *      export.e2e.ts, inchangé) ;
 *   5. « Annuler » dans le bandeau, depuis Aujourd'hui : bandeau retiré, « Export annulé »,
 *      aucun téléchargement ensuite.
 *
 * ── Pourquoi il échoue aujourd'hui ──────────────────────────────────────────────────────────
 * Quitter l'onglet Ferme démonte EcranFerme, dont le nettoyage annule l'export (AbortController) :
 * il n'y a pas de bandeau sur Aujourd'hui (étape 2 : `export-bandeau` introuvable) et aucune
 * archive n'arrive jamais (« waitForEvent('download') » expire). Le test d'annulation (5) échoue
 * aussi : pas de bandeau, donc pas de bouton « Annuler » sur Aujourd'hui.
 */

const DELAI_AMORCAGE_MS = 120_000;
/** Seuil de export.e2e.ts (T16b), inchangé : « aucune tâche > 50 ms ajoutée ». */
const TACHE_MAX_MS = 50;
/** Borne tap → téléchargement du second export : 10 s de export.e2e.ts, plus le temps du détour. */
const DUREE_MAX_MS = 15_000;
const EXPORTER = 'Exporter toute ma ferme';

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly erreur?: string;
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const boutonExporter = (page: Page) => page.getByRole('button', { name: EXPORTER, exact: true });
const bandeau = (page: Page) => page.getByTestId('export-bandeau');

async function allerA(page: Page, onglet: 'Ferme' | 'Aujourd’hui'): Promise<void> {
  await navigation(page).locator('button').filter({ hasText: onglet }).click();
  await expect(page.getByRole('heading', { level: 1, name: onglet })).toBeVisible();
}

async function rangerSession(page: Page, utilisateurId: string): Promise<void> {
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
}

/** Sonde des tâches longues, posée une fois pour toute la page (survit aux changements d'onglet de l'appli). */
async function poserSondeTaches(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __taches?: number[]; __obs?: PerformanceObserver };
    w.__obs?.disconnect();
    const taches: number[] = [];
    const obs = new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) taches.push(e.duration);
    });
    obs.observe({ type: 'longtask', buffered: false });
    w.__taches = taches;
    w.__obs = obs;
  });
}

/** Tâches longues vues depuis la dernière lecture (la liste est vidée). */
async function lireTaches(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __taches?: number[] };
    const vues = [...(w.__taches ?? [])];
    if (w.__taches !== undefined) w.__taches.length = 0;
    return vues;
  });
}

interface ArchiveLue {
  readonly nom: string;
  readonly octets: Uint8Array;
  /** Contenu décompressé de chaque fichier, `genere_le` remplacé par un repère. */
  readonly contenus: ReadonlyMap<string, string>;
}

async function lireArchive(d: Download): Promise<ArchiveLue> {
  const octets = new Uint8Array(readFileSync(await d.path()));
  const entrees = lireZip(octets);
  const json = JSON.parse(texteZip(entrees, 'ferme.json')) as { genere_le?: unknown };
  const genere = typeof json.genere_le === 'string' ? json.genere_le : null;
  expect(genere, 'ferme.json porte genere_le').not.toBeNull();
  const contenus = new Map<string, string>();
  for (const e of entrees) {
    const texte = texteZip(entrees, e.chemin);
    contenus.set(e.chemin, genere === null ? texte : texte.split(genere).join('<genere_le>'));
  }
  return { nom: d.suggestedFilename(), octets, contenus };
}

test('l’export continue en arrière-plan : changer d’onglet donne la même archive, sans tâche longue (hors ligne, CPU ×4, ferme de T07)', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 300_000);
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  const jeu = await remplirJeuT07(base).finally(() => {
    base.fermer();
  });
  const telechargements: Download[] = [];
  page.on('download', (d) => telechargements.push(d));

  await test.step('amorcer la base locale (page de diagnostic)', async () => {
    await page.goto('/diagnostic/amorcer.html');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
    const amorcage = (await poignee.jsonValue()) as Amorcage;
    expect(amorcage.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(amorcage.utilisateurId).toBe(jeu.utilisateurId);
  });
  const violations = await surveillerCsp(page);

  await test.step('connexion, service worker installé, base prête, puis hors ligne CPU ×4', async () => {
    await page.goto('/');
    await rangerSession(page, jeu.utilisateurId);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await context.setOffline(true);
    await ralentirCpu(page);
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await allerA(page, 'Ferme');
    await expect(boutonExporter(page)).toBeEnabled();
  });

  let reference: ArchiveLue | undefined;
  await test.step('export de référence, sans changer d’onglet', async () => {
    await poserSondeTaches(page);
    const attente = page.waitForEvent('download', { timeout: 120_000 });
    attente.catch(() => undefined);
    await boutonExporter(page).click();
    const d = await attente;
    const taches = await lireTaches(page);
    console.log(`référence : ${String(taches.length)} tâches longues, pire ${Math.max(0, ...taches).toFixed(0)} ms (limite ${String(TACHE_MAX_MS)} ms)`);
    expect(Math.max(0, ...taches), 'tâche longue pendant l’export de référence').toBeLessThanOrEqual(TACHE_MAX_MS);
    reference = await lireArchive(d);
    await expect(boutonExporter(page)).toBeEnabled();
  });

  let enArrierePlan: ArchiveLue | undefined;
  await test.step('export lancé sur Ferme, détour par Aujourd’hui, retour : l’archive arrive', async () => {
    const avant = telechargements.length;
    await poserSondeTaches(page);
    const attente = page.waitForEvent('download', { timeout: 120_000 });
    attente.catch(() => undefined);
    const debut = Date.now();
    await boutonExporter(page).click();
    await expect(page.getByRole('progressbar', { name: 'Avancement de l’export' })).toBeVisible();

    await allerA(page, 'Aujourd’hui');
    const b = bandeau(page);
    await expect(b, 'bandeau « Export en cours » sur Aujourd’hui').toBeVisible();
    await expect(b).toHaveAttribute('role', 'status');
    await expect(b).toContainText('Export en cours');
    await expect(b.locator('progress, [role="progressbar"]'), 'avancement dans le bandeau').toHaveCount(1);
    await expect(b.getByRole('button', { name: 'Annuler', exact: true })).toBeVisible();
    expect(telechargements.length, 'pas de téléchargement avant la fin de l’export').toBe(avant);

    await allerA(page, 'Ferme');
    await expect(bandeau(page), 'pas de bandeau sur Ferme').toHaveCount(0);
    await expect(boutonExporter(page), 'un seul export à la fois : bouton désactivé au retour').toBeDisabled();
    await expect(page.getByRole('progressbar', { name: 'Avancement de l’export' }), 'avancement repris sur Ferme').toBeVisible();

    const d = await attente;
    const duree = Date.now() - debut;
    const taches = await lireTaches(page);
    console.log(`export avec détour : ${String(duree)} ms (borne ${String(DUREE_MAX_MS)} ms), ${String(taches.length)} tâches longues, pire ${Math.max(0, ...taches).toFixed(0)} ms (limite ${String(TACHE_MAX_MS)} ms)`);
    expect(Math.max(0, ...taches), 'tâche longue pendant l’export avec changement d’onglet').toBeLessThanOrEqual(TACHE_MAX_MS);
    expect(duree, 'durée tap → téléchargement').toBeLessThan(DUREE_MAX_MS);
    await expect(bandeau(page)).toHaveCount(0);
    await expect(boutonExporter(page)).toBeEnabled();
    enArrierePlan = await lireArchive(d);
    await page.waitForTimeout(1_000);
    expect(telechargements.length - avant, 'une seule archive téléchargée').toBe(1);
    expect(verifierAvecUnzip(enArrierePlan.octets).length, '`unzip -t` valide').toBeGreaterThan(0);
  });

  await test.step('les deux archives sont identiques (mêmes fichiers, mêmes contenus décompressés)', () => {
    expect(reference, 'archive de référence').toBeDefined();
    expect(enArrierePlan, 'archive de l’export avec détour').toBeDefined();
    if (reference === undefined || enArrierePlan === undefined) return;
    expect(enArrierePlan.nom).toBe(reference.nom);
    expect([...enArrierePlan.contenus.keys()].sort(), 'mêmes fichiers').toEqual([...reference.contenus.keys()].sort());
    for (const [chemin, texte] of reference.contenus) {
      // Message court en cas d'écart : le nom du fichier, pas des mégaoctets de texte.
      expect(enArrierePlan.contenus.get(chemin) === texte, `contenu identique : ${chemin}`).toBe(true);
    }
  });

  await test.step('« Annuler » dans le bandeau, depuis Aujourd’hui : « Export annulé », rien téléchargé', async () => {
    const avant = telechargements.length;
    await boutonExporter(page).click();
    await allerA(page, 'Aujourd’hui');
    await expect(bandeau(page)).toBeVisible();
    await bandeau(page).getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Export annulé' })).toBeVisible();
    await expect(bandeau(page).filter({ hasText: 'Export en cours' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.waitForTimeout(DUREE_MAX_MS);
    expect(telechargements.length, 'aucun téléchargement après « Annuler »').toBe(avant);
    await allerA(page, 'Ferme');
    await expect(boutonExporter(page)).toBeEnabled();
  });

  expect(await violations()).toEqual([]);
});

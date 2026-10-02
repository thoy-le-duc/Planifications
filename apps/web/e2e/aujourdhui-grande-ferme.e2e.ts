import { expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { MARQUE_AUJOURDHUI_ATTENDUE } from '../src/ecrans/aujourdhui/test/contrat.ts';
import { grandeFerme } from '../src/ecrans/aujourdhui/test/grande-ferme.ts';
import { decrireSerie, ralentirCpu, REPETITIONS_MESURE, repeterMesure, repeterMesures } from './outils.ts';

/**
 * T13b — écran « Aujourd'hui » sur une grande ferme, build de production servi par
 * `vite preview` (dist-essais), CPU ralenti ×4, hors ligne. Mêmes mesures que T13
 * (e2e/aujourdhui.e2e.ts), sur un autre jeu.
 *
 * Amorçage : /diagnostic/amorcer.html?jeu=aujourdhui-grande-ferme&date=<jour du téléphone>
 * remplit la base locale de l'utilisateur de test avec la grande ferme
 * (src/ecrans/aujourdhui/test/grande-ferme.ts : 3 000 séries actives, ≈ 51 000 événements, des
 * milliers de tâches), datée relativement à aujourd'hui.
 *
 * Critères (médiane de 5, décision T20) :
 *   - tap sur « Aujourd'hui » depuis Planches, base ouverte : écran affiché en moins de 300 ms ;
 *   - T13d, lancement à froid hors ligne AVEC instantané de la journée (BLOQUANT) : tâches
 *     affichées (marque de l'écran) moins de 1 s après le début de la navigation (rechargement),
 *     ouverture de la base comprise. L'instantané est la dernière journée calculée, gardée sur le
 *     téléphone par une ouverture précédente (contrat : src/ecrans/aujourdhui/test/contrat.ts,
 *     section T13d) ; la base est relue ensuite, en arrière-plan. Changement de test justifié
 *     par T13d : la mesure était non bloquante depuis T13b (médiane 8 835 ms avant T13b,
 *     5 264 ms après) ;
 *   - première ouverture à froid, SANS instantané : mesurée, non bloquante (console). C'est le
 *     coût de la lecture à froid des pages SQLite que l'instantané masque. « Sans instantané » :
 *     le stockage du navigateur est vidé avant chaque rechargement, sauf la session (contrat
 *     T13d : instantané dans localStorage ; s'il allait ailleurs, cette étape mesurerait AVEC
 *     instantané, sans rien casser : elle est non bloquante) ;
 *   - temps d'ouverture de la base (data-base="prete") à chaque lancement : relevé, non bloquant.
 *   - relecture après une saisie « Fait » (T13c, BLOQUANT) : de l'appui à la saisie en tête de
 *     l'historique, en moins de 500 ms, médiane de 5 saisies sur 5 tâches différentes. Mesurée
 *     à ≈ 884 ms (une seule saisie, non bloquante) à la fin de T13b.
 */

const BUDGET_TAP_MS = 300;
/** T13d : lancement à froid avec instantané (bloquant) ; rappelé pour la première ouverture (non bloquante). */
const BUDGET_FROID_MS = 1_000;
/**
 * Laissé à l'appli, après une journée relue affichée, pour garder son instantané (écriture
 * différée possible : requestIdleCallback, minuterie). Le contrat ne fixe pas le moment exact.
 */
const DELAI_ECRITURE_INSTANTANE_MS = 1_500;
/** T13c : relecture après une saisie « Fait ». */
const BUDGET_RELECTURE_MS = 500;
const DELAI_AMORCAGE_MS = 240_000;

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
const ecran = (page: Page) => page.getByTestId('aujourdhui');
const taches = (page: Page) => page.getByTestId('tache');

/** Temps entre le prochain appui (pointerdown) et la marque de l'écran Aujourd'hui. */
async function tapJusquAAujourdhui(page: Page): Promise<number> {
  await page.evaluate((marque) => {
    performance.clearMarks(marque);
    const f = window as unknown as { __tap?: number };
    delete f.__tap;
    document.addEventListener(
      'pointerdown',
      () => {
        f.__tap = performance.now();
      },
      { capture: true, once: true },
    );
  }, MARQUE_AUJOURDHUI_ATTENDUE);
  await onglet(page, 'Aujourd’hui').click();
  await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_AUJOURDHUI_ATTENDUE);
  return page.evaluate((marque) => {
    const tap = (window as unknown as { __tap?: number }).__tap ?? Number.NaN;
    return (performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN) - tap;
  }, MARQUE_AUJOURDHUI_ATTENDUE);
}

/** Temps d'un lancement à froid : marque de l'écran, et ouverture de la base (si vue). */
type TempsLancement = Readonly<Record<'ecran' | 'base', number>>;

/**
 * Relève, à chaque chargement de page, le moment où la coquille passe à data-base="prete"
 * (base locale ouverte, ferme connue) : window.__basePrete.
 */
async function releverOuvertureBase(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const f = window as unknown as { __basePrete?: number };
    const voir = () => {
      if (f.__basePrete === undefined && document.querySelector('[data-testid="app"]')?.getAttribute('data-base') === 'prete') {
        f.__basePrete = performance.now();
      }
    };
    new MutationObserver(voir).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-base'] });
  });
}

/** Lancement à froid : rechargement, temps de la marque de l'écran depuis le début de la navigation. */
async function lancementAFroid(page: Page): Promise<TempsLancement> {
  await page.reload();
  await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_AUJOURDHUI_ATTENDUE, { timeout: 30_000 });
  const ecranMs = await page.evaluate((marque) => performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN, MARQUE_AUJOURDHUI_ATTENDUE);
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  const baseMs = await page.evaluate(() => (window as unknown as { __basePrete?: number }).__basePrete ?? Number.NaN);
  return { ecran: ecranMs, base: baseMs };
}

/** Vide le stockage du navigateur (localStorage), sauf la session : plus d'instantané. */
async function oublierInstantane(page: Page): Promise<void> {
  await page.evaluate((cleSession) => {
    for (const cle of Object.keys(localStorage)) if (cle !== cleSession) localStorage.removeItem(cle);
  }, CLE_SESSION);
}

/**
 * Relecture après « Fait » sur la première tâche qui en a un : temps de l'appui (pointerdown) à
 * l'arrivée d'une nouvelle saisie en tête de l'historique, qui ne vient que de la journée relue
 * (la tâche, elle, est masquée dès l'appui).
 */
async function relectureApresFait(page: Page): Promise<number> {
  await page.evaluate(() => {
    const f = window as unknown as { __appui?: number; __relue?: number };
    delete f.__appui;
    delete f.__relue;
    const premiere = () => document.querySelector('[data-testid="saisie-historique"]')?.getAttribute('data-evenement') ?? null;
    const avant = premiere();
    document.addEventListener(
      'pointerdown',
      () => {
        f.__appui = performance.now();
      },
      { capture: true, once: true },
    );
    const observateur = new MutationObserver(() => {
      if (f.__appui !== undefined && premiere() !== avant) {
        f.__relue = performance.now();
        observateur.disconnect();
      }
    });
    observateur.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-evenement'] });
  });
  await ecran(page).getByRole('button', { name: /^Marquer fait/ }).first().click();
  await page.waitForFunction(() => (window as unknown as { __relue?: number }).__relue !== undefined, undefined, { timeout: 30_000 });
  return page.evaluate(() => {
    const f = window as unknown as { __appui?: number; __relue?: number };
    return (f.__relue ?? Number.NaN) - (f.__appui ?? Number.NaN);
  });
}

test('grande ferme : Aujourd’hui au tap et à froid, relecture après « Fait »', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 360_000);
  await releverOuvertureBase(page);
  const aujourdhui = jourLocal(new Date());
  const ferme = grandeFerme(aujourdhui);

  await test.step('amorcer la base locale avec la grande ferme (page de diagnostic)', async () => {
    await page.goto(`/diagnostic/amorcer.html?jeu=aujourdhui-grande-ferme&date=${aujourdhui}`);
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(ferme.utilisateurId);
    expect(a.fermeId).toBe(ferme.fermeId);
    expect(a.lignes, 'lignes insérées : exactement la grande ferme').toBe(ferme.total);
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
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 60_000 });
    await expect(ecran(page)).toBeVisible();
    await expect(taches(page).first()).toBeVisible({ timeout: 60_000 });
  });

  await context.setOffline(true);
  await ralentirCpu(page);

  await test.step('première ouverture à froid hors ligne, SANS instantané, CPU ×4 : mesure non bloquante, médiane de 5', async () => {
    const series = await repeterMesures(REPETITIONS_MESURE, async () => {
      await oublierInstantane(page);
      const t = await lancementAFroid(page);
      await expect(taches(page).first()).toBeVisible();
      return t;
    });
    console.log(`${decrireSerie('Aujourd’hui (grande ferme), première ouverture à froid hors ligne, sans instantané', series.ecran, BUDGET_FROID_MS)} : non bloquant`);
    console.log(`${decrireSerie('Grande ferme, ouverture de la base (data-base="prete"), sans instantané', series.base, BUDGET_FROID_MS)} : non bloquant`);
  });

  await test.step(`lancement à froid hors ligne AVEC instantané, CPU ×4 : Aujourd’hui affiché en moins de ${String(BUDGET_FROID_MS)} ms, médiane de 5 (T13d)`, async () => {
    // La dernière ouverture a affiché la journée relue : l'appli en garde l'instantané.
    await expect(taches(page).first()).toBeVisible();
    await page.waitForTimeout(DELAI_ECRITURE_INSTANTANE_MS);
    const series = await repeterMesures(REPETITIONS_MESURE, async () => {
      const t = await lancementAFroid(page);
      await expect(taches(page).first()).toBeVisible();
      // La journée relue remplace l'instantané (et le garde) avant le lancement suivant.
      await page.waitForTimeout(DELAI_ECRITURE_INSTANTANE_MS);
      return t;
    });
    console.log(decrireSerie('Aujourd’hui (grande ferme), lancement à froid hors ligne, avec instantané', series.ecran, BUDGET_FROID_MS));
    console.log(`${decrireSerie('Grande ferme, ouverture de la base (data-base="prete"), avec instantané', series.base, BUDGET_FROID_MS)} : non bloquant`);
    expect(series.ecran.mediane).toBeLessThan(BUDGET_FROID_MS);
  });

  await test.step(`tap sur « Aujourd’hui » depuis Planches : écran affiché en moins de ${String(BUDGET_TAP_MS)} ms (base ouverte), médiane de 5`, async () => {
    const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
      await onglet(page, 'Planches').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
      const ms = await tapJusquAAujourdhui(page);
      await expect(taches(page).first()).toBeVisible();
      return ms;
    });
    console.log(decrireSerie('Aujourd’hui (grande ferme), tap depuis Planches', serie, BUDGET_TAP_MS));
    expect(serie.mediane).toBeLessThan(BUDGET_TAP_MS);
  });

  await test.step(`relecture après « Fait » : saisie dans l’historique en moins de ${String(BUDGET_RELECTURE_MS)} ms, médiane de 5 (T13c)`, async () => {
    const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
      const ms = await relectureApresFait(page);
      // La relecture est finie : la saisie suivante part d'un écran au repos.
      await expect(taches(page).first()).toBeVisible();
      return ms;
    });
    console.log(decrireSerie('Aujourd’hui (grande ferme), relecture après « Fait » (appui → saisie dans l’historique)', serie, BUDGET_RELECTURE_MS));
    expect(serie.mediane).toBeLessThan(BUDGET_RELECTURE_MS);
  });
});

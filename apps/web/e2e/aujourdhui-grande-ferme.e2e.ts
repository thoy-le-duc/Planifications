import { expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { MARQUE_AUJOURDHUI_ATTENDUE } from '../src/ecrans/aujourdhui/test/contrat.ts';
import { grandeFerme } from '../src/ecrans/aujourdhui/test/grande-ferme.ts';
import { decrireSerie, ralentirCpu, REPETITIONS_MESURE, repeterMesure } from './outils.ts';

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
 *   - lancement à froid hors ligne (rechargement) : MESURÉ, non bloquant (console). Le budget
 *     de 1 s (tâches affichées 1 s après le début de la navigation, ouverture de la base
 *     comprise) part dans T13d, décision du chef : 8 835 ms avant T13b, 5 686 ms après ; le reste
 *     est la lecture à froid des pages SQLite dans le navigateur et l'attente de Planches (T13c),
 *     que les requêtes seules ne rattrapent pas. T13d : instantané de la journée au lancement ;
 *   - relecture après une saisie « Fait » : MESURÉE, non bloquante (console), notée dans la PR ;
 *     au-delà de 500 ms, c'est T13c qui la traite.
 */

const BUDGET_TAP_MS = 300;
/** Budget visé par T13d, rappelé dans le journal de la mesure (non bloquant ici). */
const BUDGET_FROID_MS = 1_000;
const SEUIL_RELECTURE_MS = 500;
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

/** Lancement à froid : rechargement, temps de la marque de l'écran depuis le début de la navigation. */
async function lancementAFroid(page: Page): Promise<number> {
  await page.reload();
  await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_AUJOURDHUI_ATTENDUE, { timeout: 30_000 });
  return page.evaluate((marque) => performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN, MARQUE_AUJOURDHUI_ATTENDUE);
}

test('grande ferme : Aujourd’hui au tap et à froid, relecture après « Fait » mesurée', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 240_000);
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

  await test.step('lancement à froid hors ligne, CPU ×4 : mesure non bloquante, médiane de 5 (budget de 1 s : T13d)', async () => {
    const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
      const ms = await lancementAFroid(page);
      await expect(taches(page).first()).toBeVisible();
      return ms;
    });
    // Non bloquant (décision du chef) : le budget de 1 s est l'objet de T13d.
    console.log(`${decrireSerie('Aujourd’hui (grande ferme), lancement à froid hors ligne', serie, BUDGET_FROID_MS)} : non bloquant, voir T13d`);
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

  await test.step('relecture après « Fait » (mesure non bloquante, notée dans la PR)', async () => {
    // Fin de la relecture : la saisie arrive en tête de l'historique, qui ne vient que de la
    // journée relue (la tâche, elle, est masquée dès l'appui).
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
    try {
      await page.waitForFunction(() => (window as unknown as { __relue?: number }).__relue !== undefined, undefined, { timeout: 30_000 });
      const ms = await page.evaluate(() => {
        const f = window as unknown as { __appui?: number; __relue?: number };
        return (f.__relue ?? Number.NaN) - (f.__appui ?? Number.NaN);
      });
      const verdict = ms > SEUIL_RELECTURE_MS ? `au-delà de ${String(SEUIL_RELECTURE_MS)} ms : pour T13c` : `sous ${String(SEUIL_RELECTURE_MS)} ms`;
      console.log(`Aujourd’hui (grande ferme), relecture après « Fait » (appui → saisie dans l’historique) : ${ms.toFixed(0)} ms, ${verdict}`);
    } catch {
      console.log('Aujourd’hui (grande ferme), relecture après « Fait » : non mesurée (saisie absente de l’historique après 30 s)');
    }
  });
});

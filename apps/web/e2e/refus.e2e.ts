import { expect, test, type Page } from '@playwright/test';
import { fermeDuJour } from '../src/ecrans/aujourdhui/test/ferme-du-jour.ts';
import {
  MARQUE_REFUS_AFFICHES_ATTENDUE,
  REFUS_AUTRE_UTILISATEUR,
  REFUS_DU_JEU_TOTAL,
  REFUS_PLUS_RECENT,
} from '../src/ecrans/ferme/test/refus.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { decrireSerie, ralentirCpu, REPETITIONS_MESURE, repeterMesure, surveillerCsp } from './outils.ts';

/**
 * T10i — les refus de synchro dans l'onglet Ferme, de bout en bout, sur le build des essais servi
 * par `vite preview` (dist-essais/), CPU ralenti ×4, réseau coupé. Contrat :
 * src/ecrans/ferme/test/refus.ts.
 *
 * Amorçage : /diagnostic/amorcer.html?jeu=refus&date=<jour du navigateur> remplit la base locale
 * de l'utilisateur de test avec la ferme du jour et 101 refus (100 de l'utilisateur, 1 d'un
 * autre). Mêmes garde-fous que T11, T12 et T13.
 *
 * Critères :
 *   - l'onglet Ferme s'affiche en moins de 300 ms avec 100 refus en base (tap sur « Ferme » →
 *     marque MARQUE_REFUS_AFFICHES_ATTENDUE), médiane de 5 (décision T20) ;
 *   - le plus récent en tête ; jamais le refus de l'autre utilisateur ;
 *   - pastille sur l'onglet Ferme avant la première ouverture, éteinte après, même après
 *     rechargement (état « vu » gardé sur le téléphone) ;
 *   - aucune violation de la CSP.
 */

const BUDGET_AFFICHAGE_MS = 300;
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
const pastille = (page: Page) => onglet(page, 'Ferme').getByTestId('pastille-refus');
const refus = (page: Page) => page.getByTestId('refus');
const etatSynchro = (page: Page) => page.getByTestId('etat-synchro');

async function amorcerEtConnecter(page: Page, jour: string): Promise<void> {
  const ferme = fermeDuJour(jour);
  await test.step('amorcer la base locale : ferme du jour et 101 refus (page de diagnostic)', async () => {
    await page.goto(`/diagnostic/amorcer.html?jeu=refus&date=${jour}`);
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(ferme.utilisateurId);
    expect(a.fermeId).toBe(ferme.fermeId);
    expect(a.lignes, 'lignes insérées : la ferme du jour et les refus').toBe(ferme.total + REFUS_DU_JEU_TOTAL);
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

/** Temps entre l'appui sur l'onglet Ferme (pointerdown) et la marque des refus affichés. */
async function tapFerme(page: Page): Promise<number> {
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
  }, MARQUE_REFUS_AFFICHES_ATTENDUE);
  await onglet(page, 'Ferme').click();
  await page.waitForFunction((m) => performance.getEntriesByName(m, 'mark').length > 0, MARQUE_REFUS_AFFICHES_ATTENDUE);
  return page.evaluate((m) => {
    const tap = (window as unknown as { __tap?: number }).__tap ?? Number.NaN;
    return (performance.getEntriesByName(m, 'mark')[0]?.startTime ?? Number.NaN) - tap;
  }, MARQUE_REFUS_AFFICHES_ATTENDUE);
}

test('refus de synchro dans l’onglet Ferme : 100 refus, hors ligne, CPU ×4, moins de 300 ms', async ({ page }) => {
  test.setTimeout(180_000);
  const violationsCsp = await surveillerCsp(page);
  const jour = jourLocal(new Date());
  await amorcerEtConnecter(page, jour);

  await test.step('hors ligne, CPU ×4 : réouverture ; pastille sur l’onglet Ferme (refus pas encore vus)', async () => {
    await horsLigne(page);
    await expect(pastille(page)).toBeVisible();
  });

  await test.step('onglet Ferme : moins de 300 ms avec 100 refus, médiane de 5', async () => {
    const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
      const ms = await tapFerme(page);
      await expect(refus(page).first()).toBeVisible();
      await onglet(page, 'Aujourd').click();
      await expect(refus(page)).toHaveCount(0);
      return ms;
    });
    console.log(decrireSerie('onglet Ferme avec 100 refus, tap sur « Ferme »', serie, BUDGET_AFFICHAGE_MS));
    expect(serie.mediane).toBeLessThan(BUDGET_AFFICHAGE_MS);
  });

  await test.step('le plus récent en tête ; jamais le refus d’un autre utilisateur', async () => {
    await onglet(page, 'Ferme').click();
    await expect(refus(page).first()).toHaveAttribute('data-refus', REFUS_PLUS_RECENT);
    await expect(page.locator(`[data-testid="refus"][data-refus="${REFUS_AUTRE_UTILISATEUR}"]`)).toHaveCount(0);
    await expect(page.getByText('Refus d’un autre compte')).toHaveCount(0);
  });

  await test.step('pastille éteinte après l’ouverture, même après rechargement', async () => {
    await onglet(page, 'Aujourd').click();
    await expect(pastille(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    // Laisse aux refus le temps d'être lus : une pastille qui reviendrait apparaîtrait ici.
    await page.waitForTimeout(1_000);
    await expect(pastille(page)).toHaveCount(0);
  });

  expect(await violationsCsp()).toEqual([]);
});

import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ENTREE_PLACEMENT, TESTID_PLACEMENT as T } from '../src/ecrans/placement/test/contrat.ts';
import { TESTID_CONTOURS as TC } from '../src/ecrans/placement/test/contrat-contours.ts';
import { BOUTONS_BANDES as B, CHAMPS_BANDES as C, TESTID_BANDES as TB } from '../src/ecrans/placement/test/contrat-bandes.ts';
import { fermePlacement, MANON, MANON_PLANCHES, ZONE_TRI } from '../src/ecrans/placement/test/ferme-placement.ts';
import { surveillerCsp } from './outils.ts';
import { deverrouillerPlan } from './deverrouiller-plan.ts';

/**
 * T86 — les sous-zones d'une serre se dessinent en bandes et leurs planches s'y rangent, de bout en bout, sur ordinateur
 * (Chromium 1280 × 800), avec la ferme du placement (?jeu=placement&tri=1 : gérant, zone « Tri-tunnel » de type tunnel avec
 * ses sous-zones « Manon 1 » à « Manon 3 » et 8 planches non placées).
 * Poser le point de départ, choisir « Tri-tunnel », « Placer la serre » (40 × 9,6 m : trois bandes de 3,2 m), « Ranger les
 * planches dans les bandes », Enregistrer, recharger : les trois bandes nommées et les sept planches rangées sont là.
 * AUCUN appel réseau réel : tuiles servies par une fausse route, comme e2e/parcelle-planches.e2e.ts.
 */

const DELAI_AMORCAGE_MS = 120_000;
/** PNG de 1 × 1 px. */
const IMAGE_TUILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const executablePath = process.env.CHROMIUM_PATH;

test.use({
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  launchOptions: executablePath ? { executablePath } : {},
});

interface Reseau {
  readonly tuiles: string[];
  readonly ailleurs: string[];
}

async function intercepter(context: BrowserContext): Promise<Reseau> {
  const reseau: Reseau = { tuiles: [], ailleurs: [] };
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://data.geopf.fr') {
        reseau.tuiles.push(url.href);
        await route.fulfill({ status: 200, contentType: 'image/png', body: IMAGE_TUILE });
        return;
      }
      reseau.ailleurs.push(url.href);
      await route.abort('blockedbyclient');
    },
  );
  return reseau;
}

const ferme = fermePlacement();
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const editeur = (page: Page) => page.getByTestId(T.editeur);
const zoneTri = (page: Page) => page.locator(`[data-testid="${TC.zoneChoix}"][data-id="${ZONE_TRI}"]`);
const boutonEnregistrer = (page: Page) => page.getByRole('button', { name: 'Enregistrer', exact: true });
const bandes = (page: Page) => page.locator(`[data-testid="${TB.bande}"]`);

async function amorcerEtOuvrir(page: Page): Promise<void> {
  await page.goto('/diagnostic/amorcer.html?jeu=placement&tri=1');
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { erreur?: string; fermeId?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  expect(a.fermeId).toBe(ferme.fermeId);

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
}

async function ouvrirEditeur(page: Page): Promise<void> {
  await onglet(page, 'Ferme').click();
  await page.getByRole('button', { name: new RegExp(ENTREE_PLACEMENT) }).click();
  await expect(editeur(page)).toBeVisible({ timeout: 15_000 });
  await deverrouillerPlan(page);
  await expect(editeur(page)).toHaveAttribute('data-mode', 'edition');
}

test('ordinateur : placer la serre, ranger les planches dans les bandes, enregistrer, recharger : tout est en place', async ({ page, context }) => {
  test.setTimeout(240_000);
  const reseau = await intercepter(context);
  const violations = await surveillerCsp(page);
  await amorcerEtOuvrir(page);
  await ouvrirEditeur(page);

  await test.step('point de départ : la position de la ferme', async () => {
    await page.getByRole('button', { name: 'Utiliser la position de la ferme' }).click();
    const f = page.locator(`[role="alertdialog"], [role="dialog"]:not([data-testid="${T.editeur}"])`).filter({ hasText: /point de départ/i });
    await f.getByRole('button', { name: 'Confirmer' }).click();
    await expect(editeur(page)).toHaveAttribute('data-origine', '44,1.5');
  });

  await test.step('« Tri-tunnel » : « Placer la serre » → trois bandes nommées', async () => {
    await zoneTri(page).click();
    await expect(bandes(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Placer la serre', exact: true }).click();
    await expect(bandes(page)).toHaveCount(3);
    await expect(bandes(page)).toHaveText(['Manon 1', 'Manon 2', 'Manon 3']);
    await expect(bandes(page).nth(1)).toHaveAttribute('data-largeur', '3.2');
  });

  await test.step('« Ranger les planches dans les bandes » : sept planches, passe-pied 45 cm, avertissement non bloquant', async () => {
    await zoneTri(page).click();
    await expect(page.getByLabel(C.passePied)).toHaveValue('45');
    await page.getByRole('button', { name: B.ranger, exact: true }).click();
    for (const id of MANON_PLANCHES.flat()) await expect(page.locator(`[data-testid="${T.planche}"][data-id="${id}"]`)).toHaveCount(1);
    await expect(page.getByTestId(TB.avertissement)).toContainText('Manon 2 : 2 planches dépassent de la bande');
    await boutonEnregistrer(page).click();
    await expect(page.getByTestId(T.annuler), 'Annuler proposé après l’enregistrement').toBeVisible();
  });

  await test.step('recharger : les trois bandes et les sept planches sont au plan', async () => {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await expect(bandes(page)).toHaveCount(3);
    for (const id of MANON_PLANCHES.flat()) await expect(page.locator(`[data-testid="${T.planche}"][data-id="${id}"]`)).toHaveCount(1);
    await page.locator(`[data-testid="${TC.zoneChoix}"][data-id="${MANON[1]}"]`).click();
    await expect(page.getByTestId(T.panneau)).toContainText('Dans la serre Tri-tunnel, bande 2 sur 3');
    await expect(page.getByRole('button', { name: 'Tracer le contour', exact: true })).toHaveCount(0);
  });

  expect(reseau.ailleurs, 'aucune requête hors de localhost et de l’IGN').toEqual([]);
  expect(await violations(), 'aucune violation de la CSP').toEqual([]);
});

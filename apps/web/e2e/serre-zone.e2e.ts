import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ENTREE_PLACEMENT, TESTID_PLACEMENT as T } from '../src/ecrans/placement/test/contrat.ts';
import { BOUTONS_CONTOURS as B, TESTID_CONTOURS as TC } from '../src/ecrans/placement/test/contrat-contours.ts';
import { fermePlacement, ZONE_TUNNEL } from '../src/ecrans/placement/test/ferme-placement.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T81 — placer une serre depuis sa zone, de bout en bout, sur ordinateur (Chromium 1280 × 800),
 * avec la ferme du placement (?jeu=placement : gérant, « Tunnel 1 » zone tunnel sans contour).
 * Poser le point de départ, choisir « Tunnel 1 », « Placer la serre », Enregistrer, recharger :
 * la serre « Tunnel 1 » est au plan et la zone est abritée par elle.
 * AUCUN appel réseau réel : tuiles servies par une fausse route, comme e2e/contours.e2e.ts.
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
const zoneTunnel = (page: Page) => page.locator(`[data-testid="${TC.zoneChoix}"][data-id="${ZONE_TUNNEL}"]`);
const boutonEnregistrer = (page: Page) => page.getByRole('button', { name: 'Enregistrer', exact: true });

async function amorcerEtOuvrir(page: Page): Promise<void> {
  await page.goto('/diagnostic/amorcer.html?jeu=placement');
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
  await expect(editeur(page)).toHaveAttribute('data-mode', 'edition');
}

async function enregistrer(page: Page): Promise<void> {
  await boutonEnregistrer(page).click();
  await expect(page.getByTestId(T.annuler), 'Annuler proposé après l’enregistrement').toBeVisible();
}

const serre = (page: Page) => page.locator(`[data-testid="${T.batiment}"]`).filter({ hasText: 'Tunnel 1' });

test('ordinateur : placer une serre depuis sa zone, enregistrer, recharger : la serre et la zone sont liées', async ({ page, context }) => {
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

  await test.step('« Tunnel 1 » : « Placer la serre » pose un rectangle de 30 × 8 m', async () => {
    await zoneTunnel(page).click();
    await expect(page.getByRole('button', { name: 'Tracer le contour', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Placer la serre', exact: true }).click();
    await expect(serre(page)).toHaveCount(1);
    await expect(serre(page)).toHaveAttribute('data-longueur', '30');
    await expect(serre(page)).toHaveAttribute('data-largeur', '8');
    await enregistrer(page);
  });

  await test.step('recharger : la serre est au plan et la zone est abritée par elle', async () => {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await expect(serre(page)).toHaveCount(1);
    await zoneTunnel(page).click();
    await expect(page.getByTestId('zone-abritee')).toBeVisible();
    await expect(page.getByRole('button', { name: /une serre$|^Placer la serre$/ })).toHaveCount(0);
  });

  expect(reseau.ailleurs, 'aucune requête hors de localhost et de l’IGN').toEqual([]);
  expect(await violations(), 'aucune violation de la CSP').toEqual([]);
});

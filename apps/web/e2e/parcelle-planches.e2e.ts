import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ENTREE_PLACEMENT, TESTID_PLACEMENT as T } from '../src/ecrans/placement/test/contrat.ts';
import { TESTID_CONTOURS as TC } from '../src/ecrans/placement/test/contrat-contours.ts';
import { BOUTONS_PARCELLE as B, CHAMPS_PARCELLE as C, TESTID_PARCELLE as TP } from '../src/ecrans/placement/test/contrat-parcelle.ts';
import { fermePlacement, ZONE_TUNNEL } from '../src/ecrans/placement/test/ferme-placement.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T85 — dessiner la parcelle d'une zone à partir de ses planches, de bout en bout, sur ordinateur
 * (Chromium 1280 × 800), avec la ferme du placement (?jeu=placement&planches=1 : gérant, « Tunnel 1 »,
 * plein champ sans contour, avec trois planches non placées de 30 × 0,75 m).
 * Poser le point de départ, choisir « Tunnel 1 », « Dessiner depuis les planches », Enregistrer,
 * recharger : la parcelle (contour de 4 sommets) et ses trois planches sont là, et glisser l'intérieur
 * de la zone déplace les planches avec elle.
 * AUCUN appel réseau réel : tuiles servies par une fausse route, comme e2e/serre-zone.e2e.ts.
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
  await page.goto('/diagnostic/amorcer.html?jeu=placement&planches=1');
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

const planches = (page: Page) => page.locator(`[data-testid="${T.planche}"]`);
const contourTunnel = (page: Page) => page.locator(`[data-testid="${T.zoneContour}"][data-id="${ZONE_TUNNEL}"]`);

test('ordinateur : dessiner la parcelle depuis les planches, enregistrer, recharger : la parcelle et ses planches sont là', async ({ page, context }) => {
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

  await test.step('« Tunnel 1 » : « Dessiner depuis les planches », passe-pied 45 cm, trois planches de 30 m', async () => {
    await zoneTunnel(page).click();
    await expect(page.getByRole('button', { name: B.tracer, exact: true })).toBeVisible();
    await expect(page.getByLabel(C.passePied)).toHaveValue('45');
    await page.getByRole('button', { name: B.dessiner, exact: true }).click();
    await expect(planches(page)).toHaveCount(3);
    await expect(planches(page).first()).toHaveAttribute('data-longueur', '30');
    await expect(page.getByTestId(TC.edition)).toHaveAttribute('data-sommets', '4');
    await enregistrer(page);
  });

  await test.step('recharger : la parcelle et ses trois planches sont au plan', async () => {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await expect(contourTunnel(page)).toHaveCount(1);
    await expect(planches(page)).toHaveCount(3);
    await zoneTunnel(page).click();
    await expect(page.getByRole('button', { name: B.dessiner, exact: true })).toHaveCount(0);
    await expect(page.getByTestId(TP.poigneeRotation)).toBeVisible();
  });

  await test.step('glisser l’intérieur de la zone déplace les planches avec elle', async () => {
    const avant = await planches(page).first().getAttribute('data-x');
    const interieur = page.getByTestId(TP.interieur);
    const boite = await interieur.boundingBox();
    expect(boite).not.toBeNull();
    if (boite === null) return;
    const x = boite.x + boite.width / 2;
    const y = boite.y + boite.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 10, { steps: 5 });
    await page.mouse.up();
    await expect(planches(page).first()).not.toHaveAttribute('data-x', avant ?? '');
  });

  expect(reseau.ailleurs, 'aucune requête hors de localhost et de l’IGN').toEqual([]);
  expect(await violations(), 'aucune violation de la CSP').toEqual([]);
});

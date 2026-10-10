import { devices, expect, test, type Page } from '@playwright/test';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import { TESTID_3D_FILTRES as F } from '../src/ecrans/plan3d/test/contrat-filtres.ts';
import { HAUTEUR_TACTILE_MIN_PX, TESTID_TELEPHONE as T } from '../src/ecrans/plan3d/test/contrat-telephone.ts';

/**
 * T37b — le bouton « Filtres » de la vue 3D au téléphone (390 × 844), sur la démo en ligne
 * (`pnpm e2e:demo`, E2E_DEMO=1). Contrat : src/ecrans/plan3d/test/contrat-telephone.ts (section 3).
 *
 * Ce que vérifie ce test :
 *   1. au téléphone, un bouton « Filtres » (≥ 48 px de haut, aria-expanded) ouvre le panneau :
 *      légende, filtres T27b (familles, zones, cultures) et liste des planches ;
 *   2. replié, le panneau n'est pas visible mais la liste des planches reste dans la page ;
 *   3. RIEN n'est retiré : mêmes cases, mêmes planches qu'à la largeur d'un ordinateur ;
 *   4. les filtres travaillent au téléphone (décocher estompe des planches) ;
 *   5. sur un écran large, le panneau est affiché sans bouton « Filtres ».
 */

const DELAI_MS = 30_000;
const executablePath = process.env.CHROMIUM_PATH;

test.use({
  ...devices['Pixel 7'],
  viewport: { width: 390, height: 844 },
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
});

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
const bouton = (page: Page) => page.getByTestId(T.filtres);
const panneau = (page: Page) => page.getByTestId(T.panneauFiltres);

/** Ce que le panneau contient, relevé dans le DOM (visible ou non). */
async function contenu(page: Page): Promise<{ familles: string[]; zones: string[]; cultures: string[]; planches: string[] }> {
  const valeurs = (testid: string) => page.getByTestId(testid).evaluateAll((els) => els.map((e) => e.getAttribute('data-valeur') ?? ''));
  return {
    familles: await valeurs(F.famille),
    zones: await valeurs(F.zone),
    cultures: await valeurs(F.culture),
    planches: await page.getByTestId(T.elementListe).evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? '')),
  };
}

test('« Filtres » au téléphone : légende, filtres et liste des planches derrière un bouton, rien de retiré', async ({ page }) => {
  test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).tap();
  await expect(page.getByTestId(TESTID_3D.vue)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });

  await test.step('le bouton « Filtres » est là, bien tactile, et le panneau est replié', async () => {
    await expect(bouton(page)).toBeVisible();
    await expect(bouton(page)).toHaveAccessibleName('Filtres');
    await expect(bouton(page)).toHaveAttribute('aria-expanded', 'false');
    expect((await bouton(page).boundingBox())?.height ?? 0, 'zone tactile').toBeGreaterThanOrEqual(HAUTEUR_TACTILE_MIN_PX);
    await expect(panneau(page)).toBeHidden();
    await expect(page.getByTestId(T.legende)).toBeHidden();
    // La liste des planches (l'alternative texte de la toile) reste dans la page, repliée.
    expect(await page.getByTestId(T.elementListe).count(), 'planches de la liste, panneau replié').toBeGreaterThan(0);
  });

  const referenceTelephone = await contenu(page);

  await test.step('un tap sur « Filtres » ouvre légende, filtres des trois sortes et liste des planches', async () => {
    await bouton(page).tap();
    await expect(bouton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panneau(page)).toBeVisible();
    await expect(page.getByTestId(T.legende)).toBeVisible();
    await expect(page.getByTestId(F.famille).first()).toBeVisible();
    await expect(page.getByTestId(F.culture).first()).toBeVisible();
    await expect(page.getByTestId(F.zone).first()).toBeVisible();
    await expect(page.getByTestId(F.tout).first()).toBeVisible();
    await expect(page.getByTestId(F.rien).first()).toBeVisible();
    await expect(page.getByTestId(T.liste)).toBeVisible();
    await expect(page.getByTestId(T.liste).getByTestId(T.elementListe).first()).toBeAttached();
    // Le bouton et ce qu'il commande sont reliés.
    const id = await panneau(page).getAttribute('id');
    expect(id, 'le panneau a un id').toBeTruthy();
    await expect(bouton(page)).toHaveAttribute('aria-controls', id ?? '');
  });

  await test.step('une planche de la toile = une ligne de la liste, comme à la toile', async () => {
    const volumes = Number(await toile(page).getAttribute('data-volumes'));
    expect(volumes).toBeGreaterThan(0);
    expect(await page.getByTestId(T.elementListe).count(), 'une ligne par planche').toBe(volumes);
  });

  await test.step('les filtres travaillent au téléphone : « Rien » sur les familles estompe des planches, « Tout » les rend', async () => {
    await expect(toile(page)).toHaveAttribute('data-estompes', '0');
    await page.locator(`[data-testid="${F.rien}"][data-dimension="familles"]`).tap();
    await expect.poll(async () => Number(await toile(page).getAttribute('data-estompes')), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.locator(`[data-testid="${F.tout}"][data-dimension="familles"]`).tap();
    await expect(toile(page)).toHaveAttribute('data-estompes', '0', { timeout: 10_000 });
  });

  await test.step('un second tap sur « Filtres » referme le panneau', async () => {
    await bouton(page).tap();
    await expect(bouton(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panneau(page)).toBeHidden();
  });

  await test.step('rien n’est retiré au téléphone : mêmes cases et mêmes planches qu’à la largeur d’un ordinateur', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(panneau(page)).toBeVisible();
    await expect(bouton(page), 'pas de bouton « Filtres » sur un écran large').toBeHidden();
    const bureau = await contenu(page);
    expect(bureau.familles.length, 'familles au bureau').toBeGreaterThan(0);
    expect(referenceTelephone).toEqual(bureau);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(bouton(page)).toBeVisible();
    await expect(panneau(page)).toBeHidden();
    expect(await contenu(page)).toEqual(bureau);
  });
});

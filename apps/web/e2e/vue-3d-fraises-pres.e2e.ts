import { devices, expect, test, type Page } from '@playwright/test';
import { CAMPAGNE, cleTache, EMPLACEMENT } from '../src/ecrans/aujourdhui/test/ferme-du-jour.ts';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import type { Pose } from '../src/ecrans/plan3d/test/contrat-camera.ts';
import { TESTID_3D_TRAVAUX as T } from '../src/ecrans/plan3d/test/contrat-travaux.ts';
import { distance, projeter } from '../src/ecrans/plan3d/test/projection.ts';
import { arreterImages, BORNES_DEMO, demarrerImages, instrumenter3d, verifierGardeFous } from './fluidite-3d.ts';

/**
 * T37b — la gouttière de fraises vue de près, au téléphone (390 × 844), sur la démo en ligne avec
 * la DONNÉE D'ORIGINE (`pnpm e2e:demo`, E2E_DEMO=1) : le début de récolte des fraises y est en
 * retard de DIX jours (apps/web/src/demo/remplir.ts, comme dans le jeu de test). Depuis T37, la
 * démo les retardait d'un jour seulement pour que le premier « Suivant » ne mène pas devant la
 * gouttière (11 appels de dessin pour 9, 8 078 triangles pour 8 000) : T37b rétablit la donnée et
 * tient les garde-fous. Ce test SUPPOSE la donnée d'origine et le vérifie avant de mesurer.
 *
 * Ce que vérifie ce test :
 *   1. l'écran Aujourd'hui de la démo montre le début de récolte des fraises en retard de 10 jours
 *      (sinon le test échoue : il ne mesure pas la bonne chose) ;
 *   2. dans la 3D, « Suivant » (pas plus de fois qu'il n'y a de travaux) mène à la gouttière de
 *      fraises (S1-G01) : la caméra la regarde, de près, au centre de l'écran, ses plants sont en détail ;
 *   3. pendant les vols, à l'arrivée et pendant un glissé devant la gouttière : appels de dessin
 *      ≤ 9 et triangles ≤ 8 000 (BORNES_DEMO), JavaScript par image dans les bornes de T29b.
 */

const DELAI_MS = 30_000;
const RETARD_ORIGINE_JOURS = 10;
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
const lireNombre = async (page: Page, nom: string): Promise<number> => Number(await toile(page).getAttribute(nom));

async function lirePose(page: Page): Promise<Pose> {
  const json = await toile(page).getAttribute('data-camera');
  if (json === null) throw new Error('toile-3d sans data-camera');
  return JSON.parse(json) as Pose;
}

/** Le vol est fini : plus de vol en cours, et `vols` vols lancés en tout. */
async function attendreVol(page: Page, vols: number): Promise<void> {
  await expect(toile(page)).toHaveAttribute('data-vols', String(vols), { timeout: 5000 });
  await expect(toile(page)).toHaveAttribute('data-vol', 'non', { timeout: 5000 });
}

test('« Suivant » jusqu’à la gouttière de fraises (retard de dix jours), vue de près, garde-fous de fluidité tenus', async ({ page }) => {
  test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');
  test.setTimeout(240_000);
  await instrumenter3d(page);
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });

  await test.step('la donnée d’origine est en place : fraises en retard de dix jours', async () => {
    const carte = page.locator(`[data-testid="tache"][data-cle="${cleTache(CAMPAGNE.fraise, 'debut_recolte')}"]`);
    await expect(carte, 'le début de récolte des fraises est à l’écran Aujourd’hui').toBeVisible({ timeout: DELAI_MS });
    await expect(carte).toHaveAttribute('data-retard', 'oui');
    await expect(carte, 'retard d’origine (apps/web/src/demo/remplir.ts : ne pas le retoucher)').toContainText(`${String(RETARD_ORIGINE_JOURS)} jours de retard`);
  });

  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).tap();
  await expect(page.getByTestId(TESTID_3D.vue)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  await expect(page.getByTestId(T.panneau)).toBeVisible({ timeout: DELAI_MS });

  const gouttiere = EMPLACEMENT.s1g01;
  const nombre = await page.getByTestId(T.ligne).count();
  const avecPlanche = await page.getByTestId(T.ligne).evaluateAll((els) => els.filter((e) => (e as HTMLElement).dataset.planche !== '').length);
  expect(avecPlanche, 'la démo a des travaux sur des planches placées').toBeGreaterThan(1);
  const ligneFraises = page.locator(`[data-testid="${T.ligne}"][data-planche="${gouttiere}"]`);
  expect(await ligneFraises.count(), 'un travail du jour vise la gouttière de fraises (S1-G01, placée dans la démo)').toBeGreaterThan(0);

  await demarrerImages(page);

  await test.step('« Suivant » mène à la gouttière de fraises (vols compris dans la mesure)', async () => {
    let arrive = false;
    for (let k = 0; k < nombre && !arrive; k += 1) {
      const vols = await lireNombre(page, 'data-vols');
      await page.getByTestId(T.suivant).tap();
      await attendreVol(page, vols + 1);
      arrive = (await toile(page).getAttribute('data-planche-active')) === gouttiere;
    }
    expect(arrive, `« Suivant » atteint la gouttière de fraises en au plus ${String(nombre)} appuis`).toBe(true);
  });

  await test.step('à la gouttière : la caméra la regarde de près, ses plants sont en détail', async () => {
    const pose = await lirePose(page);
    const boite = await toile(page).boundingBox();
    if (boite === null) throw new Error('toile 3D sans boîte');
    const pastilles = JSON.parse((await toile(page).getAttribute('data-pastilles')) ?? '[]') as { planche: string; x: number; z: number }[];
    const p = pastilles.find((x) => x.planche === gouttiere);
    expect(p, 'pastille sur la gouttière').toBeDefined();
    if (p === undefined) return;
    expect(Math.hypot(pose.cible.x - p.x, pose.cible.z - p.z), 'la caméra regarde la gouttière (m)').toBeLessThan(0.5);
    const ecran = projeter(pose, await lireNombre(page, 'data-champ'), boite.width / boite.height, { x: p.x, y: 0.15, z: p.z });
    expect(ecran.profondeur, 'gouttière devant la caméra').toBeGreaterThan(0);
    expect(Math.abs(ecran.x), 'au centre de l’écran (x)').toBeLessThan(0.3);
    expect(Math.abs(ecran.y), 'au centre de l’écran (y)').toBeLessThan(0.3);
    expect(distance(pose.position, pose.cible), 'de près (m)').toBeLessThan(80);
    await expect.poll(() => lireNombre(page, 'data-plants'), { message: 'des plants en détail devant la gouttière', timeout: 10_000 }).toBeGreaterThan(0);
    // Relecture T37b (N1) : c'est la gouttière visée elle-même qui est en détail, pas seulement une voisine.
    await expect(toile(page), 'la gouttière visée est dessinée en détail').toHaveAttribute('data-active-en-detail', 'oui', { timeout: 10_000 });
  });

  await test.step('un glissé devant la gouttière : images dessinées dans les garde-fous du téléphone', async () => {
    const boite = await toile(page).boundingBox();
    if (boite === null) throw new Error('toile 3D sans boîte');
    const x0 = boite.x + boite.width / 2;
    const y0 = boite.y + boite.height / 3;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 40; i += 1) {
      await page.mouse.move(x0 + i * 3, y0 + ((i % 20) - 10) * 2);
      await page.evaluate(() => new Promise<void>((fini) => { requestAnimationFrame(() => { fini(); }); }));
    }
    await page.mouse.up();
    verifierGardeFous('gouttière de fraises vue de près, démo au téléphone', await arreterImages(page), BORNES_DEMO, 10);
  });
});

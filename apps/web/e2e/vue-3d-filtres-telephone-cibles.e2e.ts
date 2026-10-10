import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import { TESTID_3D_FILTRES as F } from '../src/ecrans/plan3d/test/contrat-filtres.ts';
import { HAUTEUR_TACTILE_MIN_PX, TESTID_TELEPHONE as T } from '../src/ecrans/plan3d/test/contrat-telephone.ts';

/**
 * T37b (relecture, B1) — le panneau « Filtres » au téléphone (390 × 844), sur la démo (`pnpm e2e:demo`) :
 *   1. un seul ascenseur, celui du panneau : le dernier « Aller à » et la dernière culture, amenés à
 *      l'écran, ne sont coupés par aucune liste défilante interne (le point touché au centre et près
 *      des bords est bien l'élément) ;
 *   2. toutes les cibles du panneau (boutons, cases, titres repliables) font au moins 48 px de haut ;
 *   3. sur ordinateur, les listes gardent leur hauteur bornée (affichage inchangé).
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

async function ouvrirFiltres(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await navigation(page).locator('button').filter({ hasText: 'Planches' }).click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).tap();
  await expect(page.getByTestId(TESTID_3D.vue)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  await page.getByTestId(T.filtres).tap();
  await expect(page.getByTestId(T.panneauFiltres)).toBeVisible();
}

/** Amené à l'écran, l'élément est celui qu'on touche en son centre et près de ses quatre bords. */
async function entierementTouchable(cible: Locator, nom: string): Promise<void> {
  await cible.scrollIntoViewIfNeeded();
  const r = await cible.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect();
    const points: [number, number][] = [
      [b.left + b.width / 2, b.top + b.height / 2],
      [b.left + 3, b.top + 3],
      [b.right - 3, b.top + 3],
      [b.left + 3, b.bottom - 3],
      [b.right - 3, b.bottom - 3],
    ];
    return points.map(([x, y]) => {
      const touche = document.elementFromPoint(x, y);
      return touche !== null && (touche === el || el.contains(touche));
    });
  });
  expect(r, `${nom} : touchable au centre et aux quatre coins (pas coupé par une liste défilante)`).toEqual([true, true, true, true, true]);
}

test('« Filtres » au téléphone : un seul ascenseur, rien de coupé, cibles de 48 px', async ({ page }) => {
  test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');
  test.setTimeout(180_000);
  await ouvrirFiltres(page);
  const panneau = page.getByTestId(T.panneauFiltres);

  await test.step('un seul ascenseur : aucune liste du panneau ne défile à l’intérieur du panneau', async () => {
    const internes = await panneau.evaluate((p) =>
      [...p.querySelectorAll('*')]
        .filter((e) => {
          const o = getComputedStyle(e).overflowY;
          return (o === 'auto' || o === 'scroll' || o === 'hidden') && e.scrollHeight > e.clientHeight + 1;
        })
        .map((e) => `${e.tagName}.${e.className} (${String(e.clientHeight)} px sur ${String(e.scrollHeight)})`),
    );
    expect(internes, 'listes défilantes ou coupées dans le panneau').toEqual([]);
  });

  await test.step('le dernier « Aller à » et la dernière culture ne sont pas coupés', async () => {
    expect(await panneau.getByTestId('aller-zone-3d').count()).toBeGreaterThan(3);
    await entierementTouchable(panneau.getByTestId('aller-zone-3d').last(), 'dernier « Aller à »');
    const derniereCulture = panneau.locator('label').filter({ has: page.getByTestId(F.culture) }).last();
    await entierementTouchable(derniereCulture, 'dernière culture');
    await entierementTouchable(panneau.locator('label').filter({ has: page.getByTestId(F.zone) }).last(), 'dernière zone');
  });

  await test.step('toutes les cibles du panneau font au moins 48 px de haut', async () => {
    const hauteurs = await panneau.locator('button, summary, label').evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => ({ texte: (e.textContent ?? '').trim().slice(0, 40), h: e.getBoundingClientRect().height })),
    );
    expect(hauteurs.length, 'cibles du panneau').toBeGreaterThan(10);
    const petites = hauteurs.filter((c) => c.h < HAUTEUR_TACTILE_MIN_PX - 0.5);
    expect(petites, 'cibles de moins de 48 px').toEqual([]);
  });

  await test.step('sur ordinateur, les listes gardent leur hauteur bornée', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const debordantes = await panneau.locator('ul.plan3d-cases-defilantes').evaluateAll((els) => els.map((e) => getComputedStyle(e).overflowY));
    expect(debordantes.length).toBeGreaterThan(0);
    for (const o of debordantes) expect(o).toBe('auto');
  });
});

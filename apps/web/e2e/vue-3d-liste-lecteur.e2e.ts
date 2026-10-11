import { devices, expect, test } from '@playwright/test';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import { TESTID_TELEPHONE as T } from '../src/ecrans/plan3d/test/contrat-telephone.ts';

/**
 * T37c — la liste des planches, alternative texte de la toile, reste lisible par un lecteur d'écran
 * quand le panneau est replié au téléphone (390 × 844), sur la démo en ligne (`pnpm e2e:demo`).
 * Replié, le panneau n'est pas visible (T37b), mais la liste est « visuellement masquée » : dans
 * l'arbre d'accessibilité, ni `hidden` ni `display: none` ni `visibility: hidden`.
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

test('panneau replié au téléphone : la liste des planches reste dans l’arbre d’accessibilité', async ({ page }) => {
  test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await page.getByRole('navigation', { name: 'Navigation principale' }).locator('button').filter({ hasText: 'Planches' }).click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).tap();
  await expect(page.getByTestId(TESTID_3D.vue)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  await expect(page.getByTestId(T.filtres)).toHaveAttribute('aria-expanded', 'false');

  const volumes = Number(await page.getByTestId(TESTID_3D.toile).getAttribute('data-volumes'));
  expect(volumes).toBeGreaterThan(0);

  // Les rôles ARIA de Playwright ignorent ce qui est caché à l'arbre d'accessibilité (hidden, display: none, visibility: hidden).
  const liste = page.getByRole('list', { name: /^Planches et cultures/ });
  await expect(liste, 'la liste des planches est dans l’arbre d’accessibilité').toHaveCount(1);
  await expect(liste.getByRole('listitem')).toHaveCount(volumes);

  // Elle n'est pas retirée par `hidden` : aucun ancêtre n'a l'attribut, aucun n'est en display: none ni visibility: hidden.
  const masquages = await page.getByTestId(T.liste).evaluate((el) => {
    const fautes: string[] = [];
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (n.hasAttribute('hidden')) fautes.push(`${n.tagName} hidden`);
      if (style.display === 'none') fautes.push(`${n.tagName} display:none`);
      if (style.visibility === 'hidden') fautes.push(`${n.tagName} visibility:hidden`);
    }
    return fautes;
  });
  expect(masquages, 'rien ne retire la liste de l’arbre d’accessibilité').toEqual([]);

  // Et le panneau, lui, reste invisible à l'œil (T37b) : replié, ni légende ni filtres.
  await expect(page.getByTestId(T.panneauFiltres)).toBeHidden();
  await expect(page.getByTestId(T.legende)).toBeHidden();
});

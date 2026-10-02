import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { TESTID, TEXTE_BANDEAU, TEXTE_REINITIALISER } from '../src/demo/test/contrat.ts';

/**
 * T25 — la démo en ligne, de bout en bout, sur `dist-demo/` (build de la démo) servi par
 * `vite preview` (playwright.demo.config.ts, `pnpm e2e:demo`). Contrat : src/demo/test/contrat.ts.
 *
 * Aucun amorçage, aucune session posée par le test : c'est le premier lancement d'un visiteur
 * (contexte de navigateur neuf à chaque test). Critères du ticket :
 *   - pas d'écran de connexion, bandeau « Démo — données fictives », Aujourd'hui montre des
 *     tâches de la ferme fictive ;
 *   - aucune requête hors de l'origine de la démo, aucune vers /api ni vers un service PowerSync
 *     (contexte entier écouté : page, workers et service worker compris) ;
 *   - « Fait » sur une tâche, rechargement : elle reste faite ; « Réinitialiser la démo » (avec
 *     confirmation, annulable) : elle revient ;
 *   - rechargement hors ligne, une fois le service worker aux commandes : la démo s'ouvre.
 */

const DELAI_BASE_MS = 30_000;

test.use({ actionTimeout: 15_000 });

const ecran = (page: Page) => page.getByTestId('aujourdhui');
const taches = (page: Page) => page.getByTestId('tache');
const tache = (page: Page, cle: string) => page.locator(`[data-testid="tache"][data-cle="${cle}"]`);
const faisables = (page: Page) => taches(page).filter({ has: page.getByRole('button', { name: /^Marquer fait/ }) });

/** Requêtes de tout le contexte (page, workers, service worker) : URL de chacune. */
function ecouterRequetes(context: BrowserContext): string[] {
  const vues: string[] = [];
  context.on('request', (requete) => {
    vues.push(requete.url());
  });
  return vues;
}

/** Première visite : la démo s'affiche sur Aujourd'hui, base prête, tâches présentes. */
async function ouvrirLaDemo(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_BASE_MS });
  await expect(ecran(page)).toBeVisible();
  await expect(taches(page).first()).toBeVisible({ timeout: DELAI_BASE_MS });
}

test('premier lancement : pas de connexion, bandeau de démo, tâches de la ferme fictive', async ({ page }) => {
  await ouvrirLaDemo(page);
  await expect(page.getByTestId('carte-connexion'), 'aucun écran de connexion').toHaveCount(0);
  await expect(page.getByTestId(TESTID.bandeau)).toBeVisible();
  await expect(page.getByTestId(TESTID.bandeau)).toHaveText(TEXTE_BANDEAU);
  await expect(page.getByRole('button', { name: TEXTE_REINITIALISER })).toBeVisible();
  expect(await taches(page).count(), 'tâches de la ferme fictive').toBeGreaterThan(0);
});

test('aucune requête hors de l’origine, ni vers /api, ni vers PowerSync', async ({ page, context, baseURL }) => {
  const vues = ecouterRequetes(context);
  await ouvrirLaDemo(page);
  // Le temps que la synchro, si elle était branchée, se manifeste (connexion, jeton, flux).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForTimeout(2000);
  const origine = new URL(baseURL ?? 'http://localhost').origin;
  expect(vues.length, 'des requêtes ont bien été vues (l’appli elle-même)').toBeGreaterThan(0);
  const autres = vues.filter((u) => {
    const url = new URL(u);
    return !['data:', 'blob:', 'about:'].includes(url.protocol) && url.origin !== origine;
  });
  expect(autres, 'requêtes vers une autre origine').toEqual([]);
  const interdites = vues.filter((u) => {
    const url = new URL(u);
    return url.pathname === '/api' || url.pathname.startsWith('/api/') || /powersync/i.test(url.hostname) || /powersync/i.test(url.pathname.replace(/^\/assets\//, ''));
  });
  expect(interdites, 'requêtes vers /api ou un service PowerSync').toEqual([]);
});

test('« Fait » reste après rechargement ; « Réinitialiser la démo » la fait revenir', async ({ page }) => {
  test.setTimeout(120_000);
  await ouvrirLaDemo(page);
  const cible = faisables(page).first();
  await expect(cible).toBeVisible();
  const cle = await cible.getAttribute('data-cle');
  expect(cle, 'data-cle de la tâche choisie').not.toBeNull();
  if (cle === null) return;

  await test.step('« Fait » : la tâche part de la liste', async () => {
    await tache(page, cle).getByRole('button', { name: /^Marquer fait/ }).click();
    await expect(tache(page, cle)).toHaveCount(0);
    // Attendre la fin de l’écriture (bandeau d’annulation) avant de recharger, comme aujourdhui.e2e.ts.
    await expect(page.getByTestId('saisie-annulable')).toBeVisible();
  });

  await test.step('rechargement : la tâche reste faite', async () => {
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_BASE_MS });
    await expect(taches(page).first()).toBeVisible({ timeout: DELAI_BASE_MS });
    await expect(tache(page, cle)).toHaveCount(0);
    await expect(page.getByTestId('carte-connexion')).toHaveCount(0);
  });

  await test.step('« Réinitialiser la démo » puis « Annuler » : rien ne change', async () => {
    await page.getByTestId(TESTID.reinitialiser).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByTestId(TESTID.annuler).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(tache(page, cle)).toHaveCount(0);
  });

  await test.step('« Réinitialiser la démo » puis confirmation : la tâche revient', async () => {
    await page.getByTestId(TESTID.reinitialiser).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByTestId(TESTID.confirmer).click();
    await expect(tache(page, cle)).toHaveCount(1, { timeout: DELAI_BASE_MS });
    await expect(page.getByTestId(TESTID.bandeau)).toBeVisible();
    // Et elle revient aussi après rechargement (la base est bien remplie à nouveau, pas seulement l'écran).
    await page.reload();
    await expect(tache(page, cle)).toHaveCount(1, { timeout: DELAI_BASE_MS });
  });
});

test('rechargement hors ligne : la démo s’ouvre', async ({ page, context }) => {
  await ouvrirLaDemo(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: DELAI_BASE_MS });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_BASE_MS });
  await expect(page.getByTestId(TESTID.bandeau)).toBeVisible();
  await expect(taches(page).first()).toBeVisible({ timeout: DELAI_BASE_MS });
  await expect(page.getByTestId('carte-connexion')).toHaveCount(0);
});

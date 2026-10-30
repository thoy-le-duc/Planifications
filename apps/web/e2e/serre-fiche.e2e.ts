import { devices, expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ENTREE_PLACEMENT, TESTID_PLACEMENT as T } from '../src/ecrans/placement/test/contrat.ts';
import { TESTID_CASES as TK } from '../src/ecrans/placement/test/contrat-cases.ts';
import { BOUTONS_SERRE as B, CHAMPS_SERRE as C, TESTID_SERRE as TS } from '../src/ecrans/placement/test/contrat-serre.ts';
import { fermePlacement } from '../src/ecrans/placement/test/ferme-placement.ts';
import { ralentirCpu, surveillerCsp } from './outils.ts';
import { deverrouillerPlan } from './deverrouiller-plan.ts';

/**
 * T89 (critère 5) — créer la serre à légumes au téléphone, enregistrer, recharger : tout est en place ; la fiche s'affiche dans le budget.
 * Chromium 390 × 844 tactile, CPU ralenti ×4, avec la ferme du placement (?jeu=placement : gérant, sans point de départ). Contrat du DOM :
 * src/ecrans/placement/test/contrat-serre.ts. AUCUN appel réseau réel : tuiles servies par une fausse route.
 *
 *   Poser le point de départ, « Ajouter » → « Serre ou tunnel », nom « Serre à légumes », 6 chapelles, 3 tronçons : résumé
 *   « 57,6 × 128,8 m, 18 zones, 144 planches » ; « Créer », « Enregistrer », recharger : 18 cases nommées, 144 planches (+ PC-01) au plan.
 *   Budget : la fiche est visible moins de 300 ms après le tap sur « Serre ou tunnel » (CPU ×4, morceau chargé à la demande compris).
 *
 * NON EXÉCUTÉ à l'écriture (pas de Chromium ni de build des essais dans le conteneur du testeur).
 */

const DELAI_AMORCAGE_MS = 120_000;
const BUDGET_FICHE_MS = 300;
/** PNG de 1 × 1 px. */
const IMAGE_TUILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const executablePath = process.env.CHROMIUM_PATH;

test.use({
  ...devices['Pixel 7'],
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  launchOptions: executablePath ? { executablePath } : {},
});

async function intercepter(context: BrowserContext): Promise<string[]> {
  const ailleurs: string[] = [];
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://data.geopf.fr') {
        await route.fulfill({ status: 200, contentType: 'image/png', body: IMAGE_TUILE });
        return;
      }
      ailleurs.push(url.href);
      await route.abort('blockedbyclient');
    },
  );
  return ailleurs;
}

const ferme = fermePlacement();
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const editeur = (page: Page) => page.getByTestId(T.editeur);
const fiche = (page: Page): Locator => page.getByTestId(TS.fiche);
const champ = (page: Page, nom: string): Locator => fiche(page).getByLabel(nom, { exact: true });
const cases = (page: Page) => page.locator(`[data-testid="${TK.casesSerre}"]`);

async function amorcerEtOuvrir(page: Page): Promise<void> {
  await page.goto('/diagnostic/amorcer.html?jeu=placement');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { erreur?: string; fermeId?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
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
  await onglet(page, 'Ferme').tap();
  await page.getByRole('button', { name: new RegExp(ENTREE_PLACEMENT) }).tap();
  await expect(editeur(page)).toBeVisible({ timeout: 15_000 });
  await deverrouillerPlan(page);
  await expect(editeur(page)).toHaveAttribute('data-mode', 'edition');
}

test('téléphone : la serre à légumes en une fiche, enregistrée, rechargée ; la fiche tient dans le budget', async ({ page, context }) => {
  test.setTimeout(240_000);
  const ailleurs = await intercepter(context);
  const violations = await surveillerCsp(page);
  await amorcerEtOuvrir(page);
  await ouvrirEditeur(page);

  await test.step('point de départ : la position de la ferme', async () => {
    await page.getByRole('button', { name: 'Utiliser la position de la ferme' }).tap();
    const f = page.locator(`[role="alertdialog"], [role="dialog"]:not([data-testid="${T.editeur}"])`).filter({ hasText: /point de départ/i });
    await f.getByRole('button', { name: 'Confirmer' }).tap();
    await expect(editeur(page)).toHaveAttribute('data-origine', '44,1.5');
  });

  await test.step('« Ajouter » → « Serre ou tunnel » : la fiche s’affiche en moins de 300 ms (CPU ×4)', async () => {
    await page.getByRole('button', { name: B.ajouter, exact: true }).tap();
    await ralentirCpu(page);
    const debut = Date.now();
    await page.getByRole('button', { name: B.serreOuTunnel, exact: true }).tap();
    await expect(fiche(page)).toBeVisible();
    const duree = Date.now() - debut;
    expect(duree, `la fiche s’affiche en ${String(duree)} ms (tap compris)`).toBeLessThan(BUDGET_FICHE_MS);
  });

  await test.step('la fiche : serre à légumes, 6 chapelles, 3 tronçons → résumé calculé', async () => {
    await champ(page, C.nom).fill('Serre à légumes');
    await champ(page, C.nbChapelles).fill('6');
    await champ(page, C.nbTroncons).fill('3');
    await expect(page.getByTestId(TS.resume)).toContainText('57,6 × 128,8 m, 18 zones, 144 planches');
  });

  await test.step('« Créer » puis « Enregistrer » : un seul enregistrement, « Annuler » proposé', async () => {
    await fiche(page).getByRole('button', { name: B.creer, exact: true }).tap();
    await expect(fiche(page)).toHaveCount(0);
    await expect(cases(page)).toHaveCount(18);
    await page.getByRole('button', { name: B.enregistrer, exact: true }).tap();
    await expect(page.getByTestId(T.annuler), 'Annuler proposé après l’enregistrement').toBeVisible({ timeout: 30_000 });
  });

  await test.step('recharger : les 18 cases nommées et les 144 planches sont au plan', async () => {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await expect(cases(page)).toHaveCount(18);
    await expect(cases(page).first()).toContainText('Serre à légumes');
    await expect(page.getByTestId(T.planche)).toHaveCount(145);
    await expect(page.getByTestId(T.batiment).filter({ hasText: 'Serre à légumes' })).toHaveCount(1);
  });

  expect(ailleurs, 'aucune requête hors de localhost et de l’IGN').toEqual([]);
  expect(await violations(), 'aucune violation de la CSP').toEqual([]);
});

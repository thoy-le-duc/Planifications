import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { versGeographique } from '@planif/core';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ENTREE_PLACEMENT, TESTID_PLACEMENT as T, type ModuleTuiles } from '../src/ecrans/placement/test/contrat.ts';
import { MOISSAC, MOTIF_INDISPONIBLE, NOM_CHAMP_ADRESSE, NUMERO_MOISSAC, reponseGeocodage, RUE_MOISSAC, TESTID_ADRESSE as A, type ModuleAdresse } from '../src/ecrans/placement/test/contrat-adresse.ts';
import { fermePlacement, POSITION, ZONE_SITE2 } from '../src/ecrans/placement/test/ferme-placement.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T28h — chercher une adresse, voir large, plusieurs sites, de bout en bout, sur ordinateur
 * (Chromium 1280 × 800). Contrat : src/ecrans/placement/test/contrat-adresse.ts.
 *
 * AUCUNE requête réelle à l'IGN : `page.route` répond à la place de data.geopf.fr (tuiles : PNG de
 * 1 × 1 px ; géocodage : GeoJSON fabriqué ici). Toute autre requête hors de localhost est bloquée.
 * Jeu de données : `/diagnostic/amorcer.html?jeu=placement&origine=1&sites=2` (ferme placée, second
 * site « Verger nord » à 20 km ; `sites=2` à brancher dans src/donnees/amorcer.ts sur l'option
 * `deuxSites` de ferme-placement.ts).
 *
 *   1. Recherche « Moissac » tapée avec des frappes rapprochées : une seule requête de géocodage ;
 *      choix d'une proposition : la carte montre le lieu (tuiles demandées autour de Moissac, au zoom
 *      du type de résultat) ; l'origine du plan n'a pas bougé ; CSP sans violation.
 *   2. Service muet : message, éditeur utilisable.
 *   3. Recul à 6 ; « Aller à » le second site ; « Toute la ferme ».
 */

const CHEMIN_TUILES = '../src/ecrans/placement/tuiles.ts';
const CHEMIN_ADRESSE = '../src/ecrans/placement/adresse.ts';
const DELAI_AMORCAGE_MS = 120_000;
const IMAGE_TUILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const executablePath = process.env.CHROMIUM_PATH;
test.use({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions: executablePath ? { executablePath } : {} });

interface Reseau {
  readonly tuiles: string[];
  readonly geocodage: string[];
  readonly ailleurs: string[];
}

type Comportement = 'normal' | 'muet';

async function intercepter(context: BrowserContext, comportement: () => Comportement): Promise<Reseau> {
  const reseau: Reseau = { tuiles: [], geocodage: [], ailleurs: [] };
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://data.geopf.fr' && url.pathname.startsWith('/geocodage/')) {
        reseau.geocodage.push(url.href);
        if (comportement() === 'muet') {
          await route.abort('internetdisconnected');
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(reponseGeocodage([MOISSAC, RUE_MOISSAC, NUMERO_MOISSAC])),
        });
        return;
      }
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

const ferme = fermePlacement({ origine: true, deuxSites: true });
const editeur = (page: Page) => page.getByTestId(T.editeur);

async function amorcerEtOuvrir(page: Page): Promise<void> {
  await page.goto('/diagnostic/amorcer.html?jeu=placement&origine=1&sites=2');
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
  await page.getByRole('navigation', { name: 'Navigation principale' }).locator('button').filter({ hasText: 'Ferme' }).click();
  await page.getByRole('button', { name: new RegExp(ENTREE_PLACEMENT) }).click();
  await expect(editeur(page)).toBeVisible({ timeout: 15_000 });
  await expect(editeur(page)).toHaveAttribute('data-mode', 'edition');
}

async function centreDe(page: Page): Promise<{ latitude: number; longitude: number }> {
  const [latitude = Number.NaN, longitude = Number.NaN] = ((await editeur(page).getAttribute('data-centre')) ?? '').split(',').map(Number);
  return { latitude, longitude };
}

test('ordinateur : recherche d’adresse (réseau simulé), recul, « Aller à » le second site, « Toute la ferme »', async ({ page, context }) => {
  test.setTimeout(240_000);
  let comportement: Comportement = 'normal';
  const tuilesMod = (await import(/* @vite-ignore */ CHEMIN_TUILES)) as ModuleTuiles;
  const adresse = (await import(/* @vite-ignore */ CHEMIN_ADRESSE)) as ModuleAdresse;
  const reseau = await intercepter(context, () => comportement);
  const violations = await surveillerCsp(page);
  await amorcerEtOuvrir(page);
  const origineAvant = await editeur(page).getAttribute('data-origine');
  expect(origineAvant).toBe(`${String(POSITION.latitude)},${String(POSITION.longitude)}`);
  const champ = page.getByLabel(NOM_CHAMP_ADRESSE, { exact: true });

  await test.step('« Moissac » tapé vite : une seule requête ; le tap sur la commune amène la carte sur Moissac', async () => {
    await expect(champ).toBeVisible();
    const taille = await champ.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(taille, 'gros caractères (gants)').toBeGreaterThanOrEqual(16);
    await champ.pressSequentially('Moissac', { delay: 40 });
    await expect(page.getByTestId(A.proposition)).toHaveCount(3);
    expect(reseau.geocodage, 'une seule requête, pas une par frappe').toHaveLength(1);
    const url = new URL(reseau.geocodage[0] ?? '');
    expect(url.searchParams.get('q')).toBe('Moissac');
    expect(url.searchParams.get('limit')).toBe('5');
    await page.getByTestId(A.proposition).first().click();
    await expect.poll(async () => Math.abs((await centreDe(page)).latitude - MOISSAC.latitude)).toBeLessThan(1e-4);
    const c = await centreDe(page);
    expect(Math.abs(c.longitude - MOISSAC.longitude)).toBeLessThan(1e-4);
    const zoom = adresse.zoomPourType('municipality');
    await expect(editeur(page)).toHaveAttribute('data-zoom', String(zoom));
    // La carte montre le lieu : la tuile de Moissac, au zoom de la commune, est demandée et affichée.
    const attendue = tuilesMod.tuileDe(MOISSAC, zoom);
    await expect
      .poll(() => reseau.tuiles.map((u) => new URL(u).searchParams).some((p) => p.get('TILEMATRIX') === String(zoom) && p.get('TILECOL') === String(attendue.colonne) && p.get('TILEROW') === String(attendue.ligne)))
      .toBe(true);
    await expect
      .poll(() => page.getByTestId(T.tuile).evaluateAll((imgs) => imgs.length > 0 && imgs.every((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0)))
      .toBe(true);
  });

  await test.step('l’origine du plan n’a pas bougé : la recherche déplace seulement la vue', async () => {
    await expect(editeur(page)).toHaveAttribute('data-origine', origineAvant ?? '');
  });

  await test.step('numéro de rue : vue serrée', async () => {
    await champ.fill('');
    await champ.pressSequentially('12 rue de la République Moissac', { delay: 20 });
    await expect(page.getByTestId(A.proposition)).toHaveCount(3);
    await page.getByTestId(A.proposition).nth(2).click();
    await expect(editeur(page)).toHaveAttribute('data-zoom', String(adresse.zoomPourType('housenumber')));
  });

  await test.step('service muet : message clair, éditeur utilisable', async () => {
    comportement = 'muet';
    await champ.fill('');
    await champ.pressSequentially('Toulouse', { delay: 20 });
    await expect(page.getByTestId(A.message)).toHaveText(MOTIF_INDISPONIBLE);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zoom arrière' })).toBeEnabled();
    comportement = 'normal';
  });

  await test.step('recul : « Zoom arrière » jusqu’à 6', async () => {
    const arriere = page.getByRole('button', { name: 'Zoom arrière' });
    for (let i = 0; i < 20 && (await arriere.isEnabled()); i++) await arriere.click();
    await expect(editeur(page)).toHaveAttribute('data-zoom', '6');
    await expect(arriere).toBeDisabled();
  });

  await test.step('« Aller à » le second site à 20 km, puis « Toute la ferme »', async () => {
    await page.getByTestId(A.allerA).selectOption(ZONE_SITE2);
    const attendu = versGeographique(POSITION, { x: 20120, y: 15 });
    await expect.poll(async () => Math.abs((await centreDe(page)).longitude - attendu.longitude)).toBeLessThan(1e-4);
    await expect(editeur(page)).toHaveAttribute('data-zoom', '19');
    await page.getByTestId(A.toutelaFerme).click();
    const milieu = versGeographique(POSITION, { x: 10120, y: 15 });
    await expect.poll(async () => Math.abs((await centreDe(page)).longitude - milieu.longitude)).toBeLessThan(1e-4);
    await expect(editeur(page)).toHaveAttribute('data-zoom', '12');
    await expect(editeur(page)).toHaveAttribute('data-origine', origineAvant ?? '');
  });

  expect(reseau.ailleurs, 'aucune requête hors Géoplateforme').toEqual([]);
  expect(await violations(), 'violations de la CSP').toEqual([]);
});

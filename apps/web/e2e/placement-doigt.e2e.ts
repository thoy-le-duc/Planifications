import { devices, expect, test, type BrowserContext, type CDPSession, type Locator, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ENTREE_PLACEMENT, TESTID_PLACEMENT as T } from '../src/ecrans/placement/test/contrat.ts';
import { BOUTONS_DOIGT, TAILLE_MIN_CIBLE_PX, TESTID_DOIGT as D } from '../src/ecrans/placement/test/contrat-doigt.ts';
import { fermePlacement } from '../src/ecrans/placement/test/ferme-placement.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T28k — placement au doigt sur le téléphone, de bout en bout (Chromium 390 × 844, écran tactile),
 * avec la ferme du placement (?jeu=placement : gérant, sans point de départ). Contrat du DOM :
 * src/ecrans/placement/test/contrat-doigt.ts (et contrat.ts).
 *
 * AUCUN appel réseau réel : tuiles de data.geopf.fr servies par une fausse route, toute autre
 * requête hors de localhost bloquée.
 *
 *   Poser le point de départ d'un tap, ajouter une serre, la glisser au doigt, la tourner à deux
 *   doigts puis d'un bouton « +5° », enregistrer, recharger → position et cap enregistrés.
 *   La page ne défile pas pendant un geste sur la carte ; les boutons du bas font au moins 44 px.
 */

const DELAI_AMORCAGE_MS = 120_000;
/** PNG de 1 × 1 px. */
const IMAGE_TUILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
/** m/px au zoom 19, à 44° N. */
const MPP_19 = 0.214782;

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
const plan = (page: Page) => page.getByTestId(T.plan);
const batiments = (page: Page) => page.getByTestId(T.batiment);
const fenetre = (page: Page, texte: RegExp): Locator =>
  page.locator(`[role="alertdialog"], [role="dialog"]:not([data-testid="${T.editeur}"])`).filter({ hasText: texte });

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
  // Téléphone : le gérant édite (T28k), plus de « à faire sur ordinateur ».
  await expect(editeur(page)).toHaveAttribute('data-ecran', 'telephone');
  await expect(editeur(page)).toHaveAttribute('data-mode', 'edition');
}

async function centreDe(l: Locator): Promise<{ x: number; y: number }> {
  const b = await l.boundingBox();
  if (b === null) throw new Error('élément sans boîte');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const nombre = async (l: Locator, attribut: string): Promise<number> => Number(await l.getAttribute(attribut));

// ── Doigts (CDP : de vrais événements tactiles, un identifiant par doigt) ────────────────────

interface Pt {
  readonly x: number;
  readonly y: number;
}
const pt = (x: number, y: number): Pt => ({ x, y });

async function toucher(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', doigts: readonly (Pt & { id: number })[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : doigts.map((d) => ({ x: d.x, y: d.y, id: d.id })) });
}

async function glisser(cdp: CDPSession, de: Pt, vers: Pt): Promise<void> {
  await toucher(cdp, 'touchStart', [{ ...de, id: 1 }]);
  for (let k = 1; k <= 8; k++) await toucher(cdp, 'touchMove', [{ x: de.x + ((vers.x - de.x) * k) / 8, y: de.y + ((vers.y - de.y) * k) / 8, id: 1 }]);
  await toucher(cdp, 'touchEnd', []);
}

/** Deux doigts autour de `c`, à `rayon` px, la droite qui les joint tournant de `deg` degrés (horaire à l'écran). */
async function tourner(cdp: CDPSession, c: Pt, rayon: number, deg: number): Promise<void> {
  const aux = (angle: number): (Pt & { id: number })[] => {
    const r = (angle * Math.PI) / 180;
    return [
      { x: c.x - rayon * Math.cos(r), y: c.y - rayon * Math.sin(r), id: 1 },
      { x: c.x + rayon * Math.cos(r), y: c.y + rayon * Math.sin(r), id: 2 },
    ];
  };
  await toucher(cdp, 'touchStart', aux(0));
  for (let k = 1; k <= 12; k++) await toucher(cdp, 'touchMove', aux((deg * k) / 12));
  await toucher(cdp, 'touchEnd', []);
}

test('téléphone : point de départ, serre, glisser, tourner à deux doigts, enregistrer → position et cap enregistrés', async ({ page, context }) => {
  test.setTimeout(240_000);
  const ailleurs = await intercepter(context);
  const violations = await surveillerCsp(page);
  await amorcerEtOuvrir(page);
  await ouvrirEditeur(page);
  const cdp = await context.newCDPSession(page);

  await test.step('la page ne défile pas sur la carte (touch-action: none)', async () => {
    expect(await plan(page).evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
  });

  let origine = '';
  await test.step('poser le point de départ d’un tap sur la photo, avec confirmation', async () => {
    await expect(editeur(page)).toHaveAttribute('data-origine', '');
    const milieu = await centreDe(plan(page));
    await page.touchscreen.tap(milieu.x, milieu.y);
    const f = fenetre(page, /point de départ/i);
    await expect(f).toBeVisible();
    await f.getByRole('button', { name: 'Confirmer' }).tap();
    await expect(f).toHaveCount(0);
    await expect(editeur(page)).not.toHaveAttribute('data-origine', '');
    origine = (await editeur(page).getAttribute('data-origine')) ?? '';
  });

  const serre = batiments(page).first();
  await test.step('ajouter une serre : formulaire, « Poser », tap sur la photo', async () => {
    await page.getByRole('button', { name: 'Nouveau bâtiment', exact: true }).tap();
    const f = fenetre(page, /Nouveau bâtiment/);
    await expect(f).toBeVisible();
    await f.getByLabel('Type', { exact: true }).selectOption('serre_tunnel');
    await f.getByLabel('Nom', { exact: true }).fill('Serre M3');
    await f.getByLabel('Longueur (m)', { exact: true }).fill('40');
    await f.getByLabel('Largeur (m)', { exact: true }).fill('8');
    await f.getByLabel('Hauteur (m)', { exact: true }).fill('3.5');
    await f.getByRole('button', { name: 'Poser', exact: true }).tap();
    const milieu = await centreDe(plan(page));
    await page.touchscreen.tap(milieu.x, milieu.y);
    await expect(batiments(page)).toHaveCount(1);
    await expect(serre).toHaveAttribute('aria-pressed', 'true');
  });

  let x0 = 0;
  let y0 = 0;
  await test.step('la glisser au doigt : 60 px vers l’est, la page ne défile pas', async () => {
    x0 = await nombre(serre, 'data-x');
    y0 = await nombre(serre, 'data-y');
    const c = await centreDe(serre);
    await glisser(cdp, c, pt(c.x + 60, c.y));
    await expect(editeur(page)).toHaveAttribute('data-geste', 'aucun');
    expect(await nombre(serre, 'data-x')).toBeCloseTo(x0 + 60 * MPP_19, 0);
    expect(await nombre(serre, 'data-y')).toBeCloseTo(y0, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  let cap = 0;
  await test.step('la tourner à deux doigts de 40°', async () => {
    const c = await centreDe(plan(page));
    await tourner(cdp, c, 80, 40);
    await expect(editeur(page)).toHaveAttribute('data-geste', 'aucun');
    cap = await nombre(serre, 'data-orientation');
    expect(Math.abs(cap - 40)).toBeLessThanOrEqual(2);
    expect(await nombre(serre, 'data-x')).toBeCloseTo(x0 + 60 * MPP_19, 0);
  });

  await test.step('boutons du bas : « Tourner +5° » (zone d’au moins 44 px), « Enregistrer » aussi', async () => {
    const plus = page.getByTestId(D.tournerPlus);
    await expect(plus).toHaveAccessibleName(BOUTONS_DOIGT.plus);
    for (const b of [plus, page.getByTestId(D.tournerMoins), page.getByRole('button', { name: 'Enregistrer', exact: true })]) {
      const boite = await b.boundingBox();
      expect(boite?.width ?? 0).toBeGreaterThanOrEqual(TAILLE_MIN_CIBLE_PX);
      expect(boite?.height ?? 0).toBeGreaterThanOrEqual(TAILLE_MIN_CIBLE_PX);
    }
    await plus.tap();
    expect(await nombre(serre, 'data-orientation')).toBeCloseTo(cap + 5, 1);
    cap += 5;
  });

  const x = await nombre(serre, 'data-x');
  const y = await nombre(serre, 'data-y');
  await test.step('enregistrer', async () => {
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).tap();
    await expect(page.getByTestId(T.annuler)).toBeVisible();
  });

  await test.step('recharger : position et cap enregistrés', async () => {
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await expect(editeur(page)).toHaveAttribute('data-origine', origine);
    await expect(batiments(page)).toHaveCount(1);
    const relue = batiments(page).first();
    expect(await nombre(relue, 'data-x')).toBeCloseTo(x, 2);
    expect(await nombre(relue, 'data-y')).toBeCloseTo(y, 2);
    expect(await nombre(relue, 'data-orientation')).toBeCloseTo(cap, 1);
  });

  expect(ailleurs, 'aucun appel réseau hors de localhost et des tuiles').toEqual([]);
  expect(await violations(), 'violations de la CSP').toEqual([]);
});

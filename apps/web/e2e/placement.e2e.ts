import { devices, expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { versLocal } from '@planif/core';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ENTREE_PLACEMENT, MESSAGES_PLACEMENT, TESTID_PLACEMENT as T, type ModuleTuiles } from '../src/ecrans/placement/test/contrat.ts';
import { fermePlacement, POSITION } from '../src/ecrans/placement/test/ferme-placement.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T28b — éditeur de placement sur photo aérienne, de bout en bout, sur ordinateur (Chromium
 * 1280 × 800), avec la ferme du placement (src/ecrans/placement/test/ferme-placement.ts : gérant,
 * sans point de départ). Contrat du DOM : src/ecrans/placement/test/contrat.ts.
 *
 * AUCUN appel réseau réel : les tuiles de data.geopf.fr sont servies par une fausse route
 * (une image PNG de 1 × 1 px), toute autre requête hors de localhost est bloquée et comptée.
 *
 *   1. En ligne : photo par tuiles WMTS (la tuile du point de départ est demandée), « © IGN » ;
 *      poser le point de départ au clic (confirmation) ; créer une serre et la poser ; la tourner
 *      de 90° par sa poignée ; enregistrer ; annuler → retour exact ; recharger → placement
 *      conservé ; aucune violation de la CSP.
 *   2. Hors ligne (après une première visite) : l'éditeur se charge (précache), fond neutre et
 *      message, aucune tuile demandée ; point de départ, création, déplacement au clavier et
 *      enregistrement fonctionnent ; rechargé hors ligne, le placement est conservé.
 * Le poids (budget dédié, démarrage 71 Kio) : scripts/placement.test.ts et `pnpm budget`.
 */

const CHEMIN_TUILES = '../src/ecrans/placement/tuiles.ts';
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
  /** URL des tuiles demandées à data.geopf.fr (servies par la fausse route). */
  readonly tuiles: string[];
  /** Toute autre requête hors de localhost (bloquée). */
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
const plan = (page: Page) => page.getByTestId(T.plan);
const batiments = (page: Page) => page.getByTestId(T.batiment);
const panneau = (page: Page) => page.getByTestId(T.panneau);
/** Une fenêtre de confirmation ou un formulaire ouvert par-dessus l'éditeur. */
const fenetre = (page: Page, texte: RegExp): Locator =>
  page.locator(`[role="alertdialog"], [role="dialog"]:not([data-testid="${T.editeur}"])`).filter({ hasText: texte });

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

async function boite(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox();
  if (b === null) throw new Error('élément sans boîte');
  return b;
}

async function centreDe(l: Locator): Promise<{ x: number; y: number }> {
  const b = await boite(l);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function confirmer(page: Page, texte: RegExp): Promise<void> {
  const f = fenetre(page, texte);
  await expect(f).toBeVisible();
  await f.getByRole('button', { name: 'Confirmer' }).click();
  await expect(f).toHaveCount(0);
}

/** Saisie d'un champ numérique, validée par Tab. */
async function saisir(champ: Locator, valeur: string): Promise<void> {
  await champ.fill(valeur);
  await champ.press('Tab');
}

async function enregistrer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId(T.annuler), 'Annuler proposé après l’enregistrement').toBeVisible();
}

async function nouveauBatiment(page: Page, nom: string, ou: { x: number; y: number }): Promise<Locator> {
  await page.getByRole('button', { name: 'Nouveau bâtiment', exact: true }).click();
  const f = fenetre(page, /Nouveau bâtiment/);
  await expect(f).toBeVisible();
  await f.getByLabel('Type', { exact: true }).selectOption('serre_tunnel');
  await f.getByLabel('Nom', { exact: true }).fill(nom);
  await f.getByLabel('Longueur (m)', { exact: true }).fill('40');
  await f.getByLabel('Largeur (m)', { exact: true }).fill('8');
  await f.getByLabel('Hauteur (m)', { exact: true }).fill('3.5');
  await f.getByRole('button', { name: 'Poser', exact: true }).click();
  await page.mouse.click(ou.x, ou.y);
  await expect(batiments(page)).toHaveCount(1);
  const b = batiments(page).first();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  return b;
}

const nombre = async (l: Locator, attribut: string): Promise<number> => Number(await l.getAttribute(attribut));

test('ordinateur en ligne : photo IGN, point de départ, poser une serre, la tourner de 90°, enregistrer, annuler, recharger', async ({ page, context }) => {
  test.setTimeout(240_000);
  const tuilesMod = (await import(/* @vite-ignore */ CHEMIN_TUILES)) as ModuleTuiles;
  const reseau = await intercepter(context);
  const violations = await surveillerCsp(page);
  await amorcerEtOuvrir(page);
  await ouvrirEditeur(page);

  await test.step('photo aérienne : tuiles WMTS de la Géoplateforme, « © IGN »', async () => {
    await expect(editeur(page)).toHaveAttribute('data-fond', 'photo');
    await expect(editeur(page)).toHaveAttribute('data-zoom', '19');
    await expect(page.getByTestId(T.mentionIgn)).toBeVisible();
    await expect(page.getByTestId(T.mentionIgn)).toContainText('© IGN');
    await expect.poll(() => page.getByTestId(T.tuile).count()).toBeGreaterThan(0);
    // Chaque tuile affichée est chargée (servie par la fausse route).
    await expect
      .poll(() => page.getByTestId(T.tuile).evaluateAll((imgs) => imgs.every((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0)))
      .toBe(true);
    const attendue = tuilesMod.tuileDe(POSITION, 19);
    const demandees = reseau.tuiles.map((u) => new URL(u).searchParams);
    expect(demandees.length).toBeGreaterThan(0);
    for (const p of demandees) {
      expect(p.get('LAYER')).toBe('ORTHOIMAGERY.ORTHOPHOTOS');
      expect(p.get('TILEMATRIXSET')).toBe('PM');
      expect(p.get('TILEMATRIX')).toBe('19');
    }
    expect(
      demandees.some((p) => p.get('TILECOL') === String(attendue.colonne) && p.get('TILEROW') === String(attendue.ligne)),
      `tuile ${String(attendue.colonne)}/${String(attendue.ligne)} de la position de la ferme demandée`,
    ).toBe(true);
  });

  let origine = '';
  await test.step('sans point de départ : on le pose d’abord, au clic, avec confirmation', async () => {
    await expect(editeur(page)).toHaveAttribute('data-origine', '');
    await expect(page.getByTestId(T.origineAbsente)).toContainText(/point de départ/i);
    await expect(page.getByRole('button', { name: 'Nouveau bâtiment', exact: true })).toBeDisabled();
    const milieu = await centreDe(plan(page));
    await page.mouse.click(milieu.x, milieu.y);
    await confirmer(page, /point de départ/i);
    await expect(editeur(page)).not.toHaveAttribute('data-origine', '');
    origine = (await editeur(page).getAttribute('data-origine')) ?? '';
    const [latitude = Number.NaN, longitude = Number.NaN] = origine.split(',').map(Number);
    // Vue centrée sur la position de la ferme : le milieu du plan est à quelques pixels près dessus.
    const ecart = versLocal(POSITION, { latitude, longitude });
    expect(Math.hypot(ecart.x, ecart.y), `point de départ à ${origine}`).toBeLessThan(2);
    await expect(page.getByRole('button', { name: 'Nouveau bâtiment', exact: true })).toBeEnabled();
  });

  const serre = batiments(page).first();
  await test.step('créer la serre M3, la poser, la placer en (50, 30), enregistrer', async () => {
    const milieu = await centreDe(plan(page));
    await nouveauBatiment(page, 'Serre M3', { x: milieu.x + 120, y: milieu.y - 60 });
    await saisir(panneau(page).getByLabel('x (m)', { exact: true }), '50');
    await saisir(panneau(page).getByLabel('y (m)', { exact: true }), '30');
    await expect.poll(() => nombre(serre, 'data-x')).toBeCloseTo(50, 6);
    await expect.poll(() => nombre(serre, 'data-y')).toBeCloseTo(30, 6);
    expect(await nombre(serre, 'data-orientation')).toBeCloseTo(0, 6);
    await enregistrer(page);
  });

  await test.step('la tourner de 90° par sa poignée, enregistrer', async () => {
    await serre.click();
    const poignee = page.getByTestId(T.poigneeRotation);
    await expect(poignee).toBeVisible();
    const centre = await centreDe(serre);
    const depart = await centreDe(poignee);
    await page.mouse.move(depart.x, depart.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 80, centre.y + 40, { steps: 4 });
    await page.mouse.move(centre.x + 160, centre.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => nombre(serre, 'data-orientation')).toBeCloseTo(90, 6);
    expect(await nombre(serre, 'data-x')).toBeCloseTo(50, 6);
    expect(await nombre(serre, 'data-y')).toBeCloseTo(30, 6);
    await enregistrer(page);
  });

  await test.step('« Annuler » : retour exact à (50, 30, 0°)', async () => {
    await page.getByTestId(T.annuler).click();
    await expect.poll(() => nombre(serre, 'data-orientation')).toBeCloseTo(0, 6);
    expect(await nombre(serre, 'data-x')).toBeCloseTo(50, 6);
    expect(await nombre(serre, 'data-y')).toBeCloseTo(30, 6);
    expect(await nombre(serre, 'data-longueur')).toBeCloseTo(40, 6);
    expect(await nombre(serre, 'data-largeur')).toBeCloseTo(8, 6);
  });

  await test.step('recharger : placement conservé', async () => {
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await expect(editeur(page)).toHaveAttribute('data-origine', origine);
    await expect(batiments(page)).toHaveCount(1);
    const relue = batiments(page).first();
    expect(await relue.getAttribute('aria-label') ?? await relue.textContent()).toContain('Serre M3');
    expect(await nombre(relue, 'data-x')).toBeCloseTo(50, 6);
    expect(await nombre(relue, 'data-y')).toBeCloseTo(30, 6);
    expect(await nombre(relue, 'data-orientation')).toBeCloseTo(0, 6);
  });

  expect(reseau.ailleurs, 'aucun appel réseau hors de localhost et des tuiles').toEqual([]);
  expect(await violations(), 'violations de la CSP').toEqual([]);
});

test('hors ligne : fond neutre et message ; point de départ, création, déplacement et enregistrement fonctionnent', async ({ page, context }) => {
  test.setTimeout(240_000);
  const reseau = await intercepter(context);
  await amorcerEtOuvrir(page);
  // Première visite faite en ligne (service worker installé) ; puis plus de réseau.
  await context.setOffline(true);
  const tuilesAvant = reseau.tuiles.length;
  await ouvrirEditeur(page);

  await test.step('fond neutre quadrillé, message, aucune tuile', async () => {
    await expect(editeur(page)).toHaveAttribute('data-fond', 'neutre');
    await expect(page.getByTestId(T.fondNeutre)).toBeVisible();
    await expect(editeur(page)).toContainText(MESSAGES_PLACEMENT.horsLigne);
    await expect(page.getByTestId(T.tuile)).toHaveCount(0);
  });

  await test.step('point de départ : la position de la ferme', async () => {
    await page.getByRole('button', { name: 'Utiliser la position de la ferme' }).click();
    await confirmer(page, /point de départ/i);
    await expect(editeur(page)).toHaveAttribute('data-origine', '44,1.5');
  });

  const serre = batiments(page).first();
  await test.step('créer une serre en (10, 10), enregistrer ; la déplacer de 3 m à l’est au clavier, enregistrer', async () => {
    const milieu = await centreDe(plan(page));
    await nouveauBatiment(page, 'Serre hors ligne', { x: milieu.x + 50, y: milieu.y + 50 });
    await saisir(panneau(page).getByLabel('x (m)', { exact: true }), '10');
    await saisir(panneau(page).getByLabel('y (m)', { exact: true }), '10');
    await enregistrer(page);
    await serre.focus();
    for (let k = 0; k < 3; k++) await serre.press('Shift+ArrowRight');
    await expect.poll(() => nombre(serre, 'data-x')).toBeCloseTo(13, 6);
    await enregistrer(page);
  });

  await test.step('rechargé hors ligne : placement conservé', async () => {
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await expect(editeur(page)).toHaveAttribute('data-fond', 'neutre');
    await expect(batiments(page)).toHaveCount(1);
    expect(await nombre(batiments(page).first(), 'data-x')).toBeCloseTo(13, 6);
    expect(await nombre(batiments(page).first(), 'data-y')).toBeCloseTo(10, 6);
  });

  expect(reseau.tuiles.length, 'aucune tuile demandée hors ligne').toBe(tuilesAvant);
  expect(reseau.ailleurs).toEqual([]);
});

import { devices, expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { TESTID_PLACEMENT as P, MESSAGES_PLACEMENT } from '../src/ecrans/placement/test/contrat.ts';
import { FERME, UTILISATEUR } from '../src/ecrans/placement/test/ferme-placement.ts';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import { TESTID_3D_JUMEAU } from '../src/ecrans/plan3d/test/contrat-jumeau.ts';
import { TESTID_3D_EDITEUR as T, TEXTES_3D_EDITEUR as TEXTE } from '../src/ecrans/plan3d/test/contrat-editeur.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T28f — trouver et ouvrir l'éditeur de placement depuis la vue 3D (Q32), sur ordinateur
 * (Chromium 1280 × 800, WebGL logiciel). Contrat : src/ecrans/plan3d/test/contrat-editeur.ts.
 *
 *   1. gérant, ferme SANS placement (`?jeu=placement&saison=1`) : encart « Placez votre ferme sur la
 *      photo aérienne » avec le bouton « Modifier le plan » ; le bouton ouvre l'éditeur ; on y pose le
 *      point de départ et un bâtiment, on enregistre, on ferme : retour sur la 3D, qui montre le
 *      bâtiment (`data-batiments` = 1, dans la liste), l'encart a disparu ; aucune violation de la CSP ;
 *   2. gérant, ferme placée (`…&origine=1`) : pas d'encart, le bouton est là, ouvre l'éditeur,
 *      « Fermer » ramène sur la 3D ;
 *   3. équipier : pas de bouton, encart sans bouton qui dit qui peut le faire (ferme vide), rien (placée) ;
 *   4. écran étroit (fenêtre rétrécie sous 1024 px, 3D ouverte) : le gérant garde le bouton et l'encart
 *      d'invitation (T28k, Q36) ; à la taille d'un téléphone, « Voir en 3D » n'est même pas proposé ;
 *   5. la démo en ligne (pnpm e2e:demo, E2E_DEMO=1) : « Modifier le plan » ouvre l'éditeur HORS LIGNE,
 *      fond neutre, un bâtiment se pose et s'enregistre, la 3D en montre un de plus.
 * Le poids (démarrage 71 Kio, morceaux 3D et éditeur séparés) : scripts/placement.test.ts.
 *
 * Aucun appel réseau réel : toute requête hors de localhost est bloquée.
 */

const DELAI_AMORCAGE_MS = 120_000;
const DELAI_MS = 30_000;
const DEMO = process.env.E2E_DEMO === '1';

const executablePath = process.env.CHROMIUM_PATH;

test.use({
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
});

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const vue = (page: Page) => page.getByTestId(TESTID_3D.vue);
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
const editeur = (page: Page) => page.getByTestId(P.editeur);
const encart = (page: Page) => page.getByTestId(T.encart);
const modifierPlan = (page: Page) => page.getByTestId(T.modifierPlan);
const fenetre = (page: Page, texte: RegExp): Locator =>
  page.locator(`[role="alertdialog"], [role="dialog"]:not([data-testid="${P.editeur}"])`).filter({ hasText: texte });

async function bloquerLeReseau(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort('blockedbyclient'),
  );
}

/** Amorce la ferme du placement (avec une saison), ouvre l'onglet Planches puis la vue 3D. */
async function ouvrirEn3d(page: Page, parametres: string): Promise<void> {
  await page.goto(`/diagnostic/amorcer.html?jeu=placement&saison=1${parametres}`);
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { erreur?: string; fermeId?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  expect(a.fermeId).toBe(FERME);

  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId: UTILISATEUR, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId(TESTID_3D.bouton)).toBeEnabled({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
}

async function centreDe(l: Locator): Promise<{ x: number; y: number }> {
  const b = await l.boundingBox();
  if (b === null) throw new Error('élément sans boîte');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function confirmer(page: Page, texte: RegExp): Promise<void> {
  const f = fenetre(page, texte);
  await expect(f).toBeVisible();
  await f.getByRole('button', { name: 'Confirmer' }).click();
  await expect(f).toHaveCount(0);
}

/** Pose un bâtiment au milieu du plan (formulaire « Nouveau bâtiment ») et enregistre. */
async function poserUnBatiment(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nouveau bâtiment', exact: true }).click();
  const f = fenetre(page, /Nouveau bâtiment/);
  await expect(f).toBeVisible();
  await f.getByLabel('Type', { exact: true }).selectOption('hangar');
  await f.getByLabel('Nom', { exact: true }).fill('Hangar T28f');
  await f.getByLabel('Longueur (m)', { exact: true }).fill('20');
  await f.getByLabel('Largeur (m)', { exact: true }).fill('10');
  await f.getByLabel('Hauteur (m)', { exact: true }).fill('5');
  await f.getByRole('button', { name: 'Poser', exact: true }).click();
  const libre = await pointLibre(page);
  await page.mouse.click(libre.x, libre.y);
  await expect(page.getByTestId(P.batiment).filter({ hasText: 'Hangar T28f' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId(P.annuler), 'Annuler proposé après l’enregistrement').toBeVisible();
}

/**
 * Un point libre du plan : on balaie une grille sur la surface et on garde le premier où
 * `elementFromPoint` ne tombe ni sur une zone, un bâtiment, une planche, une poignée, ni sur un contrôle.
 * (Dans la démo, déjà placée, le milieu du plan est sur une zone : un clic y sélectionnerait au lieu de poser.)
 */
async function pointLibre(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const plan = document.querySelector('[data-testid="plan-placement"]');
    if (plan === null) return null;
    const b = plan.getBoundingClientRect();
    const interdits = '[data-testid="zone-contour"],[data-testid="cote-contour"],[data-testid="sommet"],[data-testid="batiment"],[data-testid="planche"],[data-testid^="poignee"],[data-testid="origine-absente"],button,a,input,select,[role="dialog"],[role="alertdialog"],[role="status"]';
    for (let j = 1; j < 16; j++) {
      for (let i = 1; i < 24; i++) {
        const x = b.left + (b.width * i) / 24;
        const y = b.top + (b.height * j) / 16;
        const el = document.elementFromPoint(x, y);
        if (el === null || !plan.contains(el)) continue;
        // Un ancêtre hors du plan (la feuille de l'éditeur est un role=dialog) ne compte pas.
        const obstacle = el.closest(interdits);
        if (obstacle === null || !plan.contains(obstacle)) return { x, y };
      }
    }
    return null;
  });
  if (point === null) throw new Error('aucun point libre sur le plan');
  return point;
}

const nbBatiments3d = async (page: Page): Promise<number> => Number(await toile(page).getAttribute('data-batiments'));

test('gérant, ferme vide : encart avec le bouton, l’éditeur s’ouvre, on y pose un bâtiment, la 3D le montre au retour', async ({ page, context }) => {
  test.skip(DEMO, 'amorçage de la page de diagnostic : pas dans la démo');
  test.setTimeout(DELAI_AMORCAGE_MS + 180_000);
  await bloquerLeReseau(context);
  const violations = await surveillerCsp(page);
  await ouvrirEn3d(page, '');

  await test.step('encart d’invitation, avec le même bouton', async () => {
    await expect(encart(page)).toBeVisible();
    await expect(encart(page)).toContainText(TEXTE.invitation);
    await expect(modifierPlan(page), 'un seul bouton « Modifier le plan » dans la page').toHaveCount(1);
    await expect(encart(page).getByTestId(T.modifierPlan)).toBeVisible();
    await expect(modifierPlan(page)).toHaveText(TEXTE.bouton);
    await expect(vue(page).getByTestId(T.modifierPlan)).toHaveCount(1);
    expect(await nbBatiments3d(page)).toBe(0);
  });

  await test.step('un tap ouvre l’éditeur de placement', async () => {
    await modifierPlan(page).click();
    await expect(editeur(page)).toBeVisible({ timeout: DELAI_MS });
    await expect(editeur(page)).toHaveAttribute('data-mode', 'edition');
    await expect(vue(page), 'la 3D reste montée sous l’éditeur').toHaveCount(1);
  });

  await test.step('point de départ puis un bâtiment, enregistrés', async () => {
    const milieu = await centreDe(page.getByTestId(P.plan));
    await page.mouse.click(milieu.x, milieu.y);
    await confirmer(page, /point de départ/i);
    await expect(editeur(page)).not.toHaveAttribute('data-origine', '');
    await poserUnBatiment(page);
  });

  await test.step('fermer : retour sur la 3D, qui montre le bâtiment enregistré, plus d’encart', async () => {
    await editeur(page).getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(editeur(page)).toHaveCount(0);
    await expect(vue(page)).toHaveAttribute('data-etat', 'pret');
    await expect.poll(() => nbBatiments3d(page), { timeout: DELAI_MS }).toBe(1);
    await expect(page.getByTestId(TESTID_3D_JUMEAU.elementBatiment)).toHaveCount(1);
    await expect(page.getByTestId(TESTID_3D_JUMEAU.elementBatiment).first()).toContainText('Hangar T28f');
    await expect(encart(page)).toHaveCount(0);
    await expect(modifierPlan(page), 'le bouton reste, dans la barre de la vue').toHaveCount(1);
  });

  expect(await violations(), 'violations de la CSP').toEqual([]);
});

test('gérant, ferme placée : pas d’encart, le bouton ouvre l’éditeur, « Fermer » ramène sur la 3D', async ({ page, context }) => {
  test.skip(DEMO, 'amorçage de la page de diagnostic : pas dans la démo');
  test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
  await bloquerLeReseau(context);
  await ouvrirEn3d(page, '&origine=1');
  await expect(encart(page)).toHaveCount(0);
  expect(await nbBatiments3d(page), 'Hangar et Serre M1').toBe(2);
  await expect(modifierPlan(page)).toHaveCount(1);
  await expect(modifierPlan(page)).toBeVisible();
  await modifierPlan(page).click();
  await expect(editeur(page)).toBeVisible({ timeout: DELAI_MS });
  await expect(editeur(page)).toHaveAttribute('data-mode', 'edition');
  await expect(editeur(page)).toHaveAttribute('data-origine', '44,1.5');
  await editeur(page).getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(editeur(page)).toHaveCount(0);
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret');
  expect(await nbBatiments3d(page)).toBe(2);
});

test('équipier : jamais de bouton ; ferme vide, l’encart dit qui peut placer la ferme', async ({ page, context }) => {
  test.skip(DEMO, 'amorçage de la page de diagnostic : pas dans la démo');
  test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
  await bloquerLeReseau(context);
  await ouvrirEn3d(page, '&role=equipier');
  await expect(modifierPlan(page)).toHaveCount(0);
  await expect(encart(page)).toBeVisible();
  await expect(encart(page)).toContainText(TEXTE.pasGerant);
  await expect(encart(page)).not.toContainText(TEXTE.invitation);
  await expect(encart(page).getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: TEXTE.bouton })).toHaveCount(0);
});

test('équipier, ferme placée : ni bouton ni encart', async ({ page, context }) => {
  test.skip(DEMO, 'amorçage de la page de diagnostic : pas dans la démo');
  test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
  await bloquerLeReseau(context);
  await ouvrirEn3d(page, '&role=equipier&origine=1');
  await expect(modifierPlan(page)).toHaveCount(0);
  await expect(encart(page)).toHaveCount(0);
});

test('écran étroit : sous 1024 px le gérant garde le bouton et l’invitation (T28k, Q36) ; au téléphone la 3D est proposée (Q36)', async ({ page, context }) => {
  test.skip(DEMO, 'amorçage de la page de diagnostic : pas dans la démo');
  test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
  await bloquerLeReseau(context);
  await ouvrirEn3d(page, '');
  await expect(modifierPlan(page)).toHaveCount(1);
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(modifierPlan(page), 'Q36 : le gérant place aussi sur un écran étroit').toHaveCount(1);
  await expect(encart(page)).toBeVisible();
  await expect(encart(page)).toContainText(TEXTE.invitation);
  await expect(encart(page).getByRole('button', { name: TEXTE.bouton })).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(modifierPlan(page)).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId(TESTID_3D.bouton), '« Voir en 3D » proposé au téléphone (Q36, les ouvriers y voient les travaux du jour)').toBeVisible();
  await expect(modifierPlan(page)).toHaveCount(0);
});

test('démo : « Modifier le plan » ouvre l’éditeur hors ligne (fond neutre), on y pose un bâtiment, la 3D en montre un de plus', async ({ page, context }) => {
  test.skip(!DEMO, 'ne tourne que sur la démo (pnpm e2e:demo)');
  test.setTimeout(240_000);
  const requetes: string[] = [];
  context.on('request', (r) => requetes.push(r.url()));
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: DELAI_MS });
  // Les morceaux 3D et éditeur sont précachés dès la première visite (principe 4) : on coupe le réseau.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  const avant = await nbBatiments3d(page);
  expect(avant, 'la démo est déjà placée (T28c)').toBeGreaterThanOrEqual(3);
  await expect(encart(page), 'ferme de démo placée : pas d’encart').toHaveCount(0);

  await expect(modifierPlan(page)).toBeVisible();
  await modifierPlan(page).click();
  await expect(editeur(page)).toBeVisible({ timeout: DELAI_MS });
  await expect(editeur(page), 'démo : rôle gérant').toHaveAttribute('data-mode', 'edition');
  await expect(editeur(page)).toHaveAttribute('data-fond', 'neutre');
  await expect(page.getByTestId(P.fondNeutre)).toContainText(MESSAGES_PLACEMENT.horsLigne);
  await expect(page.getByTestId(P.tuile)).toHaveCount(0);

  await poserUnBatiment(page);
  await editeur(page).getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(editeur(page)).toHaveCount(0);
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret');
  await expect.poll(() => nbBatiments3d(page), { timeout: DELAI_MS }).toBe(avant + 1);

  const origine = new URL(page.url()).origin;
  const etrangeres = requetes.filter((u) => {
    const url = new URL(u);
    return !['data:', 'blob:', 'about:'].includes(url.protocol) && url.origin !== origine;
  });
  expect(etrangeres, 'requêtes hors de l’origine de la démo').toEqual([]);
});

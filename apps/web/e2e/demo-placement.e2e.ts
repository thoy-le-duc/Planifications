import { devices, expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { TESTID } from '../src/demo/test/contrat.ts';
import { TESTID_DEMO_PLACEMENT, TEXTE_INVITATION } from '../src/demo/test/contrat-placement.ts';
import { MESSAGES_PLACEMENT, TESTID_PLACEMENT as P, type ModuleTuiles } from '../src/ecrans/placement/test/contrat.ts';
import { MOISSAC, MOTIF_INDISPONIBLE, NOM_CHAMP_ADRESSE, NUMERO_MOISSAC, reponseGeocodage, RUE_MOISSAC, TESTID_ADRESSE as A } from '../src/ecrans/placement/test/contrat-adresse.ts';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import { TESTID_3D_EDITEUR } from '../src/ecrans/plan3d/test/contrat-editeur.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T28i — essayer le placement d'une serre dans la démo en ligne, de bout en bout, sur `dist-demo/`
 * (`pnpm e2e:demo`, playwright.demo.config.ts), sur ordinateur (Chromium 1280 × 800, WebGL logiciel).
 * Contrat : src/demo/test/contrat-placement.ts. Ce fichier ne tourne QUE dans la démo.
 *
 * AUCUNE requête réelle : `page.route` répond à la place de data.geopf.fr (tuiles : PNG de 1 × 1 px ;
 * géocodage : GeoJSON fabriqué ici). Toute autre requête hors de localhost est bloquée et comptée.
 *
 *   1. En ligne : 3D avec l'invitation, « Modifier le plan » → éditeur en photo IGN (tuiles autour de
 *      l'origine de la démo, « © IGN »), invitation, recherche d'adresse qui répond, une serre
 *      ajoutée, posée et enregistrée ; au retour la 3D compte un bâtiment de plus ; « Réinitialiser la
 *      démo » la retire ; la balise CSP autorise data.geopf.fr (img-src, connect-src), sans violation.
 *   2. Hors ligne (service worker aux commandes) : fond neutre, aucune tuile, aucune erreur,
 *      invitation, recherche d'adresse muette mais polie, serre ajoutée et vue dans la 3D.
 */

const CHEMIN_TUILES = '../src/ecrans/placement/tuiles.ts';
const DELAI_MS = 30_000;
const IMAGE_TUILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const NOM_SERRE = 'Serre essai T28i';

test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');

const executablePath = process.env.CHROMIUM_PATH;
test.use({
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  actionTimeout: 15_000,
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
});

interface Reseau {
  readonly tuiles: string[];
  readonly geocodage: string[];
  readonly ailleurs: string[];
}

async function intercepter(context: BrowserContext): Promise<Reseau> {
  const reseau: Reseau = { tuiles: [], geocodage: [], ailleurs: [] };
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://data.geopf.fr' && url.pathname.startsWith('/geocodage/')) {
        reseau.geocodage.push(url.href);
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

const onglet = (page: Page, libelle: string) => page.getByRole('navigation', { name: 'Navigation principale' }).locator('button').filter({ hasText: libelle });
const vue = (page: Page) => page.getByTestId(TESTID_3D.vue);
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
const editeur = (page: Page) => page.getByTestId(P.editeur);
const invitation = (conteneur: Locator) => conteneur.getByTestId(TESTID_DEMO_PLACEMENT.invitation);
const fenetre = (page: Page, texte: RegExp): Locator =>
  page.locator(`[role="alertdialog"], [role="dialog"]:not([data-testid="${P.editeur}"])`).filter({ hasText: texte });
const nbBatiments3d = async (page: Page): Promise<number> => Number(await toile(page).getAttribute('data-batiments'));

/** Première visite : la démo s'ouvre, base prête. */
async function ouvrirLaDemo(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
}

/** Onglet Planches puis vue 3D de la démo. */
async function ouvrirLa3d(page: Page): Promise<void> {
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId(TESTID_3D.bouton)).toBeEnabled({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
}

async function ouvrirEditeurDepuisLa3d(page: Page): Promise<void> {
  await page.getByTestId(TESTID_3D_EDITEUR.modifierPlan).click();
  await expect(editeur(page)).toBeVisible({ timeout: DELAI_MS });
  await expect(editeur(page), 'démo : le visiteur est gérant').toHaveAttribute('data-mode', 'edition');
}

/** Un point libre du plan (ni zone, ni bâtiment, ni planche, ni contrôle) : le milieu de la démo est sur une zone. */
async function pointLibre(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const plan = document.querySelector('[data-testid="plan-placement"]');
    if (plan === null) return null;
    const b = plan.getBoundingClientRect();
    const interdits = '[data-testid="zone-contour"],[data-testid="cote-contour"],[data-testid="sommet"],[data-testid="batiment"],[data-testid="planche"],[data-testid^="poignee"],[data-testid="origine-absente"],[data-testid="invitation-demo"],button,a,input,select,[role="dialog"],[role="alertdialog"],[role="status"]';
    for (let j = 1; j < 16; j++) {
      for (let i = 1; i < 24; i++) {
        const x = b.left + (b.width * i) / 24;
        const y = b.top + (b.height * j) / 16;
        const el = document.elementFromPoint(x, y);
        if (el === null || !plan.contains(el)) continue;
        const obstacle = el.closest(interdits);
        if (obstacle === null || !plan.contains(obstacle)) return { x, y };
      }
    }
    return null;
  });
  if (point === null) throw new Error('aucun point libre sur le plan');
  return point;
}

/** Ajoute une serre (formulaire « Nouveau bâtiment »), la pose sur un point libre, enregistre. */
async function ajouterUneSerre(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nouveau bâtiment', exact: true }).click();
  const f = fenetre(page, /Nouveau bâtiment/);
  await expect(f).toBeVisible();
  await f.getByLabel('Type', { exact: true }).selectOption('serre_tunnel');
  await f.getByLabel('Nom', { exact: true }).fill(NOM_SERRE);
  await f.getByLabel('Longueur (m)', { exact: true }).fill('30');
  await f.getByLabel('Largeur (m)', { exact: true }).fill('8');
  await f.getByLabel('Hauteur (m)', { exact: true }).fill('3.5');
  await f.getByRole('button', { name: 'Poser', exact: true }).click();
  const libre = await pointLibre(page);
  await page.mouse.click(libre.x, libre.y);
  await expect(page.getByTestId(P.batiment).filter({ hasText: NOM_SERRE })).toHaveCount(1);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByTestId(P.annuler), 'Annuler proposé après l’enregistrement').toBeVisible();
}

async function fermerEditeur(page: Page): Promise<void> {
  await editeur(page).getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(editeur(page)).toHaveCount(0);
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret');
}

test('en ligne : photo IGN, invitation, recherche d’adresse, une serre ajoutée et posée, vue dans la 3D ; « Réinitialiser la démo » la retire', async ({ page, context }) => {
  test.setTimeout(300_000);
  const tuilesMod = (await import(/* @vite-ignore */ CHEMIN_TUILES)) as ModuleTuiles;
  const reseau = await intercepter(context);
  const violations = await surveillerCsp(page);
  await ouvrirLaDemo(page);

  await test.step('la balise CSP de la démo autorise la photo IGN (img-src) et le géocodage (connect-src)', async () => {
    const politique = (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ?? '';
    const d = new Map(politique.split(';').map((x) => x.trim().split(/\s+/)).map(([nom = '', ...valeurs]) => [nom, valeurs] as const));
    expect(d.get('img-src')).toEqual(["'self'", 'https://data.geopf.fr']);
    expect(d.get('connect-src')).toEqual(["'self'", 'https://data.geopf.fr']);
  });

  await ouvrirLa3d(page);
  const avant = await nbBatiments3d(page);
  expect(avant, 'la démo est déjà placée (T28c)').toBeGreaterThanOrEqual(3);

  await test.step('vue 3D : l’invitation « Essayez : ajoutez une serre et posez-la sur la photo »', async () => {
    await expect(invitation(vue(page))).toHaveCount(1);
    await expect(invitation(vue(page))).toBeVisible();
    await expect(invitation(vue(page))).toContainText(TEXTE_INVITATION);
    await expect(page.getByTestId(TESTID_3D_EDITEUR.encart), 'T28f : pas d’encart dans une ferme déjà placée').toHaveCount(0);
  });

  let origine = '';
  await test.step('éditeur : photo IGN autour de l’origine de la démo, « © IGN », invitation', async () => {
    await ouvrirEditeurDepuisLa3d(page);
    await expect(editeur(page)).toHaveAttribute('data-fond', 'photo');
    await expect(page.getByTestId(P.mentionIgn)).toContainText('© IGN');
    await expect(invitation(editeur(page))).toHaveCount(1);
    await expect(invitation(editeur(page))).toBeVisible();
    await expect(invitation(editeur(page))).toContainText(TEXTE_INVITATION);
    origine = (await editeur(page).getAttribute('data-origine')) ?? '';
    const [latitude = Number.NaN, longitude = Number.NaN] = origine.split(',').map(Number);
    expect(Number.isFinite(latitude) && Number.isFinite(longitude), `origine de la démo « ${origine} »`).toBe(true);
    await expect.poll(() => page.getByTestId(P.tuile).count()).toBeGreaterThan(0);
    await expect
      .poll(() => page.getByTestId(P.tuile).evaluateAll((imgs) => imgs.every((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0)))
      .toBe(true);
    const attendue = tuilesMod.tuileDe({ latitude, longitude }, 19);
    expect(
      reseau.tuiles.map((u) => new URL(u).searchParams).some((p) => p.get('TILECOL') === String(attendue.colonne) && p.get('TILEROW') === String(attendue.ligne) && p.get('TILEMATRIX') === '19'),
      'tuile de l’origine de la démo demandée',
    ).toBe(true);
  });

  await test.step('recherche d’adresse : la démo laisse passer le géocodage', async () => {
    const champ = page.getByLabel(NOM_CHAMP_ADRESSE, { exact: true });
    await champ.pressSequentially('Moissac', { delay: 40 });
    await expect(page.getByTestId(A.proposition)).toHaveCount(3);
    expect(reseau.geocodage, 'une seule requête de géocodage').toHaveLength(1);
    await expect(page.getByTestId(A.message)).toHaveCount(0);
    await champ.fill('');
    await expect(page.getByTestId(A.proposition)).toHaveCount(0);
  });

  await test.step('ajouter une serre, la poser, enregistrer ; au retour la 3D en compte une de plus', async () => {
    await ajouterUneSerre(page);
    await fermerEditeur(page);
    await expect.poll(() => nbBatiments3d(page), { timeout: DELAI_MS }).toBe(avant + 1);
    await expect(invitation(vue(page))).toHaveCount(1);
  });

  await test.step('« Réinitialiser la démo » : la serre ajoutée a disparu', async () => {
    await page.getByTestId(TESTID.reinitialiser).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByTestId(TESTID.confirmer).click();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
    await expect(page.getByTestId(TESTID.bandeau)).toBeVisible();
    await ouvrirLa3d(page);
    await expect.poll(() => nbBatiments3d(page), { timeout: DELAI_MS }).toBe(avant);
    await ouvrirEditeurDepuisLa3d(page);
    await expect(page.getByTestId(P.batiment).filter({ hasText: NOM_SERRE })).toHaveCount(0);
    await expect(editeur(page)).toHaveAttribute('data-origine', origine);
  });

  expect(reseau.ailleurs, 'aucune requête hors localhost et Géoplateforme').toEqual([]);
  expect(await violations(), 'violations de la CSP').toEqual([]);
});

test('hors ligne : fond neutre, aucune tuile, aucune erreur, invitation ; la serre s’ajoute et se voit dans la 3D', async ({ page, context }) => {
  test.setTimeout(300_000);
  await intercepter(context);
  await ouvrirLaDemo(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: DELAI_MS });
  // Première visite faite en ligne (service worker aux commandes, éditeur et 3D précachés) ; puis plus de réseau.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });

  const erreurs: string[] = [];
  const tuilesDemandees: string[] = [];
  page.on('pageerror', (e) => erreurs.push(`pageerror : ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') erreurs.push(`console.error : ${m.text()}`);
  });
  page.on('request', (r) => {
    if (new URL(r.url()).hostname === 'data.geopf.fr') tuilesDemandees.push(r.url());
  });

  await ouvrirLa3d(page);
  const avant = await nbBatiments3d(page);
  await expect(invitation(vue(page))).toBeVisible();
  await expect(invitation(vue(page))).toContainText(TEXTE_INVITATION);

  await ouvrirEditeurDepuisLa3d(page);
  await test.step('fond neutre quadrillé et message, aucune tuile, invitation visible', async () => {
    await expect(editeur(page)).toHaveAttribute('data-fond', 'neutre');
    await expect(page.getByTestId(P.fondNeutre)).toContainText(MESSAGES_PLACEMENT.horsLigne);
    await expect(page.getByTestId(P.tuile)).toHaveCount(0);
    await expect(invitation(editeur(page))).toBeVisible();
    await expect(invitation(editeur(page))).toContainText(TEXTE_INVITATION);
  });

  await test.step('recherche d’adresse : message clair, pas d’erreur', async () => {
    await page.getByLabel(NOM_CHAMP_ADRESSE, { exact: true }).pressSequentially('Toulouse', { delay: 20 });
    await expect(page.getByTestId(A.message)).toHaveText(MOTIF_INDISPONIBLE);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await page.getByLabel(NOM_CHAMP_ADRESSE, { exact: true }).fill('');
  });

  await test.step('ajouter une serre et la poser : possible sans réseau, vue dans la 3D', async () => {
    await ajouterUneSerre(page);
    await fermerEditeur(page);
    await expect.poll(() => nbBatiments3d(page), { timeout: DELAI_MS }).toBe(avant + 1);
  });

  expect(tuilesDemandees, 'aucune requête vers la Géoplateforme hors ligne').toEqual([]);
  expect(erreurs, 'aucune erreur hors ligne').toEqual([]);
});

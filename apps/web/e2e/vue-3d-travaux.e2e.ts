import { devices, expect, test, type Page } from '@playwright/test';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import type { Pose } from '../src/ecrans/plan3d/test/contrat-camera.ts';
import { HAUTEUR_BOUTON_MIN_PX, TESTID_3D_TRAVAUX as T } from '../src/ecrans/plan3d/test/contrat-travaux.ts';
import { distance, projeter } from '../src/ecrans/plan3d/test/projection.ts';
import { arreterImages, BORNES_DEMO, demarrerImages, instrumenter3d, verifierGardeFous } from './fluidite-3d.ts';

/**
 * T37 — les travaux du jour dans la vue 3D, au téléphone (390 × 844), sur la démo en ligne
 * (`pnpm e2e:demo`, E2E_DEMO=1), hors ligne. Contrat : src/ecrans/plan3d/test/contrat-travaux.ts.
 *
 * Ce que vérifie ce test :
 *   1. le panneau « Travaux du jour » est visible, ses lignes sont numérotées dans l'ordre exact
 *      des cartes de l'écran Aujourd'hui (même source, même ordre), ses boutons font au moins
 *      48 px de haut ;
 *   2. `data-travaux` = nombre de lignes ; `data-pastilles` : une pastille par planche placée
 *      visée, avec les numéros des travaux de cette planche ;
 *   3. un tap sur une ligne avec planche : la caméra VOLE (data-vols + 1) et arrive sur la planche
 *      (elle est au centre de l'écran, la caméra la regarde de près), la planche est mise en
 *      évidence (data-planche-active, data-travail-actif, aria-current) ;
 *   4. « Suivant » passe au travail suivant (qui a une planche) et la caméra y arrive ;
 *   5. le panneau se replie (la liste disparaît, « Suivant » reste) et se déplie ;
 *   6. aucune écriture, aucune requête hors de l'origine, après l'ouverture de la 3D ;
 *   7. garde-fous de fluidité de T29b tenus (BORNES_DEMO) pendant un glissé.
 * Au téléphone, « Voir en 3D » est proposé (T37) : voir le rapport du testeur.
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
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
function ou<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('valeur absente');
  return v;
}
const lignes = (page: Page) => page.getByTestId(T.ligne);
const ligneDe = (page: Page, rang: number) => page.locator(`[data-testid="${T.ligne}"][data-rang="${String(rang)}"]`);

interface PastilleLue {
  readonly planche: string;
  readonly x: number;
  readonly z: number;
  readonly numeros: number[];
}

interface LigneLue {
  readonly rang: number;
  readonly cle: string;
  readonly planche: string;
  readonly texte: string;
}

async function lirePose(page: Page): Promise<Pose> {
  const json = await toile(page).getAttribute('data-camera');
  if (json === null) throw new Error('toile-3d sans data-camera');
  return JSON.parse(json) as Pose;
}

const lireNombre = async (page: Page, nom: string): Promise<number> => Number(await toile(page).getAttribute(nom));

async function lirePastilles(page: Page): Promise<PastilleLue[]> {
  return JSON.parse((await toile(page).getAttribute('data-pastilles')) ?? '[]') as PastilleLue[];
}

async function lireLignes(page: Page): Promise<LigneLue[]> {
  return lignes(page).evaluateAll((els) =>
    els.map((e) => ({
      rang: Number((e as HTMLElement).dataset.rang),
      cle: (e as HTMLElement).dataset.cle ?? '',
      planche: (e as HTMLElement).dataset.planche ?? '',
      texte: (e.querySelector('[data-testid="aller-travail-3d"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })),
  );
}

/** Le vol est fini : plus de vol en cours, et `vols` vols lancés en tout. */
async function attendreVol(page: Page, vols: number): Promise<void> {
  await expect(toile(page)).toHaveAttribute('data-vols', String(vols), { timeout: 5000 });
  await expect(toile(page)).toHaveAttribute('data-vol', 'non', { timeout: 5000 });
}

/** La caméra est arrivée sur la planche : elle la regarde, de près, au centre de l'écran. */
async function verifierArrivee(page: Page, p: PastilleLue, nom: string): Promise<void> {
  const pose = await lirePose(page);
  expect(Math.hypot(pose.cible.x - p.x, pose.cible.z - p.z), `${nom} : la caméra regarde la planche (m)`).toBeLessThan(0.5);
  const boite = await toile(page).boundingBox();
  if (boite === null) throw new Error('toile 3D sans boîte');
  const champ = await lireNombre(page, 'data-champ');
  const ecran = projeter(pose, champ, boite.width / boite.height, { x: p.x, y: 0.15, z: p.z });
  expect(ecran.profondeur, `${nom} : planche devant la caméra`).toBeGreaterThan(0);
  expect(Math.abs(ecran.x), `${nom} : planche au centre de l'écran (x)`).toBeLessThan(0.3);
  expect(Math.abs(ecran.y), `${nom} : planche au centre de l'écran (y)`).toBeLessThan(0.3);
  expect(distance(pose.position, pose.cible), `${nom} : de près (m)`).toBeLessThan(80);
}

test('travaux du jour dans la 3D de la démo, au téléphone, hors ligne', async ({ page, context, baseURL }) => {
  test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');
  test.setTimeout(240_000);
  await instrumenter3d(page);
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await expect(page.getByTestId('tache').first()).toBeVisible({ timeout: DELAI_MS });
  const cartes = await page.getByTestId('tache').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cle ?? ''));
  expect(cartes.length, 'la démo a des tâches aujourd’hui').toBeGreaterThan(0);

  // Hors ligne dès que le service worker est aux commandes (principe 4).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: DELAI_MS });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  const requetes: { methode: string; url: string }[] = [];
  page.on('request', (r) => {
    requetes.push({ methode: r.method(), url: r.url() });
  });

  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).tap();
  await expect(page.getByTestId(TESTID_3D.vue)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  const depuisOuverture = requetes.length;

  await test.step('le panneau « Travaux du jour » est visible, dans l’ordre de l’écran Aujourd’hui', async () => {
    const panneau = page.getByTestId(T.panneau);
    await expect(panneau).toBeVisible({ timeout: DELAI_MS });
    await expect(panneau).toHaveAccessibleName('Travaux du jour');
    const lues = await lireLignes(page);
    expect(lues.length, 'au moins un travail').toBeGreaterThan(0);
    expect(lues.map((l) => l.rang), 'numéros 1, 2, 3…').toEqual(lues.map((_, i) => i + 1));
    expect(lues.map((l) => l.cle).slice(0, cartes.length), 'même ordre que les cartes de l’écran Aujourd’hui').toEqual(cartes.slice(0, lues.length));
    for (const l of lues) expect(l.texte, 'texte « n. travail — lieu »').toMatch(new RegExp(`^${String(l.rang)}\\. .+ — .+`));
    await expect(toile(page)).toHaveAttribute('data-travaux', String(lues.length));
    await expect(toile(page)).toHaveAttribute('data-travail-actif', '');
    await expect(toile(page)).toHaveAttribute('data-planche-active', '');
    for (const id of [T.suivant, T.replier]) {
      const b = await page.getByTestId(id).boundingBox();
      expect(b?.height ?? 0, `${id} : zone tactile`).toBeGreaterThanOrEqual(HAUTEUR_BOUTON_MIN_PX);
    }
    for (const b of await page.getByTestId(T.aller).all()) {
      expect((await b.boundingBox())?.height ?? 0, 'ligne : zone tactile').toBeGreaterThanOrEqual(HAUTEUR_BOUTON_MIN_PX);
    }
  });

  const lues = await lireLignes(page);
  const pastilles = await lirePastilles(page);
  await test.step('une pastille par planche placée visée, avec les numéros de ses travaux', () => {
    const planches = [...new Set(lues.filter((l) => l.planche !== '').map((l) => l.planche))];
    expect(pastilles.length, 'au moins une pastille sur la démo').toBeGreaterThan(0);
    expect(pastilles.map((p) => p.planche).sort()).toEqual(planches.sort());
    for (const p of pastilles) {
      expect(p.numeros, `numéros de la planche ${p.planche}`).toEqual(lues.filter((l) => l.planche === p.planche).map((l) => l.rang));
    }
  });

  const avecPlanche = lues.filter((l) => l.planche !== '');
  const visee = ou(avecPlanche[avecPlanche.length > 1 ? 1 : 0]);
  const pastilleDe = (planche: string): PastilleLue => ou(pastilles.find((p) => p.planche === planche));

  await test.step('tap sur une ligne : la caméra vole jusqu’à sa planche, mise en évidence', async () => {
    const vols = await lireNombre(page, 'data-vols');
    await ligneDe(page, visee.rang).getByTestId(T.aller).tap();
    await attendreVol(page, vols + 1);
    await expect(toile(page)).toHaveAttribute('data-travail-actif', String(visee.rang));
    await expect(toile(page)).toHaveAttribute('data-planche-active', visee.planche);
    await expect(ligneDe(page, visee.rang)).toHaveAttribute('aria-current', 'true');
    await expect(lignes(page).and(page.locator('[aria-current="true"]'))).toHaveCount(1);
    await verifierArrivee(page, pastilleDe(visee.planche), `travail ${String(visee.rang)}`);
  });

  await test.step('« Suivant » passe au travail suivant qui a une planche', async () => {
    const attendu = ou(avecPlanche[(avecPlanche.indexOf(visee) + 1) % avecPlanche.length]);
    const vols = await lireNombre(page, 'data-vols');
    await page.getByTestId(T.suivant).tap();
    await attendreVol(page, vols + 1);
    await expect(toile(page)).toHaveAttribute('data-travail-actif', String(attendu.rang));
    await expect(toile(page)).toHaveAttribute('data-planche-active', attendu.planche);
    await verifierArrivee(page, pastilleDe(attendu.planche), `suivant ${String(attendu.rang)}`);
  });

  await test.step('le panneau se replie (la liste disparaît, « Suivant » reste) et se déplie', async () => {
    await expect(page.getByTestId(T.replier)).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId(T.replier).tap();
    await expect(page.getByTestId(T.panneau)).toHaveAttribute('data-replie', 'oui');
    await expect(page.getByTestId(T.liste)).toBeHidden();
    await expect(page.getByTestId(T.suivant)).toBeVisible();
    await page.getByTestId(T.replier).tap();
    await expect(page.getByTestId(T.liste)).toBeVisible();
    await expect(lignes(page).first()).toBeVisible();
  });

  await test.step('fluidité de T29b tenue pendant un glissé de la toile', async () => {
    const boite = await toile(page).boundingBox();
    if (boite === null) throw new Error('toile 3D sans boîte');
    const x0 = boite.x + boite.width / 2;
    const y0 = boite.y + boite.height / 3;
    await demarrerImages(page);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 40; i += 1) {
      await page.mouse.move(x0 + i * 3, y0 + ((i % 20) - 10) * 2);
      await page.evaluate(() => new Promise<void>((fini) => { requestAnimationFrame(() => { fini(); }); }));
    }
    await page.mouse.up();
    verifierGardeFous('travaux du jour sur la démo 3D', await arreterImages(page), BORNES_DEMO, 10);
  });

  await test.step('aucune écriture, aucune requête hors de l’origine depuis l’ouverture de la 3D', () => {
    const origine = new URL(baseURL ?? 'http://localhost').origin;
    const apres = requetes.slice(depuisOuverture);
    expect(apres.filter((r) => r.methode !== 'GET'), 'requêtes qui écrivent').toEqual([]);
    expect(apres.filter((r) => !['data:', 'blob:', 'about:'].includes(new URL(r.url).protocol) && new URL(r.url).origin !== origine), 'requêtes hors origine').toEqual([]);
  });
});

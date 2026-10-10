import { devices, expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import { TESTID_3D_CAMERA as T } from '../src/ecrans/plan3d/test/contrat-camera.ts';
import { TESTID_3D_RECOLTE as R } from '../src/ecrans/plan3d/test/contrat-recolte.ts';
import { MENTION_DERNIERES_RECOLTES } from '../src/ecrans/plan3d/test/contrat-recolte-suites.ts';
import { arreterImages, BORNES_FERME_T07, demarrerImages, instrumenter3d, verifierGardeFous } from './fluidite-3d.ts';

/**
 * T32f — la récolte en pleine saison dans la grande ferme de T07 (`pnpm e2e`, ordinateur : Chromium
 * 1280 × 800, WebGL logiciel), zoom serré sur une zone en pleine récolte. Contrat :
 * src/ecrans/plan3d/test/contrat-recolte-suites.ts (et contrat-recolte.ts pour les attributs data-).
 *
 * La ferme de T07 est tirée avec une graine fixe, mais datée par saison (jour de l'essai) : le test
 * ne connaît pas la date d'une récolte, il cherche. Semaine par semaine avec le curseur, il garde la
 * semaine où le plus de planches sont « à récolter » ou en « dernières récoltes » (`data-planches-a-recolter`),
 * puis vole vers chaque zone (boutons « Aller à… ») et retient celle qui porte le plus de balises ; il
 * s'approche enfin à la molette de cette zone.
 *
 * Ce que vérifie ce test :
 *   1. Q38 : en une semaine où une planche est en fin de récolte (ligne de la liste `data-recolte="fin-de-recolte"`),
 *      `data-planches-a-recolter` = `data-balises` = nombre de lignes « à récolter » ou « fin de récolte »
 *      non estompées ; `resume-recolte-3d` annonce ce nombre ; la ligne dit « dernières récoltes » ;
 *   2. une semaine en pleine récolte (au moins 3 planches à récolter) existe dans la saison de la ferme T07 ;
 *   3. zoom serré sur la zone la plus chargée en balises : la molette rapproche la caméra, la vue reste
 *      en détail (data-plants > 0), les garde-fous de T29b (BORNES_FERME_T07 : appels de dessin et
 *      triangles par image, JavaScript par image) tiennent pendant un glissé en pleine récolte, et pendant
 *      le zoom lui-même.
 * Si la semaine de pleine récolte n'existait pas dans la saison par défaut, le test échoue (il ne passe pas à vide).
 */

const DELAI_AMORCAGE_MS = 120_000;
const DELAI_MS = 30_000;
const executablePath = process.env.CHROMIUM_PATH;
const PLANCHES_PLEINE_RECOLTE_MIN = 3;
const IMAGES_PAR_GLISSE = 60;

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
const curseur = (page: Page) => page.getByTestId(TESTID_3D.curseur);
const resume = (page: Page) => page.getByTestId(R.resume);
const nombre = async (page: Page, attribut: string): Promise<number> => Number(await toile(page).getAttribute(attribut));
const phrase = (n: number): string => (n === 0 ? 'Aucune planche à récolter' : n === 1 ? '1 planche à récolter' : `${String(n)} planches à récolter`);

interface LigneLue {
  readonly recolte: string;
  readonly estompe: string;
  readonly texte: string;
}
async function lignes(page: Page): Promise<LigneLue[]> {
  return page.getByTestId(TESTID_3D.elementListe).evaluateAll((els) =>
    els.map((e) => ({
      recolte: (e as HTMLElement).dataset.recolte ?? '',
      estompe: (e as HTMLElement).dataset.estompe ?? '',
      texte: e.textContent.replace(/\s+/g, ' ').trim(),
    })),
  );
}

async function allerSemaine(page: Page, i: number): Promise<void> {
  await curseur(page).fill(String(i));
  await expect(vue(page)).toHaveAttribute('data-semaine', String(i));
  await expect(toile(page)).toHaveAttribute('data-semaine-plants', String(i));
}

const aBalise = (l: LigneLue): boolean => (l.recolte === 'a-recolter' || l.recolte === 'fin-de-recolte') && l.estompe === 'non';

async function glisser(page: Page): Promise<void> {
  const boite = await toile(page).boundingBox();
  if (boite === null) throw new Error('toile 3D sans boîte');
  const x0 = boite.x + boite.width / 2 - boite.width / 6;
  const y0 = boite.y + boite.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= IMAGES_PAR_GLISSE; i += 1) {
    await page.mouse.move(x0 + i * 3, y0 + ((i % 20) - 10) * 2);
    await page.evaluate(() => new Promise<void>((fini) => { requestAnimationFrame(() => { fini(); }); }));
  }
  await page.mouse.up();
}

test('récolte dans la grande ferme de T07 : balises jusqu’à la fin de récolte, zoom serré en pleine récolte, garde-fous de dessin tenus', async ({ page }) => {
  test.skip(process.env.E2E_DEMO === '1', 'ne tourne pas sur la démo : elle a ses propres garde-fous (vue-3d-recolte.e2e.ts)');
  test.setTimeout(DELAI_AMORCAGE_MS + 420_000);
  await instrumenter3d(page);

  await page.goto('/diagnostic/amorcer.html');
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { erreur?: string; utilisateurId?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  if (a.utilisateurId === undefined) throw new Error('amorçage sans utilisateur');
  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId: a.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible();
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  await expect(page.getByTestId(TESTID_3D.repli), 'pas de repli 2D').toHaveCount(0);
  const max = Number(await curseur(page).getAttribute('max'));
  expect(max, 'la saison de la ferme T07 couvre plusieurs mois').toBeGreaterThan(20);

  // Balayage de la saison : la semaine la plus chargée en balises, et une semaine avec une planche en fin de récolte.
  let meilleure = { semaine: -1, balises: -1 };
  let semaineFin: number | null = null;
  for (let i = 0; i <= max; i += 1) {
    await allerSemaine(page, i);
    const lues = await lignes(page);
    const n = lues.filter(aBalise).length;
    if (n > meilleure.balises) meilleure = { semaine: i, balises: n };
    if (semaineFin === null && lues.some((l) => l.recolte === 'fin-de-recolte' && l.estompe === 'non')) semaineFin = i;
  }
  console.log(`T32f : semaine de pleine récolte S${String(meilleure.semaine)} avec ${String(meilleure.balises)} planches à récolter ; première semaine avec une fin de récolte : ${String(semaineFin)}`);

  // 1. Q38 : la fin de récolte garde sa balise et reste comptée.
  expect(semaineFin, 'une semaine de la saison où une planche est en fin de récolte').not.toBeNull();
  if (semaineFin === null) return;
  await allerSemaine(page, semaineFin);
  const lues = await lignes(page);
  const attendues = lues.filter(aBalise).length;
  const enFin = lues.filter((l) => l.recolte === 'fin-de-recolte' && l.estompe === 'non');
  expect(enFin.length).toBeGreaterThan(0);
  expect(await nombre(page, 'data-planches-a-recolter'), 'les planches en fin de récolte sont comptées').toBe(attendues);
  expect(await nombre(page, 'data-balises'), 'une balise par planche à récolter ou en fin de récolte').toBe(attendues);
  await expect(resume(page)).toHaveText(phrase(attendues));
  for (const l of enFin) expect(l.texte, 'la ligne dit « dernières récoltes »').toContain(MENTION_DERNIERES_RECOLTES);

  // 2. Une semaine de pleine récolte existe.
  expect(meilleure.balises, 'une semaine en pleine récolte dans la saison de la ferme T07').toBeGreaterThanOrEqual(PLANCHES_PLEINE_RECOLTE_MIN);
  await allerSemaine(page, meilleure.semaine);
  expect(await nombre(page, 'data-balises')).toBe(meilleure.balises);

  // 3. Zoom serré sur la zone la plus chargée : on vole vers chaque zone, on garde celle qui porte le plus de plants en détail et de fruits.
  const zones = await page.getByTestId(T.zone).evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
  expect(zones.length).toBeGreaterThanOrEqual(2);
  let zoneChoisie = { id: zones[0] ?? '', score: -1 };
  for (const id of zones) {
    await page.locator(`[data-testid="${T.zone}"][data-id="${id.replace(/"/g, '\\"')}"]`).click();
    await expect(toile(page)).toHaveAttribute('data-vol', 'non', { timeout: DELAI_MS });
    await page.evaluate(() => new Promise<void>((fini) => { requestAnimationFrame(() => { requestAnimationFrame(() => { fini(); }); }); }));
    const score = (await nombre(page, 'data-fruits')) * 1000 + (await nombre(page, 'data-plants'));
    if (score > zoneChoisie.score) zoneChoisie = { id, score };
  }
  console.log(`T32f : zone retenue ${zoneChoisie.id} (score fruits × 1000 + plants = ${String(zoneChoisie.score)})`);
  await page.locator(`[data-testid="${T.zone}"][data-id="${zoneChoisie.id.replace(/"/g, '\\"')}"]`).click();
  await expect(toile(page)).toHaveAttribute('data-vol', 'non', { timeout: DELAI_MS });

  const boite = await toile(page).boundingBox();
  if (boite === null) throw new Error('toile 3D sans boîte');
  const centre = { x: boite.x + boite.width / 2, y: boite.y + boite.height / 2 };
  const distance = async (): Promise<number> => {
    const p = JSON.parse((await toile(page).getAttribute('data-camera')) ?? 'null') as { position: { x: number; y: number; z: number }; cible: { x: number; y: number; z: number } };
    return Math.hypot(p.position.x - p.cible.x, p.position.y - p.cible.y, p.position.z - p.cible.z);
  };
  const avant = await distance();
  await demarrerImages(page);
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 12; i += 1) {
    await page.mouse.wheel(0, -240);
    await page.evaluate(() => new Promise<void>((fini) => { requestAnimationFrame(() => { requestAnimationFrame(() => { fini(); }); }); }));
  }
  verifierGardeFous('zoom serré en pleine récolte (molette)', await arreterImages(page), BORNES_FERME_T07, 10);
  expect(await distance(), 'la caméra s’est rapprochée').toBeLessThan(avant);
  expect(await nombre(page, 'data-plants'), 'plants en détail au zoom serré').toBeGreaterThan(0);
  expect(await nombre(page, 'data-balises'), 'les balises sont toujours là').toBe(meilleure.balises);

  // Un glissé en pleine récolte, en zoom serré : mêmes garde-fous, bornes de T07 inchangées.
  await demarrerImages(page);
  await glisser(page);
  verifierGardeFous('glissé en zoom serré, pleine récolte', await arreterImages(page), BORNES_FERME_T07, IMAGES_PAR_GLISSE / 2);
  await expect(resume(page)).toHaveText(phrase(await nombre(page, 'data-planches-a-recolter')));
});

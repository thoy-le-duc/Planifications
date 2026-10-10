import { devices, expect, test, type Page } from '@playwright/test';
import { TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import { TESTID_3D_FILTRES as F } from '../src/ecrans/plan3d/test/contrat-filtres.ts';
import { TESTID_3D_RECOLTE as R } from '../src/ecrans/plan3d/test/contrat-recolte.ts';
import { arreterImages, BORNES_DEMO, demarrerImages, instrumenter3d, verifierGardeFous } from './fluidite-3d.ts';

/**
 * T32e — la récolte se voit dans la vue 3D de la démo en ligne (`pnpm e2e:demo`, E2E_DEMO=1),
 * ordinateur (Chromium 1280 × 800, WebGL logiciel), hors ligne. Contrat : src/ecrans/plan3d/test/contrat-recolte.ts
 * (section « Vue 3D (DOM) »).
 *
 * La ferme de la démo est datée par rapport au jour du téléphone (src/demo/remplir.ts) : la courgette
 * de PC-P03 se récolte de J−50 à J+20, la tomate de T2-P07 de J−30 à J+30, la fraise de S1-G01 de J−1 à J+30.
 * Le test cherche donc, semaine par semaine avec le curseur, la semaine voulue, sans connaître la date du jour.
 *
 * Ce que vérifie ce test :
 *   1. une semaine où la courgette est « à récolter » : `data-planches-a-recolter` > 0 et égal au nombre de
 *      planches non estompées dont la ligne de la liste a `data-recolte="a-recolter"` ; `data-balises` lui est
 *      égal ; `data-fruits` > 0 ; le texte `resume-recolte-3d` annonce exactement « N planche(s) à récolter »
 *      (accord) ; le nom accessible de la toile le répète ; la ligne de la courgette dit « à récolter » ;
 *   2. une semaine plus tôt où la courgette est « fruits en formation » : elle n'est pas comptée parmi les planches
 *      à récolter, ses fruits sont déjà dessinés (data-fruits > 0 si la caméra est de près ; au moins pas de balise) ;
 *   3. filtre T27b : décocher toutes les cultures estompe tout, sans balise ni planche annoncée à récolter
 *      (« Aucune planche à récolter ») ; tout recocher rend le compte d'avant ; les lignes de la liste restent ;
 *   4. aucune requête hors de l'origine, aucune écriture ;
 *   5. garde-fous de fluidité de T29b tenus (BORNES_DEMO, inchangés) pendant un glissé sur la semaine à récolter.
 */

const DELAI_MS = 30_000;
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
const curseur = (page: Page) => page.getByTestId(TESTID_3D.curseur);
const resume = (page: Page) => page.getByTestId(R.resume);

type Phase = 'aucune' | 'fruits-en-formation' | 'a-recolter' | 'fin-de-recolte';
interface LigneLue {
  readonly culture: string;
  readonly recolte: string;
  readonly estompe: string;
  readonly texte: string;
}

const nombre = async (page: Page, attribut: string): Promise<number> => Number(await toile(page).getAttribute(attribut));
const phrase = (n: number): string => (n === 0 ? 'Aucune planche à récolter' : n === 1 ? '1 planche à récolter' : `${String(n)} planches à récolter`);

async function lignes(page: Page): Promise<LigneLue[]> {
  return page.getByTestId(TESTID_3D.elementListe).evaluateAll((els) =>
    els.map((e) => ({
      culture: (e as HTMLElement).dataset.culture ?? '',
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

/** Première semaine (en partant de `depuis`) où une courgette est dans la phase demandée, ou null. */
async function chercherCourgette(page: Page, phase: Phase, depuis: number, jusqua: number): Promise<number | null> {
  for (let i = depuis; i <= jusqua; i += 1) {
    await allerSemaine(page, i);
    if ((await lignes(page)).some((l) => l.culture.startsWith('Courgette') && l.recolte === phase)) return i;
  }
  return null;
}

test('récolte visible dans la 3D de la démo : balises, fruits et « N planches à récolter », hors ligne', async ({ page, context, baseURL }) => {
  test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');
  test.setTimeout(300_000);
  await instrumenter3d(page);
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
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
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  await expect(page.getByTestId(TESTID_3D.repli), 'pas de repli 2D').toHaveCount(0);
  const max = Number(await curseur(page).getAttribute('max'));
  expect(max, 'la démo couvre plusieurs mois').toBeGreaterThan(20);

  // 1. Une semaine où la courgette est à récolter.
  const semaineRecolte = await chercherCourgette(page, 'a-recolter', 0, max);
  expect(semaineRecolte, 'une semaine de la démo où la courgette est à récolter').not.toBeNull();
  if (semaineRecolte === null) return;
  await allerSemaine(page, semaineRecolte);

  const aRecolter = await nombre(page, 'data-planches-a-recolter');
  expect(aRecolter, 'data-planches-a-recolter > 0').toBeGreaterThan(0);
  const lues = await lignes(page);
  const attendues = lues.filter((l) => l.recolte === 'a-recolter' && l.estompe === 'non');
  expect(aRecolter, 'autant de planches annoncées que de lignes « à récolter » non estompées').toBe(attendues.length);
  expect(await nombre(page, 'data-balises'), 'une balise par planche à récolter').toBe(aRecolter);
  // Les fruits ne se dessinent que sur les planches en détail : on vole vers la zone de la courgette.
  await page.getByRole('button', { name: 'Aller à Plein champ' }).click();
  await expect.poll(() => nombre(page, 'data-fruits'), { timeout: DELAI_MS, message: 'des fruits sont dessinés, vus de près' }).toBeGreaterThan(0);
  for (const l of attendues) expect(l.texte, 'la ligne de la planche dit « à récolter »').toContain('à récolter');
  const courgette = lues.find((l) => l.culture.startsWith('Courgette') && l.recolte === 'a-recolter');
  expect(courgette, 'la courgette est une planche à récolter').toBeDefined();

  await expect(resume(page)).toBeVisible();
  await expect(resume(page)).toHaveText(phrase(aRecolter));
  expect(await resume(page).getAttribute('role'), 'annoncé aux lecteurs d’écran').toBe('status');
  expect(await toile(page).getAttribute('aria-label'), 'l’alternative texte de la toile annonce aussi le nombre').toContain(phrase(aRecolter));

  // 2. Une semaine plus tôt : la courgette forme ses fruits ; elle n'est pas comptée.
  const semaineFormation = await chercherCourgette(page, 'fruits-en-formation', 0, semaineRecolte);
  expect(semaineFormation, 'une semaine où la courgette forme ses fruits').not.toBeNull();
  if (semaineFormation !== null) {
    expect(semaineFormation, 'la formation précède la récolte').toBeLessThan(semaineRecolte);
    await allerSemaine(page, semaineFormation);
    const lignesFormation = await lignes(page);
    const attendues2 = lignesFormation.filter((l) => l.recolte === 'a-recolter' && l.estompe === 'non').length;
    expect(await nombre(page, 'data-planches-a-recolter'), 'la planche en formation n’est pas à récolter').toBe(attendues2);
    await expect(resume(page)).toHaveText(phrase(attendues2));
    expect(lignesFormation.find((l) => l.culture.startsWith('Courgette'))?.texte ?? '', 'la courgette en formation n’est pas annoncée « à récolter »').not.toContain('à récolter');
  }

  // 3. Filtre T27b : tout décocher estompe tout, sans balise ni planche annoncée.
  await allerSemaine(page, semaineRecolte);
  const nbLignes = (await lignes(page)).length;
  await page.locator(`[data-testid="${F.rien}"][data-dimension="cultures"]`).click();
  await expect(toile(page)).toHaveAttribute('data-planches-a-recolter', '0');
  await expect(toile(page)).toHaveAttribute('data-balises', '0');
  await expect(resume(page)).toHaveText('Aucune planche à récolter');
  const estompees = await lignes(page);
  expect(estompees.length, 'estompé ≠ retiré').toBe(nbLignes);
  expect(estompees.every((l) => l.estompe === 'oui')).toBe(true);
  await page.locator(`[data-testid="${F.tout}"][data-dimension="cultures"]`).click();
  await expect(toile(page)).toHaveAttribute('data-planches-a-recolter', String(aRecolter));
  await expect(resume(page)).toHaveText(phrase(aRecolter));

  // 4. Garde-fous de fluidité de T29b (BORNES_DEMO inchangés) pendant un glissé, récolte affichée.
  const boite = await toile(page).boundingBox();
  if (boite === null) throw new Error('toile 3D sans boîte');
  const x0 = boite.x + boite.width / 2;
  const y0 = boite.y + boite.height / 2;
  await demarrerImages(page);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 40; i += 1) {
    await page.mouse.move(x0 + i * 3, y0 + ((i % 20) - 10) * 2);
    await page.evaluate(() => new Promise<void>((fini) => { requestAnimationFrame(() => { fini(); }); }));
  }
  await page.mouse.up();
  verifierGardeFous('navigation de la démo 3D, récolte affichée', await arreterImages(page), BORNES_DEMO, 10);

  // 5. Rien n'a quitté l'appareil, rien n'a été écrit.
  const sortantes = requetes.filter((r) => !r.url.startsWith(baseURL ?? 'http://localhost') && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  expect(sortantes, 'aucune requête hors de l’origine').toEqual([]);
  expect(requetes.filter((r) => r.methode !== 'GET' && r.methode !== 'HEAD'), 'aucune écriture').toEqual([]);
});

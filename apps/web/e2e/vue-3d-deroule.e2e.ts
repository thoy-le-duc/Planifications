import { devices, expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { MARQUES_3D, TESTID_3D } from '../src/ecrans/plan3d/test/contrat.ts';
import { ATTRIBUTS_DEROULE, MARQUE_LECTURE, TESTID_DEROULE } from '../src/ecrans/plan3d/test/contrat-deroule.ts';
import { arreterImages, demarrerImages, instrumenter3d } from './fluidite-3d.ts';
import { ralentirCpu, RALENTISSEMENT_CPU, surveillerCsp } from './outils.ts';

/**
 * T59 (Q44) — dérouler la saison dans la vue 3D, de bout en bout, sur la grande ferme de T07 placée
 * (`?jeu=t07-place`, la plus lourde des essais), Chromium 1280 × 800, WebGL logiciel, CPU ralenti ×4
 * (le téléphone de mesure). Contrat : src/ecrans/plan3d/test/contrat-deroule.ts. Les mesures de T27
 * à T29b restent celles de vue-3d.e2e.ts, vue-3d-jumeau.e2e.ts et fluidite-3d.ts : aucun seuil n'y
 * est changé.
 *
 * ── Ce que vérifie ce fichier ────────────────────────────────────────────────────────────────
 *   1. à l'ouverture : bouton « Lecture » au repos, vitesse 1 semaine par seconde, « Prévu seul »
 *      décoché ;
 *   2. lecture à 4 semaines par seconde depuis 8 semaines avant la fin : les 8 semaines défilent
 *      dans l'ordre, la lecture s'arrête d'elle-même sur la dernière (bouton revenu à « Lecture ») ;
 *   3. fluidité : chaque changement de semaine est dessiné (marque de la lecture → marque de
 *      l'image de la semaine) en 50 ms au plus EN MOYENNE, et le JavaScript par image dessinée
 *      reste sous 50 ms en moyenne, caméra glissée pendant la lecture ;
 *   4. la caméra reste libre pendant la lecture (la glisser la déplace) ;
 *   5. les plants ne se recalculent qu'une fois par semaine affichée (`data-calculs-plants`) ;
 *   6. à 1 semaine par seconde : 2 semaines en 2 s environ ;
 *   7. « Prévu seul » recalcule les plants une fois, sans lancer la lecture ; aucune violation de la CSP.
 */

const DELAI_AMORCAGE_MS = 120_000;
const DELAI_MS = 30_000;
/** T59, règle 5 : pas d'image au-delà de 50 ms en moyenne (CPU ×4). */
const IMAGE_MOYENNE_MAX_MS = 50;
const SEMAINES_LUES = 8;
const IMAGES_GLISSE = 40;

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
const lecture = (page: Page) => page.getByTestId(TESTID_DEROULE.lecture);

const calculsPlants = async (page: Page): Promise<number> => Number(await vue(page).getAttribute(ATTRIBUTS_DEROULE.calculsPlants));

async function ouvrir3d(page: Page): Promise<void> {
  await page.goto('/diagnostic/amorcer.html?jeu=t07-place');
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
  await expect(page.getByTestId(TESTID_3D.repli)).toHaveCount(0);
}

/** Place le curseur sur la semaine `cible` (clavier : début, puis flèches). */
async function allerALaSemaine(page: Page, cible: number): Promise<void> {
  await curseur(page).focus();
  await curseur(page).press('Home');
  for (let i = 0; i < cible; i += 1) await curseur(page).press('ArrowRight');
  await expect(vue(page)).toHaveAttribute('data-semaine', String(cible));
  await expect(toile(page)).toHaveAttribute('data-semaine-plants', String(cible));
}

/** Les marques de la lecture et des images de semaine, avec leur semaine. */
async function marques(page: Page): Promise<{ lecture: { t: number; semaine: number }[]; image: { t: number; semaine: number }[] }> {
  return page.evaluate(
    ([l, i]) => {
      const lire = (nom: string) =>
        performance.getEntriesByName(nom, 'mark').map((m) => {
          const detail = (m as PerformanceMark).detail as { semaine?: number } | null | undefined;
          return { t: m.startTime, semaine: detail?.semaine ?? -1 };
        });
      return { lecture: lire(l), image: lire(i) };
    },
    [MARQUE_LECTURE, MARQUES_3D.semaine] as const,
  );
}

async function effacerMarques(page: Page): Promise<void> {
  await page.evaluate((noms) => {
    for (const n of noms) performance.clearMarks(n);
  }, [MARQUE_LECTURE, MARQUES_3D.semaine]);
}

/** Intervalles (ms) entre images du navigateur, relevés jusqu'à `arreterIntervalles`. */
async function releverIntervalles(page: Page): Promise<void> {
  await page.evaluate(() => {
    const f = window as unknown as { __intervallesT59?: number[]; __arretT59?: boolean };
    const intervalles: number[] = [];
    f.__intervallesT59 = intervalles;
    f.__arretT59 = false;
    let precedent = -1;
    const image = (t: number) => {
      if (precedent >= 0) intervalles.push(t - precedent);
      precedent = t;
      if (f.__arretT59 !== true) requestAnimationFrame(image);
    };
    requestAnimationFrame(image);
  });
}

async function arreterIntervalles(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const f = window as unknown as { __intervallesT59?: number[]; __arretT59?: boolean };
    f.__arretT59 = true;
    return f.__intervallesT59 ?? [];
  });
}

const moyenne = (v: readonly number[]): number => (v.length === 0 ? Number.NaN : v.reduce((s, x) => s + x, 0) / v.length);

test('déroulé de la saison 3D : grande ferme de T07 placée, CPU ×4', async ({ page }) => {
  test.skip(process.env.E2E_DEMO === '1', 'grande ferme de T07 : essais seulement');
  test.setTimeout(DELAI_AMORCAGE_MS + 180_000);
  const violations = await surveillerCsp(page);
  await instrumenter3d(page);
  await ouvrir3d(page);
  const max = Number(await curseur(page).getAttribute('max'));
  expect(max, 'une saison de plus de 8 semaines').toBeGreaterThan(SEMAINES_LUES);

  await test.step('à l’ouverture : « Lecture » au repos, 1 semaine par seconde, « Prévu seul » décoché', async () => {
    await expect(lecture(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(lecture(page)).toHaveAccessibleName(/Lecture/);
    await expect(vue(page)).toHaveAttribute(ATTRIBUTS_DEROULE.lecture, 'pause');
    await expect(page.getByTestId(TESTID_DEROULE.vitesse)).toHaveValue('1');
    await expect(page.getByTestId(TESTID_DEROULE.prevuSeul)).not.toBeChecked();
  });

  const depart = max - SEMAINES_LUES;
  await allerALaSemaine(page, depart);
  await page.getByTestId(TESTID_DEROULE.vitesse).selectOption('4');
  await ralentirCpu(page);

  await test.step(`lecture à 4 semaines par seconde, CPU ×${String(RALENTISSEMENT_CPU)} : ${String(SEMAINES_LUES)} semaines dans l’ordre, arrêt en fin de saison, images ≤ ${String(IMAGE_MOYENNE_MAX_MS)} ms en moyenne`, async () => {
    const calculsAvant = await calculsPlants(page);
    const cameraAvant = await toile(page).getAttribute('data-camera');
    await effacerMarques(page);
    await demarrerImages(page);
    await releverIntervalles(page);
    await lecture(page).click();
    await expect(lecture(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(lecture(page)).toHaveAccessibleName(/Pause/);

    // La caméra reste libre : on la glisse pendant la lecture.
    const boite = await toile(page).boundingBox();
    if (boite === null) throw new Error('toile 3D sans boîte');
    const x0 = boite.x + boite.width / 3;
    const y0 = boite.y + boite.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= IMAGES_GLISSE; i += 1) {
      await page.mouse.move(x0 + i * 4, y0 + ((i % 10) - 5));
      await page.evaluate(
        () =>
          new Promise<void>((fini) => {
            requestAnimationFrame(() => {
              fini();
            });
          }),
      );
    }
    await page.mouse.up();

    await expect(vue(page)).toHaveAttribute(ATTRIBUTS_DEROULE.lecture, 'pause', { timeout: 15_000 });
    const intervalles = (await arreterIntervalles(page)).slice(2);
    const images = await arreterImages(page);
    await expect(lecture(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(vue(page)).toHaveAttribute('data-semaine', String(max));
    await expect(toile(page)).toHaveAttribute('data-semaine-plants', String(max));
    expect(await toile(page).getAttribute('data-camera'), 'la caméra a bougé pendant la lecture').not.toBe(cameraAvant);

    const { lecture: lues, image } = await marques(page);
    expect(lues.map((x) => x.semaine), 'semaines annoncées, dans l’ordre').toEqual(Array.from({ length: SEMAINES_LUES }, (_, i) => depart + 1 + i));
    const tempsImages = lues.map((l) => {
      const suivante = image.find((x) => x.semaine === l.semaine && x.t >= l.t);
      return suivante === undefined ? Number.POSITIVE_INFINITY : suivante.t - l.t;
    });
    const jsMoyen = moyenne(images.map((i) => i.js));
    const intervalleMoyen = moyenne(intervalles);
    console.log(
      `déroulé 3D (T07 placée, CPU ×${String(RALENTISSEMENT_CPU)}) : image d’un changement de semaine ${tempsImages.map((t) => t.toFixed(1)).join(', ')} ms, moyenne ${moyenne(tempsImages).toFixed(1)} ms (max ${String(IMAGE_MOYENNE_MAX_MS)}) ;` +
        ` JavaScript par image dessinée moyen ${jsMoyen.toFixed(2)} ms sur ${String(images.length)} images ; intervalle moyen entre images ${intervalleMoyen.toFixed(1)} ms sur ${String(intervalles.length)}`,
    );
    expect(moyenne(tempsImages), 'image d’un changement de semaine, moyenne (ms)').toBeLessThanOrEqual(IMAGE_MOYENNE_MAX_MS);
    expect(images.length, 'images dessinées pendant la lecture').toBeGreaterThanOrEqual(SEMAINES_LUES);
    expect(jsMoyen, 'JavaScript par image dessinée, moyenne (ms)').toBeLessThanOrEqual(IMAGE_MOYENNE_MAX_MS);

    const calculs = (await calculsPlants(page)) - calculsAvant;
    expect(calculs, 'un calcul des plants par semaine affichée, pas plus').toBeLessThanOrEqual(SEMAINES_LUES);
    expect(calculs, 'les plants suivent la semaine').toBeGreaterThanOrEqual(1);
  });

  await test.step('à 1 semaine par seconde : 2 semaines en 2 s environ, puis arrêt', async () => {
    await allerALaSemaine(page, max - 2);
    await page.getByTestId(TESTID_DEROULE.vitesse).selectOption('1');
    await effacerMarques(page);
    const debut = await page.evaluate(() => performance.now());
    await lecture(page).click();
    await expect(vue(page)).toHaveAttribute(ATTRIBUTS_DEROULE.lecture, 'pause', { timeout: 10_000 });
    const { lecture: lues } = await marques(page);
    expect(lues.map((x) => x.semaine)).toEqual([max - 1, max]);
    const duree = (lues.at(-1)?.t ?? Number.NaN) - debut;
    expect(duree, 'durée de la lecture de 2 semaines (ms)').toBeGreaterThanOrEqual(1_900);
    expect(duree).toBeLessThanOrEqual(3_000);
  });

  await test.step('« Prévu seul » : les plants se recalculent une fois, la lecture ne part pas', async () => {
    const avant = await calculsPlants(page);
    await page.getByTestId(TESTID_DEROULE.prevuSeul).check();
    await expect.poll(() => calculsPlants(page)).toBe(avant + 1);
    await expect(vue(page)).toHaveAttribute(ATTRIBUTS_DEROULE.lecture, 'pause');
    await page.getByTestId(TESTID_DEROULE.prevuSeul).uncheck();
    await expect.poll(() => calculsPlants(page)).toBe(avant + 2);
  });

  await test.step('toucher le curseur pendant la lecture la met en pause', async () => {
    await allerALaSemaine(page, 0);
    await lecture(page).click();
    await expect(vue(page)).toHaveAttribute(ATTRIBUTS_DEROULE.lecture, 'lecture');
    await curseur(page).press('End');
    await expect(vue(page)).toHaveAttribute(ATTRIBUTS_DEROULE.lecture, 'pause');
    await expect(vue(page)).toHaveAttribute('data-semaine', String(max));
  });

  expect(await violations(), 'violations de la CSP').toEqual([]);
});

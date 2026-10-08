import { devices, expect, test, type Page } from '@playwright/test';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { placerJeuT07 } from '../../../packages/sync/src/test/placement-t07.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import type { ModuleCalculsPlan } from '../src/ecrans/plan/test/contrat.ts';
import { MARQUES_3D, TESTID_3D, type ModuleScene } from '../src/ecrans/plan3d/test/contrat.ts';
import { type CibleVol, type ModuleCadrage, TESTID_3D_CAMERA } from '../src/ecrans/plan3d/test/contrat-camera.ts';
import { TESTID_3D_JUMEAU, type PlanJumeau, type SceneJumeau, type ModuleJumeau } from '../src/ecrans/plan3d/test/contrat-jumeau.ts';
import { decrireSerie, repeterMesures, REPETITIONS_MESURE, surveillerCsp, type PassageDefilement } from './outils.ts';
import { arreterImages, BORNES_DEMO, BORNES_JUMEAU_T07, decrireRelatif, demarrerImages, instrumenter3d, jugerDefilementRelatif, mesurerPlancher, verifierGardeFous } from './fluidite-3d.ts';

/**
 * T28c — jumeau 3D, de bout en bout, sur ordinateur (Chromium 1280 × 800, WebGL logiciel).
 * Contrat (data-testid, data-*, règles de la scène) : src/ecrans/plan3d/test/contrat-jumeau.ts.
 *
 * ── Ce que vérifie ce fichier ───────────────────────────────────────────────────────────────
 *   1. grande ferme de T07 PLACÉE (`?jeu=t07-place` : 12 serres, 14 zones à contour, magasin et
 *      hangar) : les mesures de T27 tiennent — affichage < 1 s après le chargement du module
 *      (médiane de 5, max 1,5 s), changement de semaine < 100 ms (médiane de 5, max 150 ms), rendu
 *      à la demande, au plus 2 images perdues d'affilée au glissé (même statistique que T27) ;
 *   2. la vue dessine le jumeau : `data-batiments`, `data-arceaux`, `data-placees` égaux à ce que
 *      `versScene` calcule sous Node pour la même base ; la liste texte des bâtiments aussi ;
 *   3. le vol de T29 vise une serre (bouton « Aller à <zone> » d'une zone abritée) ;
 *   4. une ferme sans placement (T07 d'origine) : aucun bâtiment, rien de placé (repli de T27) ;
 *   5. la démo en ligne (pnpm e2e:demo, E2E_DEMO=1) : la vue 3D s'ouvre HORS LIGNE avec ses serres ;
 *   6. aucune violation de la CSP.
 * Le poids (budget 3D de 200 Kio, JS de démarrage de 71 Kio) reste vérifié par scripts/vue3d.test.ts
 * et `pnpm budget` ; budget.json ne bouge pas sans justification.
 */

const CHEMIN_CALCULS = '../src/ecrans/plan/calculs.ts';
const CHEMIN_SCENE = '../src/ecrans/plan3d/scene.ts';
const CHEMIN_CADRAGE = '../src/ecrans/plan3d/cadrage.ts';
const DELAI_AMORCAGE_MS = 120_000;

const BUDGET_AFFICHAGE_MS = 1_000;
const BUDGET_SEMAINE_MS = 100;
const FACTEUR_MAXIMUM = 1.5;
const IMAGES_PERDUES_MAX = 2;
const PASSAGES_SACCADES_ECHEC = 4;
const RAFALES_TOTAL_MAX = 6;
const IMAGES_PAR_PASSAGE = 120;
const ECART_CIBLE_M = 0.5;

const executablePath = process.env.CHROMIUM_PATH;

test.use({
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
});

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

interface Attendu {
  readonly plan: PlanJumeau;
  readonly scene: SceneJumeau;
  readonly versScene: ModuleJumeau & ModuleScene;
  readonly cadrage: ModuleCadrage;
  readonly utilisateurId: string;
  readonly fermeId: string;
}

/** Le plan de la grande ferme de T07 (placée ou non) et sa scène, recalculés sous Node. */
async function planAttendu(placee: boolean): Promise<Attendu> {
  const calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  const versScene = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleJumeau & ModuleScene;
  const cadrage = (await import(/* @vite-ignore */ CHEMIN_CADRAGE)) as ModuleCadrage;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    if (placee) await placerJeuT07(base, jeu.principale.fermeId);
    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    const aujourdhui = jourLocal(new Date());
    const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, jeu.principale.fermeId), aujourdhui);
    if (saison === null) throw new Error('jeu de T07 sans saison');
    const plan = (await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison, aujourdhui })) as unknown as PlanJumeau;
    return { plan, scene: versScene.versScene(plan, plan.semaineCourante ?? 0), versScene, cadrage, utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId };
  } finally {
    base.fermer();
  }
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const vue = (page: Page) => page.getByTestId(TESTID_3D.vue);
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
const curseur = (page: Page) => page.getByTestId(TESTID_3D.curseur);

async function ouvrirPlanches(page: Page, attendu: Attendu, jeu: string): Promise<void> {
  await page.goto(`/diagnostic/amorcer.html${jeu}`);
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { erreur?: string; fermeId?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  expect(a.fermeId).toBe(attendu.fermeId);

  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId: attendu.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  await onglet(page, 'Planches').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
  await expect(page.getByTestId('barre').first()).toBeVisible();
}

/** Clique « Voir en 3D » ; renvoie le temps (ms) entre la marque du module chargé et celle de la vue affichée. */
async function ouvrirEn3d(page: Page): Promise<number> {
  await page.evaluate((marques) => {
    for (const m of marques) performance.clearMarks(m);
  }, Object.values(MARQUES_3D));
  await page.getByTestId(TESTID_3D.bouton).click();
  await page.waitForFunction((m) => performance.getEntriesByName(m, 'mark').length > 0, MARQUES_3D.affichee, { timeout: 30_000 });
  return page.evaluate(
    ([module = '', affichee = '']) => {
      const t = (nom: string) => performance.getEntriesByName(nom, 'mark')[0]?.startTime ?? Number.NaN;
      return t(affichee) - t(module);
    },
    [MARQUES_3D.module, MARQUES_3D.affichee],
  );
}

const semaineAffichee = async (page: Page): Promise<number> => Number(await vue(page).getAttribute('data-semaine'));

async function changerDeSemaine(page: Page, touche: 'ArrowRight' | 'ArrowLeft'): Promise<number> {
  await page.evaluate((marque) => {
    performance.clearMarks(marque);
    const f = window as unknown as { __touche?: number };
    delete f.__touche;
    document.addEventListener(
      'keydown',
      (e) => {
        f.__touche = e.timeStamp;
      },
      { capture: true, once: true },
    );
  }, MARQUES_3D.semaine);
  await curseur(page).press(touche);
  await page.waitForFunction((m) => performance.getEntriesByName(m, 'mark').length > 0, MARQUES_3D.semaine);
  return page.evaluate((marque) => {
    const touche = (window as unknown as { __touche?: number }).__touche ?? Number.NaN;
    const m = performance.getEntriesByName(marque, 'mark').at(-1) as PerformanceMark | undefined;
    return (m?.startTime ?? Number.NaN) - touche;
  }, MARQUES_3D.semaine);
}

async function glisserUneFois(page: Page, sens: 1 | -1): Promise<PassageDefilement & { rendus: number }> {
  const boite = await toile(page).boundingBox();
  if (boite === null) throw new Error('toile 3D sans boîte');
  const x0 = boite.x + boite.width / 2 - (sens * boite.width) / 4;
  const y0 = boite.y + boite.height / 2;
  const rendusAvant = Number(await toile(page).getAttribute('data-rendus'));
  await page.evaluate(() => {
    const intervalles: number[] = [];
    const f = window as unknown as { __intervalles?: number[]; __arret?: boolean };
    f.__intervalles = intervalles;
    f.__arret = false;
    let precedent = -1;
    const image = (t: number) => {
      if (precedent >= 0) intervalles.push(t - precedent);
      precedent = t;
      if (f.__arret !== true) requestAnimationFrame(image);
    };
    requestAnimationFrame(image);
  });
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= IMAGES_PAR_PASSAGE; i += 1) {
    await page.mouse.move(x0 + sens * i * 3, y0 + ((i % 20) - 10) * 2);
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
  const intervalles = await page.evaluate(() => {
    const f = window as unknown as { __intervalles?: number[]; __arret?: boolean };
    f.__arret = true;
    return f.__intervalles ?? [];
  });
  return { intervalles: intervalles.slice(2), rendus: Number(await toile(page).getAttribute('data-rendus')) - rendusAvant };
}

/** Ce que la toile annonce du jumeau. */
async function lireJumeau(page: Page): Promise<{ batiments: number; arceaux: number; placees: number }> {
  const t = toile(page);
  return { batiments: Number(await t.getAttribute('data-batiments')), arceaux: Number(await t.getAttribute('data-arceaux')), placees: Number(await t.getAttribute('data-placees')) };
}

const attenduJumeau = (s: SceneJumeau) => ({
  batiments: s.batiments.length,
  arceaux: s.batiments.reduce((n, b) => n + b.arceaux.length, 0),
  placees: s.volumes.filter((v) => v.placee).length,
});

test('jumeau 3D : grande ferme de T07 placée, ordinateur, WebGL', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 300_000);
  const attendu = await planAttendu(true);
  const { plan, scene } = attendu;
  const nbPlanches = plan.lignes.filter((l) => l.sorte === 'emplacement').length;
  expect(nbPlanches, 'grande ferme').toBeGreaterThanOrEqual(400);
  expect(scene.batiments.length, 'la ferme de l’essai est placée').toBe(14);
  expect(attenduJumeau(scene).arceaux, 'serres en tunnels').toBeGreaterThan(200);
  const violations = await surveillerCsp(page);
  await instrumenter3d(page);

  await ouvrirPlanches(page, attendu, '?jeu=t07-place');

  await test.step('ouverture : vue affichée moins de 1 s après le chargement du module (médiane de 5, max 1,5 s)', async () => {
    const series = await repeterMesures(REPETITIONS_MESURE, async (i) => {
      const affichage = await ouvrirEn3d(page);
      await expect(vue(page)).toHaveAttribute('data-etat', 'pret');
      await expect(toile(page)).toHaveAttribute('data-volumes', String(nbPlanches));
      if (i < REPETITIONS_MESURE - 1) {
        await page.getByTestId(TESTID_3D.retour2d).click();
        await expect(vue(page)).toHaveCount(0);
      }
      return { affichage };
    });
    console.log(decrireSerie('jumeau 3D, affichage après chargement du module', series.affichage, BUDGET_AFFICHAGE_MS));
    expect(series.affichage.mediane, 'affichage (médiane)').toBeLessThan(BUDGET_AFFICHAGE_MS);
    expect(Math.max(...series.affichage.valeurs), 'affichage (plus haute valeur)').toBeLessThan(BUDGET_AFFICHAGE_MS * FACTEUR_MAXIMUM);
  });

  await test.step('la vue dessine le jumeau : bâtiments, arceaux et planches placées comme versScene', async () => {
    const lu = await lireJumeau(page);
    expect(lu).toEqual(attenduJumeau(scene));
    expect(lu.batiments).toBe(14);
    expect(lu.placees).toBeGreaterThan(200);
  });

  await test.step('alternative texte : une entrée par bâtiment, avec son nom', async () => {
    const liste = page.getByTestId(TESTID_3D_JUMEAU.listeBatiments);
    await expect(liste).toBeAttached();
    await expect(page.getByRole('list', { name: 'Bâtiments' })).toBeAttached();
    const elements = page.getByTestId(TESTID_3D_JUMEAU.elementBatiment);
    await expect(elements).toHaveCount(scene.batiments.length);
    const lus = await elements.evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-id') ?? '', texte: e.textContent.trim() })));
    expect(lus.map((e) => e.id)).toEqual(scene.batiments.map((b) => b.id));
    for (const [i, e] of lus.entries()) expect(e.texte).toContain(scene.batiments[i]?.nom ?? '');
  });

  await test.step('changer de semaine : image dessinée en moins de 100 ms (médiane de 5, max 150 ms), la géométrie ne bouge pas', async () => {
    await curseur(page).focus();
    const avant = await lireJumeau(page);
    const touches = ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft'] as const;
    const series = await repeterMesures(touches.length, async (i) => ({ semaine: await changerDeSemaine(page, touches[i] ?? 'ArrowRight') }));
    console.log(decrireSerie('jumeau 3D, changement de semaine', series.semaine, BUDGET_SEMAINE_MS));
    expect(series.semaine.mediane, 'changement de semaine (médiane)').toBeLessThan(BUDGET_SEMAINE_MS);
    expect(Math.max(...series.semaine.valeurs), 'changement de semaine (plus haute valeur)').toBeLessThan(BUDGET_SEMAINE_MS * FACTEUR_MAXIMUM);
    expect(await lireJumeau(page), 'mêmes bâtiments, arceaux et planches placées d’une semaine à l’autre').toEqual(avant);
    expect(await semaineAffichee(page)).toBeGreaterThanOrEqual(0);
  });

  await test.step('rendu à la demande : au repos, aucune image n’est dessinée (les bâches ne forcent pas de boucle)', async () => {
    await page.waitForTimeout(500);
    const avant = Number(await toile(page).getAttribute('data-rendus'));
    await page.waitForTimeout(1_000);
    expect(Number(await toile(page).getAttribute('data-rendus')), 'images dessinées pendant 1 s de repos').toBe(avant);
  });

  await test.step('navigation au pointeur : 5 passages, aucun intervalle au-delà du seuil relatif au plancher', async () => {
    // Plancher du rendu logiciel dans ce lancement : l'intervalle fautif en dépend (fluidite-3d.ts).
    const b = await toile(page).boundingBox();
    if (b === null) throw new Error('toile 3D sans boîte');
    const plancher = await mesurerPlancher(page, b.width, b.height, IMAGES_PERDUES_MAX);
    console.log(`plancher du rendu logiciel : intervalle médian ${plancher.medianeMs.toFixed(1)} ms, intervalle fautif au-delà de ${plancher.seuilFautifMs.toFixed(1)} ms`);
    expect(plancher.medianeMs, 'plancher mesuré').toBeGreaterThan(0);
    const passages: (PassageDefilement & { rendus: number })[] = [];
    await demarrerImages(page);
    for (let i = 0; i < REPETITIONS_MESURE; i += 1) passages.push(await glisserUneFois(page, i % 2 === 0 ? 1 : -1));
    verifierGardeFous('navigation du jumeau 3D', await arreterImages(page), BORNES_JUMEAU_T07, IMAGES_PAR_PASSAGE);
    const verdict = jugerDefilementRelatif(passages, plancher.seuilFautifMs, PASSAGES_SACCADES_ECHEC, RAFALES_TOTAL_MAX);
    console.log(decrireRelatif('navigation du jumeau 3D', plancher, verdict));
    for (const [i, p] of passages.entries()) expect(p.rendus, `passage ${String(i + 1)} : la caméra a bougé`).toBeGreaterThan(IMAGES_PAR_PASSAGE / 4);
    expect(verdict.passagesSaccades, 'passages dont un intervalle dépasse le seuil relatif au plancher').toBeLessThan(PASSAGES_SACCADES_ECHEC);
    expect(verdict.fautifsTotal, 'intervalles au-delà du seuil').toBeLessThanOrEqual(RAFALES_TOTAL_MAX);
    expect(verdict.fluide).toBe(true);
  });

  await test.step('le vol de T29 vise une serre : « Aller à <zone> » cadre le rectangle de la serre', async () => {
    const serre = scene.socles.find((z) => z.batimentId !== null && scene.batiments.some((b) => b.id === z.batimentId && b.forme === 'chapelles'));
    if (serre === undefined) throw new Error('aucune zone sous serre chapelle dans la ferme de l’essai');
    const cible: CibleVol = { sorte: 'zone', id: serre.id };
    const boite = attendu.cadrage.boiteDe(scene, cible);
    if (boite === null) throw new Error('boîte de la serre nulle');
    await page.locator(`[data-testid="${TESTID_3D_CAMERA.zone}"][data-id="${serre.id}"]`).click();
    await expect(toile(page)).toHaveAttribute('data-vol', 'non', { timeout: 5_000 });
    const pose = JSON.parse((await toile(page).getAttribute('data-camera')) ?? 'null') as { cible: { x: number; z: number } } | null;
    expect(Math.abs((pose?.cible.x ?? Number.NaN) - (boite.min.x + boite.max.x) / 2), 'cible en x = centre de la serre').toBeLessThan(ECART_CIBLE_M);
    expect(Math.abs((pose?.cible.z ?? Number.NaN) - (boite.min.z + boite.max.z) / 2), 'cible en z = centre de la serre').toBeLessThan(ECART_CIBLE_M);
  });

  await test.step('retour au plan 2D', async () => {
    await page.getByTestId(TESTID_3D.retour2d).click();
    await expect(vue(page)).toHaveCount(0);
    await expect(page.getByTestId('plan-defilement')).toBeVisible();
  });

  expect(await violations(), 'violations de la CSP (three, fiber)').toEqual([]);
});

test('jumeau 3D : une ferme sans placement garde la disposition de T27 (aucun bâtiment, rien de placé)', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
  const attendu = await planAttendu(false);
  const nbPlanches = attendu.plan.lignes.filter((l) => l.sorte === 'emplacement').length;
  expect(attendu.scene.batiments).toEqual([]);
  await ouvrirPlanches(page, attendu, '');
  await ouvrirEn3d(page);
  await expect(toile(page)).toHaveAttribute('data-volumes', String(nbPlanches));
  expect(await lireJumeau(page)).toEqual({ batiments: 0, arceaux: 0, placees: 0 });
  await expect(page.getByTestId(TESTID_3D_JUMEAU.listeBatiments)).toHaveCount(0);
});

test('jumeau 3D sur la démo : la vue 3D s’ouvre hors ligne avec ses serres', async ({ page, context }) => {
  test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');
  const DELAI_MS = 30_000;
  await instrumenter3d(page);
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: DELAI_MS });
  // Le morceau 3D est précaché dès la première visite (principe 4) : on coupe le réseau avant de l'ouvrir.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_MS });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: DELAI_MS });
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: DELAI_MS });
  await expect(page.getByTestId(TESTID_3D.repli), 'pas de repli 2D').toHaveCount(0);
  const lu = await lireJumeau(page);
  expect(lu.batiments, 'la démo a ses serres et son magasin').toBeGreaterThanOrEqual(3);
  expect(lu.arceaux, 'arceaux des serres').toBeGreaterThan(10);
  expect(lu.placees, 'planches placées').toBeGreaterThanOrEqual(3);
  const noms = await page.getByTestId(TESTID_3D_JUMEAU.elementBatiment).evaluateAll((els) => els.map((e) => e.textContent.trim().toLowerCase()));
  expect(noms.length).toBe(lu.batiments);
  expect(noms.some((n) => n.includes('magasin')), 'le magasin est dans la liste').toBe(true);
  expect(noms.filter((n) => /serre|tunnel|chapelle/.test(n)).length, 'au moins deux serres nommées').toBeGreaterThanOrEqual(2);

  // Garde-fous de dessin sur la démo : un glissé de 40 images (JavaScript par image, appels de dessin, triangles).
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
  verifierGardeFous('navigation de la démo 3D', await arreterImages(page), BORNES_DEMO, 10);
});

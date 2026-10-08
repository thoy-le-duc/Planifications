import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import type { ModuleCalculsPlan } from '../src/ecrans/plan/test/contrat.ts';
import { TESTID_3D, type ModuleScene, type Plan3d, type Scene, type SocleScene } from '../src/ecrans/plan3d/test/contrat.ts';
import { DUREE_VOL_MAX_MS, MARQUES_3D_CAMERA, TESTID_3D_CAMERA as T, AZIMUT_DEPART, type CibleVol, type Direction, type ModuleCadrage, type ModuleVueFerme, type Pose } from '../src/ecrans/plan3d/test/contrat-camera.ts';
import { distance, projeter, versPixel } from '../src/ecrans/plan3d/test/projection.ts';
import { decrireDefilement, jugerDefilement, surveillerCsp, type PassageDefilement } from './outils.ts';
import { arreterImages, BORNES_FERME_T07, demarrerImages, instrumenter3d, verifierGardeFous } from './fluidite-3d.ts';

/**
 * T29 — vue 3D : la caméra vole vers une zone, de bout en bout, sur ordinateur (Chromium
 * 1280 × 800, WebGL logiciel), avec la grande ferme de T07. Contrat du DOM, des marques et du
 * module pur de cadrage : src/ecrans/plan3d/test/contrat-camera.ts. Les mesures de T27 et T27b
 * restent celles de vue-3d.e2e.ts et vue-3d-filtres.e2e.ts, qui ne changent pas.
 *
 * ── Ce que vérifie ce test ───────────────────────────────────────────────────────────────────
 *   1. clic sur une planche de la scène → la caméra se pose sur le cadrage de sa zone, tel que
 *      `cadrage(boiteDe(...))` (calculé sous Node) le donne pour la même caméra de départ ;
 *   2. bouton « Aller à <zone> » de la liste, au clavier (Entrée) ; « Vue d’ensemble » ;
 *   3. durée : au plus 600 ms + une image après le clic (5 vols), et un vrai vol (au moins
 *      3 poses intermédiaires, au moins 3 images dessinées), pas un saut ;
 *   4. fluidité du vol : au plus 2 images perdues d’affilée (même statistique que T27) ;
 *   5. un nouveau clic pendant le vol repart de là où on est ;
 *   6. un glissé ne lance aucun vol, et la navigation reste fluide après les vols ;
 *   7. rendu à la demande : plus d’image une fois arrivé ;
 *   8. `prefers-reduced-motion: reduce` : saut direct, sans pose intermédiaire ;
 *   9. aucune violation de la CSP.
 * Le poids (budget 3D de 200 Kio, JS de démarrage de 71 Kio) est vérifié par scripts/vue3d.test.ts
 * et `pnpm budget`, et par cadrage.test.ts (le module pur n’importe rien).
 */

const CHEMIN_CALCULS = '../src/ecrans/plan/calculs.ts';
const CHEMIN_SCENE = '../src/ecrans/plan3d/scene.ts';
const CHEMIN_CADRAGE = '../src/ecrans/plan3d/cadrage.ts';
const DELAI_AMORCAGE_MS = 120_000;

/** Image de tolérance après les 600 ms : le budget de dessin d’une image de T27 (100 ms). */
const MARGE_IMAGE_MS = 100;
const DUREE_MIN_VISIBLE_MS = 100;
const VOLS_MESURES = 5;
const IMAGES_PERDUES_MAX = 2;
const PASSAGES_SACCADES_ECHEC = 4;
const RAFALES_TOTAL_MAX = 6;
const IMAGES_PAR_PASSAGE = 120;

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
  readonly plan: Plan3d;
  readonly scene: Scene;
  readonly cadrage: ModuleCadrage;
  readonly utilisateurId: string;
  readonly fermeId: string;
}

async function planAttendu(): Promise<Attendu> {
  const calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  const moduleScene = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleScene;
  const cadrage = (await import(/* @vite-ignore */ CHEMIN_CADRAGE)) as ModuleCadrage;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    const aujourdhui = jourLocal(new Date());
    const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, jeu.principale.fermeId), aujourdhui);
    if (saison === null) throw new Error('jeu de T07 sans saison');
    const plan = (await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison, aujourdhui })) as unknown as Plan3d;
    const scene = moduleScene.versScene(plan, plan.semaineCourante ?? 0);
    return { plan, scene, cadrage, utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId };
  } finally {
    base.fermer();
  }
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const vue = (page: Page) => page.getByTestId(TESTID_3D.vue);
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
const boutonZone = (page: Page, id: string): Locator => page.locator(`[data-testid="${T.zone}"][data-id="${id.replace(/"/g, '\\"')}"]`);
const boutonEnsemble = (page: Page) => page.getByTestId(T.ensemble);

async function ouvrirPlanches(page: Page, attendu: Attendu): Promise<void> {
  await page.goto('/diagnostic/amorcer.html');
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

async function ouvrirEn3d(page: Page, nbPlanches: number): Promise<void> {
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: 30_000 });
  await expect(toile(page)).toHaveAttribute('data-volumes', String(nbPlanches));
}

// ── Lecture de la caméra ─────────────────────────────────────────────────────────────────────

async function lirePose(page: Page): Promise<Pose> {
  const json = await toile(page).getAttribute('data-camera');
  if (json === null) throw new Error('toile-3d sans data-camera');
  return JSON.parse(json) as Pose;
}

const lireNombre = async (page: Page, nom: string): Promise<number> => Number(await toile(page).getAttribute(nom));

async function boiteToile(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await toile(page).boundingBox();
  if (b === null) throw new Error('toile 3D sans boîte');
  return b;
}

/** Le sens de la caméra : de la cible vers la caméra, à l’horizontale. */
const directionDe = (p: Pose): Direction => ({ x: p.position.x - p.cible.x, z: p.position.z - p.cible.z });

/** Écart toléré entre deux poses : 0,5 % de la distance de la caméra à sa cible, au moins 1 cm. */
function tolerance(p: Pose): number {
  return Math.max(0.01, 0.005 * distance(p.position, p.cible));
}

/** Le cadrage que `cadrage.ts` calcule, sous Node, pour la caméra et la toile telles qu’elles sont affichées. */
async function cadrageAttendu(page: Page, attendu: Attendu, cible: CibleVol, depart: Pose): Promise<Pose> {
  // T28c : la ferme entière se cadre comme à l'ouverture (« Vue d'ensemble »), pas par sa boîte axée.
  if (cible.sorte === 'ferme') return vueDEnsembleAttendue(page, attendu);
  const boite = attendu.cadrage.boiteDe(attendu.scene, cible);
  if (boite === null) throw new Error('rien à cadrer');
  const champ = await lireNombre(page, 'data-champ');
  const { width, height } = await boiteToile(page);
  return attendu.cadrage.cadrage(boite, champ, width / height, directionDe(depart));
}

/** T28c : « Vue d'ensemble » = la vue d'ouverture, `meilleureVueDeFerme` sur les vrais coins de la ferme. */
async function vueDEnsembleAttendue(page: Page, attendu: Attendu): Promise<Pose> {
  const m = (await import(/* @vite-ignore */ CHEMIN_CADRAGE)) as ModuleCadrage & ModuleVueFerme;
  const champ = await lireNombre(page, 'data-champ');
  const { width, height } = await boiteToile(page);
  const vue = m.meilleureVueDeFerme(m.pointsDeFerme(attendu.scene), champ, width / height, AZIMUT_DEPART);
  if (vue === null) throw new Error('rien à cadrer');
  return vue.pose;
}

function verifierPose(reelle: Pose, voulue: Pose, nom: string): void {
  const tol = tolerance(voulue);
  expect(distance(reelle.cible, voulue.cible), `${nom} : cible`).toBeLessThanOrEqual(tol);
  expect(distance(reelle.position, voulue.position), `${nom} : position`).toBeLessThanOrEqual(tol);
}

// ── Enregistreur d’images, dans la page ──────────────────────────────────────────────────────

interface Echantillon {
  readonly t: number;
  readonly pose: Pose;
  readonly vol: string;
  readonly rendus: number;
}

interface Clic {
  readonly t: number;
  readonly pose: Pose;
}

/** Installe, dans la page : la prise du dernier pointeur relâché (heure et caméra) et l’enregistreur d’images. */
async function installerOutils(page: Page): Promise<void> {
  await page.evaluate(() => {
    const f = window as unknown as {
      __clic?: { t: number; pose: unknown };
      __rec?: { actif: boolean; echantillons: unknown[] };
    };
    const lire = () => {
      const c = document.querySelector('[data-testid="toile-3d"]');
      return c instanceof HTMLElement ? c : null;
    };
    // Souris : le relâchement du pointeur ; clavier : l'appui sur Entrée ou Espace (aucun pointerup).
    const prendre = (e: Event) => {
      const c = lire();
      f.__clic = { t: e.timeStamp, pose: JSON.parse(c?.dataset.camera ?? 'null') as unknown };
    };
    document.addEventListener('pointerup', prendre, true);
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') prendre(e);
      },
      true,
    );
    const rec = { actif: false, echantillons: [] as unknown[] };
    f.__rec = rec;
    const image = (t: number) => {
      if (rec.actif) {
        const c = lire();
        if (c !== null) rec.echantillons.push({ t, pose: JSON.parse(c.dataset.camera ?? 'null') as unknown, vol: c.dataset.vol ?? '', rendus: Number(c.dataset.rendus) });
      }
      requestAnimationFrame(image);
    };
    requestAnimationFrame(image);
  });
}

async function demarrerEnregistrement(page: Page): Promise<void> {
  await page.evaluate((marque) => {
    performance.clearMarks(marque);
    const f = window as unknown as { __rec?: { actif: boolean; echantillons: unknown[] }; __clic?: unknown };
    delete f.__clic;
    if (f.__rec !== undefined) {
      f.__rec.echantillons = [];
      f.__rec.actif = true;
    }
  }, MARQUES_3D_CAMERA.volFin);
}

interface Vol {
  readonly clic: Clic;
  /** Heure de la marque de fin de vol (ms, horloge de la page). */
  readonly fin: number;
  readonly cible: string;
  readonly echantillons: readonly Echantillon[];
  readonly arrivee: Pose;
}

/**
 * Fait `declencher` (un clic ou une touche), attend la marque de fin de vol de `cible`, laisse
 * passer une image, et rend le relevé du vol.
 */
async function voler(page: Page, cible: string, declencher: () => Promise<void>): Promise<Vol> {
  await demarrerEnregistrement(page);
  await declencher();
  await page.waitForFunction(
    ([marque, voulue]) => performance.getEntriesByName(marque, 'mark').some((m) => (m as unknown as { detail?: { cible?: string } | null }).detail?.cible === voulue),
    [MARQUES_3D_CAMERA.volFin, cible] as const,
    { timeout: 10_000 },
  );
  await page.evaluate(() => new Promise<void>((fini) => requestAnimationFrame(() => requestAnimationFrame(() => { fini(); }))));
  const releve = await page.evaluate((marque) => {
    const f = window as unknown as { __rec?: { actif: boolean; echantillons: unknown[] }; __clic?: unknown };
    if (f.__rec !== undefined) f.__rec.actif = false;
    const m = performance.getEntriesByName(marque, 'mark').at(-1) as PerformanceMark | undefined;
    return { clic: f.__clic ?? null, fin: m?.startTime ?? Number.NaN, cible: ((m as unknown as { detail?: { cible?: string } | null } | undefined)?.detail)?.cible ?? '', echantillons: f.__rec?.echantillons ?? [] };
  }, MARQUES_3D_CAMERA.volFin);
  if (releve.clic === null) throw new Error('aucun pointeur relâché pendant le vol');
  return { clic: releve.clic as Clic, fin: releve.fin, cible: releve.cible, echantillons: releve.echantillons as Echantillon[], arrivee: await lirePose(page) };
}

/** Poses relevées strictement entre le départ et l’arrivée (à plus de 1 % de la course de l’une et de l’autre). */
function posesIntermediaires(v: Vol, depart: Pose): Echantillon[] {
  const course = distance(depart.position, v.arrivee.position) + distance(depart.cible, v.arrivee.cible);
  const seuil = Math.max(0.01, 0.01 * course);
  return v.echantillons.filter((e) => {
    if (e.t < v.clic.t || e.t > v.fin) return false;
    const duDepart = distance(e.pose.position, depart.position) + distance(e.pose.cible, depart.cible);
    const deLArrivee = distance(e.pose.position, v.arrivee.position) + distance(e.pose.cible, v.arrivee.cible);
    return duDepart > seuil && deLArrivee > seuil;
  });
}

/** Intervalles entre images pendant le vol (le premier, qui suit le clic, est écarté). */
function intervallesDuVol(v: Vol): number[] {
  const ts = v.echantillons.filter((e) => e.t >= v.clic.t && e.t <= v.fin + 50).map((e) => e.t);
  return ts.slice(1).map((t, i) => t - (ts[i] ?? t)).slice(1);
}

// ── Cibles à cliquer ─────────────────────────────────────────────────────────────────────────

/** Zones qui portent des planches, dans l’ordre du plan. */
function zonesAvecPlanches(scene: Scene): SocleScene[] {
  const avec = new Set(scene.volumes.map((v) => v.zoneId));
  return scene.socles.filter((s) => avec.has(s.id));
}

/** Pixel (page) du dessus d’une planche de la zone, vue depuis la caméra actuelle. */
async function pixelPlancheDeZone(page: Page, scene: Scene, zoneId: string): Promise<{ x: number; y: number } | null> {
  const pose = await lirePose(page);
  const champ = await lireNombre(page, 'data-champ');
  const b = await boiteToile(page);
  // Une planche du milieu de la zone, la plus proche du centre de l’écran qui soit bien à l’écran.
  const candidats = scene.volumes.filter((v) => v.zoneId === zoneId);
  let meilleur: { x: number; y: number; ecart: number } | null = null;
  for (const v of candidats) {
    const p = projeter(pose, champ, b.width / b.height, { x: v.x, y: v.hauteur, z: v.z });
    if (!(p.profondeur > 0) || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) continue;
    const ecart = Math.hypot(p.x, p.y);
    if (meilleur === null || ecart < meilleur.ecart) {
      const px = versPixel(p, b.width, b.height);
      meilleur = { x: b.x + px.x, y: b.y + px.y, ecart };
    }
  }
  return meilleur === null ? null : { x: meilleur.x, y: meilleur.y };
}

async function cliquerDansLaScene(page: Page, scene: Scene, zoneId: string): Promise<void> {
  const p = await pixelPlancheDeZone(page, scene, zoneId);
  if (p === null) throw new Error(`aucune planche de la zone ${zoneId} à l’écran`);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

// ── Glissé du pointeur (copie de vue-3d.e2e.ts : un autre fichier de test ne s’importe pas) ──

async function glisserUneFois(page: Page, sens: 1 | -1): Promise<PassageDefilement & { rendus: number }> {
  const boite = await boiteToile(page);
  const x0 = boite.x + boite.width / 2 - (sens * boite.width) / 4;
  const y0 = boite.y + boite.height / 2;
  const rendusAvant = await lireNombre(page, 'data-rendus');
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
    await page.evaluate(() => new Promise<void>((fini) => { requestAnimationFrame(() => { fini(); }); }));
  }
  await page.mouse.up();
  const intervalles = await page.evaluate(() => {
    const f = window as unknown as { __intervalles?: number[]; __arret?: boolean };
    f.__arret = true;
    return f.__intervalles ?? [];
  });
  return { intervalles: intervalles.slice(2), rendus: (await lireNombre(page, 'data-rendus')) - rendusAvant };
}

// ── Le test ──────────────────────────────────────────────────────────────────────────────────

test('vue 3D : la caméra vole vers une zone, grande ferme de T07, ordinateur', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 300_000);
  const attendu = await planAttendu();
  const { scene } = attendu;
  const zones = zonesAvecPlanches(scene);
  expect(zones.length, 'la ferme de T07 a au moins deux zones avec des planches').toBeGreaterThanOrEqual(2);
  // La caméra de départ regarde le centre de la scène : la zone à cliquer est la première dont une planche est à l'écran.
  const violations = await surveillerCsp(page);
  await instrumenter3d(page);

  await ouvrirPlanches(page, attendu);
  await ouvrirEn3d(page, attendu.plan.lignes.filter((l) => l.sorte === 'emplacement').length);
  await installerOutils(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  let zoneA: SocleScene | undefined;
  for (const z of zones) {
    if ((await pixelPlancheDeZone(page, scene, z.id)) !== null) {
      zoneA = z;
      break;
    }
  }
  const zoneB = zones.findLast((z) => z.id !== zoneA?.id);
  if (zoneA === undefined || zoneB === undefined) throw new Error('aucune zone avec des planches à l’écran au départ');
  await test.step('la liste texte propose un bouton par zone et « Vue d’ensemble », nommés et au clavier', async () => {
    await expect(boutonZone(page, zoneA.id)).toHaveAccessibleName(`Aller à ${zoneA.nom}`);
    await expect(page.getByTestId(T.zone)).toHaveCount(scene.socles.length);
    expect(await page.getByTestId(T.zone).evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual(scene.socles.map((s) => s.id));
    await expect(boutonEnsemble(page)).toHaveAccessibleName('Vue d’ensemble');
    const boite = await boutonZone(page, zoneA.id).boundingBox();
    expect(boite?.height ?? 0, 'cible du bouton').toBeGreaterThanOrEqual(24);
    await expect(toile(page)).toHaveAttribute('data-vol', 'non');
    await expect(toile(page)).toHaveAttribute('data-vols', '0');
    expect(await lireNombre(page, 'data-champ')).toBeGreaterThan(0);
  });

  await test.step('clic sur une planche de la scène : la caméra se pose sur le cadrage de sa zone en 600 ms au plus', async () => {
    const depart = await lirePose(page);
    const voulue = await cadrageAttendu(page, attendu, { sorte: 'zone', id: zoneA.id }, depart);
    const v = await voler(page, zoneA.id, () => cliquerDansLaScene(page, scene, zoneA.id));
    verifierPose(v.arrivee, voulue, `cadrage de ${zoneA.nom}`);
    expect(v.fin - v.clic.t, 'durée du vol (clic → image d’arrivée)').toBeLessThanOrEqual(DUREE_VOL_MAX_MS + MARGE_IMAGE_MS);
    expect(v.fin - v.clic.t, 'un vol, pas un saut').toBeGreaterThanOrEqual(DUREE_MIN_VISIBLE_MS);
    expect(posesIntermediaires(v, depart).length, 'poses intermédiaires relevées pendant le vol').toBeGreaterThanOrEqual(3);
    expect(v.echantillons.some((e) => e.vol === 'oui'), 'data-vol = oui pendant le vol').toBe(true);
    await expect(toile(page)).toHaveAttribute('data-vol', 'non');
    await expect(toile(page)).toHaveAttribute('data-vols', '1');
    // Même sens de caméra : pas de demi-tour.
    const d0 = directionDe(depart);
    const d1 = directionDe(v.arrivee);
    expect(d0.x * d1.x + d0.z * d1.z, 'même côté qu’au départ').toBeGreaterThan(0);
    expect(Math.abs(d0.x * d1.z - d0.z * d1.x) / (Math.hypot(d0.x, d0.z) * Math.hypot(d1.x, d1.z)), 'même sens (sinus de l’écart)').toBeLessThan(1e-3);
  });

  await test.step('rendu à la demande : au repos une fois arrivé, plus aucune image dessinée', async () => {
    await page.waitForTimeout(500);
    const avant = await lireNombre(page, 'data-rendus');
    await page.waitForTimeout(1_000);
    expect(await lireNombre(page, 'data-rendus'), 'images dessinées pendant 1 s de repos').toBe(avant);
  });

  await test.step('bouton de la liste, activé au clavier (Entrée) : cadrage de l’autre zone', async () => {
    const depart = await lirePose(page);
    const voulue = await cadrageAttendu(page, attendu, { sorte: 'zone', id: zoneB.id }, depart);
    const bouton = boutonZone(page, zoneB.id);
    const v = await voler(page, zoneB.id, async () => {
      await bouton.focus();
      await page.keyboard.press('Enter');
    });
    verifierPose(v.arrivee, voulue, `cadrage de ${zoneB.nom}`);
    expect(v.fin - v.clic.t).toBeLessThanOrEqual(DUREE_VOL_MAX_MS + MARGE_IMAGE_MS);
  });

  await test.step('« Vue d’ensemble » revient exactement à la vue d’ouverture (T28c)', async () => {
    const voulue = await vueDEnsembleAttendue(page, attendu);
    const v = await voler(page, 'ferme', () => boutonEnsemble(page).click());
    verifierPose(v.arrivee, voulue, 'cadrage de la ferme');
    expect(v.fin - v.clic.t).toBeLessThanOrEqual(DUREE_VOL_MAX_MS + MARGE_IMAGE_MS);
  });

  await test.step('un nouveau clic pendant le vol repart de là où on est', async () => {
    const depart = await lirePose(page);
    await demarrerEnregistrement(page);
    await boutonZone(page, zoneA.id).click();
    await page.waitForTimeout(250);
    await expect(toile(page)).toHaveAttribute('data-vol', 'oui');
    const enRoute = await lirePose(page);
    expect(distance(enRoute.position, depart.position), 'le vol a commencé').toBeGreaterThan(tolerance(depart));
    const v = await voler(page, zoneB.id, () => boutonZone(page, zoneB.id).click());
    // Pas de retour au point de départ du premier vol : la première pose après le 2e clic est près de celle d’avant.
    const premiere = v.echantillons.find((e) => e.t >= v.clic.t);
    const avant = v.clic.pose;
    if (premiere !== undefined) {
      const ecartAvant = distance(premiere.pose.position, avant.position);
      const ecartDepart = distance(premiere.pose.position, depart.position);
      expect(ecartAvant, 'la 2e course part de la pose atteinte, pas du départ du 1er vol').toBeLessThan(ecartDepart);
    }
    // Arrivée : un cadrage valide de la zone B dans le sens où l’on arrive (nul besoin de deviner le départ exact).
    const boite = attendu.cadrage.boiteDe(scene, { sorte: 'zone', id: zoneB.id });
    if (boite === null) throw new Error('boîte de la zone B absente');
    const { width, height } = await boiteToile(page);
    const voulue = attendu.cadrage.cadrage(boite, await lireNombre(page, 'data-champ'), width / height, directionDe(v.arrivee));
    verifierPose(v.arrivee, voulue, 'arrivée du vol repris');
    expect(v.fin - v.clic.t, 'durée du vol repris').toBeLessThanOrEqual(DUREE_VOL_MAX_MS + MARGE_IMAGE_MS);
    // Un seul vol est allé au bout : la marque du vol remplacé (zone A) n’a pas été posée.
    const marques = await page.evaluate((m) => performance.getEntriesByName(m, 'mark').map((e) => (e as unknown as { detail?: { cible?: string } | null }).detail?.cible ?? ''), MARQUES_3D_CAMERA.volFin);
    expect(marques, 'marques de fin de vol depuis le dernier effacement').not.toContain(zoneA.id);
  });

  await test.step(`${String(VOLS_MESURES)} vols : 600 ms au plus, au plus 2 images perdues d’affilée pendant le vol`, async () => {
    const passages: PassageDefilement[] = [];
    let attendus = 0;
    await demarrerImages(page);
    for (let i = 0; i < VOLS_MESURES; i += 1) {
      const versEnsemble = i % 2 === 0;
      const cible = versEnsemble ? 'ferme' : zoneA.id;
      const depart = await lirePose(page);
      const rendusAvant = await lireNombre(page, 'data-rendus');
      const voulue = await cadrageAttendu(page, attendu, versEnsemble ? { sorte: 'ferme' } : { sorte: 'zone', id: zoneA.id }, depart);
      const v = await voler(page, cible, () => (versEnsemble ? boutonEnsemble(page).click() : boutonZone(page, zoneA.id).click()));
      verifierPose(v.arrivee, voulue, `vol ${String(i + 1)}`);
      expect(v.fin - v.clic.t, `vol ${String(i + 1)} : durée`).toBeLessThanOrEqual(DUREE_VOL_MAX_MS + MARGE_IMAGE_MS);
      expect((await lireNombre(page, 'data-rendus')) - rendusAvant, `vol ${String(i + 1)} : images dessinées`).toBeGreaterThanOrEqual(3);
      expect(posesIntermediaires(v, depart).length, `vol ${String(i + 1)} : poses intermédiaires`).toBeGreaterThanOrEqual(3);
      passages.push({ intervalles: intervallesDuVol(v) });
      attendus += intervallesDuVol(v).length;
    }
    verifierGardeFous('vol de caméra 3D', await arreterImages(page), BORNES_FERME_T07, VOLS_MESURES * 3);
    expect(attendus, 'intervalles mesurés').toBeGreaterThan(VOLS_MESURES * 5);
    const verdict = jugerDefilement(passages, IMAGES_PERDUES_MAX, PASSAGES_SACCADES_ECHEC, RAFALES_TOTAL_MAX);
    console.log(decrireDefilement('vol de caméra 3D', verdict));
    expect(verdict.passagesSaccades, 'vols qui perdent plus de 2 images d’affilée').toBeLessThan(PASSAGES_SACCADES_ECHEC);
    expect(verdict.rafalesTotal).toBeLessThanOrEqual(RAFALES_TOTAL_MAX);
    expect(verdict.fluide).toBe(true);
  });

  await test.step('un glissé du pointeur tourne la vue sans lancer de vol, et reste fluide après les vols', async () => {
    const vols = await toile(page).getAttribute('data-vols');
    const avant = await lirePose(page);
    const passages: (PassageDefilement & { rendus: number })[] = [];
    await demarrerImages(page);
    for (let i = 0; i < 5; i += 1) passages.push(await glisserUneFois(page, i % 2 === 0 ? 1 : -1));
    verifierGardeFous('navigation 3D après les vols', await arreterImages(page), BORNES_FERME_T07, IMAGES_PAR_PASSAGE);
    expect(await toile(page).getAttribute('data-vols'), 'un glissé lance un vol').toBe(vols);
    await expect(toile(page)).toHaveAttribute('data-vol', 'non');
    expect(distance((await lirePose(page)).position, avant.position), 'la caméra a bougé').toBeGreaterThan(tolerance(avant));
    const verdict = jugerDefilement(passages, IMAGES_PERDUES_MAX, PASSAGES_SACCADES_ECHEC, RAFALES_TOTAL_MAX);
    console.log(decrireDefilement('navigation 3D après les vols', verdict));
    for (const [i, p] of passages.entries()) expect(p.rendus, `passage ${String(i + 1)} : images dessinées`).toBeGreaterThan(IMAGES_PAR_PASSAGE / 4);
    expect(verdict.fluide).toBe(true);
  });

  await test.step('prefers-reduced-motion: reduce : saut direct, sans pose intermédiaire', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [cible, declencher] of [
      [zoneB.id, () => boutonZone(page, zoneB.id).click()],
      ['ferme', () => boutonEnsemble(page).click()],
      [zoneA.id, () => cliquerDansLaScene(page, scene, zoneA.id)],
    ] as const) {
      const depart = await lirePose(page);
      const voulue = await cadrageAttendu(page, attendu, cible === 'ferme' ? { sorte: 'ferme' } : { sorte: 'zone', id: cible }, depart);
      const vols = await lireNombre(page, 'data-vols');
      const v = await voler(page, cible, declencher);
      verifierPose(v.arrivee, voulue, `saut vers ${cible}`);
      expect(posesIntermediaires(v, depart), `saut vers ${cible} : poses intermédiaires`).toEqual([]);
      expect(v.echantillons.some((e) => e.vol === 'oui'), 'data-vol jamais à oui').toBe(false);
      expect(v.fin - v.clic.t, 'saut direct : une image après le clic').toBeLessThanOrEqual(MARGE_IMAGE_MS);
      expect(await lireNombre(page, 'data-vols'), 'le saut compte comme un vol').toBe(vols + 1);
    }
    // Le réglage est relu à chaque vol : en le retirant, les vols reviennent.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const depart = await lirePose(page);
    const v = await voler(page, 'ferme', () => boutonEnsemble(page).click());
    expect(posesIntermediaires(v, depart).length, 'sans mouvement réduit, le vol revient').toBeGreaterThanOrEqual(3);
  });

  await test.step('retour au plan 2D', async () => {
    await page.getByTestId(TESTID_3D.retour2d).click();
    await expect(vue(page)).toHaveCount(0);
    await expect(page.getByTestId('plan-defilement')).toBeVisible();
  });

  expect(await violations(), 'violations de la CSP').toEqual([]);
});

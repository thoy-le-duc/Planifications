import { expect, type Page } from '@playwright/test';
import { IMAGE_60HZ_MS } from './outils.ts';

/**
 * T29b — mesures de fluidité de la vue 3D qui ne dépendent pas de la charge de la machine.
 *
 * Constat mesuré (T29b) : sous SwiftShader (WebGL logiciel), une toile 1280 × 800 qui ne fait
 * que « clear » coûte déjà 18 à 24 ms de swap par image (intervalle médian 33 ms) ; la scène de
 * la ferme T07 y ajoute 9 à 10 ms, et le JavaScript de la vue pèse moins de 1 ms par image. Les
 * intervalles entre images mesurent donc surtout le rendu logiciel et la charge de la machine :
 * un même code passe ou échoue selon l'heure. Deux garde-fous remplacent la confiance dans ce
 * seul chiffre.
 *
 * 1. Garde-fous stables (indépendants de la charge), qui protègent contre une régression du code :
 * temps JavaScript des callbacks `requestAnimationFrame` par image dessinée (médiane et 95e
 * centile), appels de dessin (draw calls) et triangles par image. Bornes mesurées, avec marge :
 * ferme T07 2 appels et ~4 300 triangles ; jumeau T07 placé 7 appels et 29 506 triangles ; démo
 * 7 appels et ~5 774 triangles (après T29b ; avant : 5 100, 77 634 et 16 084) ; JavaScript 0,2 à 0,6 ms par image en médiane.
 *
 * 2. Critère d'images perdues RELATIF au plancher mesuré dans le même lancement : un intervalle
 * est « fautif » s'il dépasse max(seuil de 60 Hz de T27 : plus de 2 images perdues, soit 58,3 ms ;
 * 2 × l'intervalle médian d'une toile de même taille qui ne fait que « clear », même navigateur). Les seuils de nombre (passages saccadés,
 * intervalles fautifs au total) restent ceux de T27 et T29.
 *
 * Mesure : un script injecté avant tout code de la page enveloppe `requestAnimationFrame` (temps
 * passé dans chaque callback, par image) et les fonctions de dessin WebGL (appels et triangles
 * rattachés à l'image en cours). Seules comptent les images où l'appli a dessiné (au moins un
 * appel de dessin) : les callbacks de mesure du test, seuls, ne diluent pas la médiane.
 */

/** Une image où l'appli a dessiné : temps JavaScript des callbacks rAF, appels de dessin, triangles. */
export interface ImageMesuree {
  readonly js: number;
  readonly appels: number;
  readonly triangles: number;
}

/** Garde-fous communs à toutes les scènes : la même régression de code ne doit passer nulle part. */
export const JS_MEDIANE_MAX_MS = 4;
export const JS_P95_MAX_MS = 8;

/** Bornes de dessin par image selon la scène (ferme T07 : 2 appels et ~4 300 triangles mesurés). */
export interface BornesDessin {
  readonly appelsMax: number;
  readonly trianglesMax: number;
}
/**
 * T32b : 3 appels (2 + un par forme ; la ferme T07 n'a que le profil générique, une seule forme) et au
 * plus 14 000 triangles : ~4 300 de la ferme, plus au pire PLANTS_MAX_TOTAL (180) plants de 48 triangles
 * = 9 600. Mesuré : 4 300 en navigation et en vol (plants fondus en masse de loin), 9 100 en fin de vol
 * près d'une zone, 11 020 en zoom serré (100 plants). Avant T32b : 5 500.
 * T32e : 4 appels : le maillage partagé des balises « à récolter » (et des tuteurs et fruits, 8
 * triangles par instance) s'ajoute dès qu'une forme de plant est en détail. Un appel instancié de plus,
 * sans changer les bornes de temps (JS_MEDIANE_MAX_MS, JS_P95_MAX_MS), justifié dans la PR.
 */
export const BORNES_FERME_T07: BornesDessin = { appelsMax: 4, trianglesMax: 14_000 };
/** Jumeau de la ferme T07 placée (bâtiments, arceaux, bâches) : plus de géométrie que la ferme seule. */
export const BORNES_JUMEAU_T07: BornesDessin = { appelsMax: 8, trianglesMax: 35_000 };
/** Démo : 8 appels avant T32d ; 9 depuis (mesuré : 9 au plus en glissé, 6 974 triangles sur 8 000) : l'InstancedMesh des tuteurs de la tomate ajoute un appel. */
export const BORNES_DEMO: BornesDessin = { appelsMax: 9, trianglesMax: 8_000 };

/** Script injecté dans chaque document, avant son code (page.addInitScript). Sans dépendance. */
function scriptMesure(): void {
  interface Courante {
    t: number;
    js: number;
    appels: number;
    triangles: number;
  }
  interface Etat {
    actif: boolean;
    images: Courante[];
    courante: Courante | null;
    appels: number;
    triangles: number;
  }
  const w = window as unknown as { __fluidite?: Etat; __fluiditeDemarrer?: () => void; __fluiditeArreter?: () => Courante[] };
  if (w.__fluidite !== undefined) return;
  const etat: Etat = { actif: false, images: [], courante: null, appels: 0, triangles: 0 };
  w.__fluidite = etat;

  const trianglesDe = (mode: number, n: number): number => (mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0);
  const envelopper = (proto: object, nom: string, instances: boolean): void => {
    const original = (proto as Record<string, unknown>)[nom];
    if (typeof original !== 'function') return;
    (proto as Record<string, unknown>)[nom] = function (this: unknown, ...args: unknown[]): unknown {
      // drawArrays(mode, first, count[, instances]) ; drawElements(mode, count, type, offset[, instances]) ;
      // drawRangeElements(mode, start, end, count, type, offset).
      const mode = Number(args[0]);
      const count = nom === 'drawArrays' || nom === 'drawArraysInstanced' ? Number(args[2]) : nom === 'drawRangeElements' ? Number(args[3]) : Number(args[1]);
      const nb = instances ? Number(args[nom === 'drawArraysInstanced' ? 3 : 4]) : 1;
      etat.appels += 1;
      etat.triangles += trianglesDe(mode, count) * (Number.isFinite(nb) ? nb : 1);
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  };
  for (const ctor of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    const proto = (window as unknown as Record<string, { prototype?: object } | undefined>)[ctor]?.prototype;
    if (proto === undefined) continue;
    for (const nom of ['drawArrays', 'drawElements', 'drawRangeElements']) envelopper(proto, nom, false);
    for (const nom of ['drawArraysInstanced', 'drawElementsInstanced']) envelopper(proto, nom, true);
  }

  const natif = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (rappel: FrameRequestCallback): number =>
    natif((t: number) => {
      const appels0 = etat.appels;
      const triangles0 = etat.triangles;
      const debut = performance.now();
      try {
        rappel(t);
      } finally {
        if (etat.actif) {
          const c = etat.courante !== null && etat.courante.t === t ? etat.courante : { t, js: 0, appels: 0, triangles: 0 };
          if (c !== etat.courante) {
            etat.courante = c;
            etat.images.push(c);
          }
          c.js += performance.now() - debut;
          c.appels += etat.appels - appels0;
          c.triangles += etat.triangles - triangles0;
        }
      }
    });
  w.__fluiditeDemarrer = () => {
    etat.images = [];
    etat.courante = null;
    etat.actif = true;
  };
  w.__fluiditeArreter = () => {
    etat.actif = false;
    return etat.images;
  };
}

/** À appeler au début du test, avant le premier `goto` : la page est instrumentée à chaque chargement. */
export async function instrumenter3d(page: Page): Promise<void> {
  await page.addInitScript(scriptMesure);
}

/** Commence à relever les images (efface le relevé précédent). */
export async function demarrerImages(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __fluiditeDemarrer?: () => void }).__fluiditeDemarrer?.();
  });
}

/** Arrête le relevé et rend les images où l'appli a dessiné (au moins un appel de dessin). */
export async function arreterImages(page: Page): Promise<ImageMesuree[]> {
  const toutes = await page.evaluate(() => (window as unknown as { __fluiditeArreter?: () => ImageMesuree[] }).__fluiditeArreter?.() ?? null);
  if (toutes === null) throw new Error('page non instrumentée : instrumenter3d(page) avant le premier goto');
  return toutes.filter((i) => i.appels > 0).map((i) => ({ js: i.js, appels: i.appels, triangles: i.triangles }));
}

function centile(valeurs: readonly number[], p: number): number {
  if (valeurs.length === 0) return Number.NaN;
  const t = [...valeurs].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.ceil(p * t.length) - 1)] ?? Number.NaN;
}

export interface ResumeImages {
  readonly images: number;
  readonly jsMedianeMs: number;
  readonly jsP95Ms: number;
  readonly appelsMax: number;
  readonly trianglesMax: number;
}

export function resumerImages(images: readonly ImageMesuree[]): ResumeImages {
  const js = images.map((i) => i.js);
  return {
    images: images.length,
    jsMedianeMs: centile(js, 0.5),
    jsP95Ms: centile(js, 0.95),
    appelsMax: Math.max(0, ...images.map((i) => i.appels)),
    trianglesMax: Math.max(0, ...images.map((i) => i.triangles)),
  };
}

/** Ligne de journal des garde-fous. */
export function decrireImages(libelle: string, r: ResumeImages, bornes: BornesDessin): string {
  return (
    `${libelle} : ${String(r.images)} images dessinées, JavaScript par image médiane ${r.jsMedianeMs.toFixed(2)} ms (max ${String(JS_MEDIANE_MAX_MS)}),` +
    ` 95e centile ${r.jsP95Ms.toFixed(2)} ms (max ${String(JS_P95_MAX_MS)}), appels de dessin au plus ${String(r.appelsMax)} (max ${String(bornes.appelsMax)}),` +
    ` triangles au plus ${String(r.trianglesMax)} (max ${String(bornes.trianglesMax)})`
  );
}

/** Garde-fous stables : JavaScript par image, appels de dessin et triangles. Indépendants de la charge. */
export function verifierGardeFous(libelle: string, images: readonly ImageMesuree[], bornes: BornesDessin, imagesMin: number): ResumeImages {
  const r = resumerImages(images);
  console.log(decrireImages(libelle, r, bornes));
  expect(r.images, `${libelle} : images dessinées relevées`).toBeGreaterThanOrEqual(imagesMin);
  expect(r.jsMedianeMs, `${libelle} : JavaScript par image, médiane (ms)`).toBeLessThanOrEqual(JS_MEDIANE_MAX_MS);
  expect(r.jsP95Ms, `${libelle} : JavaScript par image, 95e centile (ms)`).toBeLessThanOrEqual(JS_P95_MAX_MS);
  expect(r.appelsMax, `${libelle} : appels de dessin par image`).toBeLessThanOrEqual(bornes.appelsMax);
  expect(r.trianglesMax, `${libelle} : triangles par image`).toBeLessThanOrEqual(bornes.trianglesMax);
  return r;
}

// ── Plancher : le coût du rendu logiciel seul ────────────────────────────────────────────────

export interface Plancher {
  /** Intervalle médian (ms) entre deux images d'une toile WebGL de même taille qui ne fait que « clear ». */
  readonly medianeMs: number;
  /** Au-delà de cet intervalle (ms), une image est « fautive » : max(plancher de 60 Hz de T27, 2 × plancher mesuré). */
  readonly seuilFautifMs: number;
}

/** Plafond du seuil d'un intervalle fautif (ms). */
export const SEUIL_FAUTIF_PLAFOND_MS = 100;
/** Au-delà de ce plancher médian (ms), la machine est trop chargée pour juger la fluidité : le test échoue. */
export const PLANCHER_MAX_MS = 40;
/** T34 : marge minimale (ms) d'un vol de caméra au-delà de sa durée contractuelle : la marge historique. */
export const MARGE_VOL_MIN_MS = 100;
/** T34 : plafond (ms) de cette marge, pour qu'un vrai ralentissement du vol échoue toujours. */
export const MARGE_VOL_MAX_MS = 200;

/**
 * T34 : marge (ms) accordée à la durée d'un vol de caméra, déduite du plancher mesuré dans le même
 * lancement : min(MARGE_VOL_MAX_MS, MARGE_VOL_MIN_MS + 3 × plancher). Erreur explicite si le plancher
 * est absent ou non fini, ou s'il dépasse PLANCHER_MAX_MS (machine trop lente : pas de tolérance cachée).
 */
export function margeVolMs(plancherMs: number): number {
  if (typeof plancherMs !== 'number' || !Number.isFinite(plancherMs) || plancherMs <= 0) {
    throw new Error(`plancher mesuré absent ou invalide (${String(plancherMs)}) : marge de vol incalculable`);
  }
  if (plancherMs > PLANCHER_MAX_MS) {
    throw new Error(`machine trop lente pour juger la durée des vols (plancher ${plancherMs.toFixed(1)} ms > ${String(PLANCHER_MAX_MS)} ms), relancer`);
  }
  return Math.min(MARGE_VOL_MAX_MS, MARGE_VOL_MIN_MS + 3 * plancherMs);
}

/** T34 : message d'échec d'une durée de vol : durée, plancher mesuré, marge appliquée, borne. */
export function messageDureeVol(dureeMs: number, plancherMs: number, margeMs: number, dureeVolMaxMs: number): string {
  return `durée du vol ${String(Math.round(dureeMs))} ms (plancher mesuré ${plancherMs.toFixed(1)} ms, marge ${String(Math.round(margeMs))} ms, borne ${String(Math.round(dureeVolMaxMs + margeMs))} ms = ${String(dureeVolMaxMs)} ms de vol + marge)`;
}

const IMAGES_PLANCHER = 90;
const IMAGES_PLANCHER_IGNOREES = 5;

/**
 * Seuil d'un intervalle fautif : max(plancher de 60 Hz, 2 × plancher mesuré). Le plancher de 60 Hz
 * est celui de T27 et T29 : plus de `imagesPerduesMax` images perdues d'affilée, soit un
 * intervalle qui s'arrondit à plus de `imagesPerduesMax + 1` images (2 → 58,3 ms et au-delà). Il
 * garde le critère historique sur une machine rapide ; le plancher mesuré le relève quand le
 * rendu logiciel est lent, sans dépasser `SEUIL_FAUTIF_PLAFOND_MS` : sur une machine saturée, le
 * seuil ne grimpe pas jusqu'à ne plus rien voir (le test échoue plutôt, voir PLANCHER_MAX_MS).
 */
export function seuilFautif(medianePlancherMs: number, imagesPerduesMax: number): number {
  return Math.min(Math.max((imagesPerduesMax + 1.5) * IMAGE_60HZ_MS, 2 * medianePlancherMs), SEUIL_FAUTIF_PLAFOND_MS);
}

/**
 * Mesure le plancher dans un nouvel onglet du même navigateur : une toile WebGL de la taille de la
 * toile 3D, qui ne fait que « clear » à chaque image. À appeler la vue 3D affichée et au repos,
 * avant les mesures de fluidité ; l'onglet est fermé avant de rendre la main.
 */
export async function mesurerPlancher(page: Page, largeur: number, hauteur: number, imagesPerduesMax: number): Promise<Plancher> {
  const onglet = await page.context().newPage();
  try {
    await onglet.setViewportSize(page.viewportSize() ?? { width: Math.ceil(largeur), height: Math.ceil(hauteur) });
    await onglet.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0"><canvas id="c"></canvas></body>');
    const intervalles = await onglet.evaluate(
      ([w, h, n]) =>
        new Promise<number[]>((fini, echec) => {
          const toile = document.getElementById('c') as HTMLCanvasElement;
          toile.width = Math.round(w);
          toile.height = Math.round(h);
          toile.style.cssText = `width:${String(w)}px;height:${String(h)}px;display:block`;
          const gl = toile.getContext('webgl2', { antialias: true }) ?? toile.getContext('webgl', { antialias: true });
          if (gl === null) {
            echec(new Error('plancher : pas de WebGL'));
            return;
          }
          const mesures: number[] = [];
          let precedent = -1;
          let i = 0;
          const image = (t: number) => {
            if (precedent >= 0) mesures.push(t - precedent);
            precedent = t;
            i += 1;
            gl.clearColor((i % 10) / 10, 0.5, 0.3, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (mesures.length < n) requestAnimationFrame(image);
            else fini(mesures);
          };
          requestAnimationFrame(image);
        }),
      [largeur, hauteur, IMAGES_PLANCHER] as const,
    );
    const utiles = intervalles.slice(IMAGES_PLANCHER_IGNOREES);
    const medianeMs = centile(utiles, 0.5);
    if (!(medianeMs <= PLANCHER_MAX_MS)) throw new Error(`machine trop chargée pour mesurer la fluidité (plancher ${medianeMs.toFixed(1)} ms), relancer`);
    return { medianeMs, seuilFautifMs: seuilFautif(medianeMs, imagesPerduesMax) };
  } finally {
    await onglet.close();
    await page.bringToFront();
  }
}

// ── Images perdues relatives au plancher ─────────────────────────────────────────────────────

/** Un passage : intervalles entre images (ms), démarrage de la mesure exclu. */
export interface PassageRelatif {
  readonly intervalles: readonly number[];
}

export interface VerdictRelatif {
  readonly seuilFautifMs: number;
  readonly pireMsParPassage: readonly number[];
  readonly fautifsParPassage: readonly number[];
  readonly intervallesParPassage: readonly number[];
  readonly passagesSaccades: number;
  readonly passagesPourEchec: number;
  readonly fautifsTotal: number;
  readonly fautifsTotalMax: number;
  readonly fluide: boolean;
}

/**
 * Même logique que `jugerDefilement` (outils.ts), mais « fautif » = intervalle au-delà de `seuilMs`
 * (relatif au plancher mesuré) au lieu d'un nombre d'images perdues à 60 Hz. Un passage est saccadé
 * s'il a au moins un intervalle fautif ; échec à `passagesPourEchec` passages saccadés, ou au-delà de
 * `fautifsTotalMax` intervalles fautifs au total.
 */
export function jugerDefilementRelatif(passages: readonly PassageRelatif[], seuilMs: number, passagesPourEchec: number, fautifsTotalMax: number): VerdictRelatif {
  if (passages.length === 0) throw new Error('jugerDefilementRelatif : aucun passage');
  if (passagesPourEchec < 1 || passagesPourEchec > passages.length) throw new Error('jugerDefilementRelatif : seuil de passages hors bornes');
  const pireMsParPassage = passages.map((p) => Math.max(0, ...p.intervalles));
  const fautifsParPassage = passages.map((p) => p.intervalles.filter((i) => i > seuilMs).length);
  const passagesSaccades = fautifsParPassage.filter((n) => n > 0).length;
  const fautifsTotal = fautifsParPassage.reduce((t, n) => t + n, 0);
  return {
    seuilFautifMs: seuilMs,
    pireMsParPassage,
    fautifsParPassage,
    intervallesParPassage: passages.map((p) => p.intervalles.length),
    passagesSaccades,
    passagesPourEchec,
    fautifsTotal,
    fautifsTotalMax,
    fluide: passagesSaccades < passagesPourEchec && fautifsTotal <= fautifsTotalMax,
  };
}

export function decrireRelatif(libelle: string, plancher: Plancher, v: VerdictRelatif): string {
  return (
    `${libelle} : plancher ${plancher.medianeMs.toFixed(1)} ms → intervalle fautif au-delà de ${v.seuilFautifMs.toFixed(1)} ms ; pire intervalle ${v.pireMsParPassage.map((x) => x.toFixed(1)).join(', ')} ms ;` +
    ` fautifs ${v.fautifsParPassage.join(', ')} sur ${String(v.intervallesParPassage[0] ?? 0)} → ${String(v.passagesSaccades)} passage(s) saccadé(s) (échec à ${String(v.passagesPourEchec)}),` +
    ` ${String(v.fautifsTotal)} intervalle(s) fautif(s) au total (échec au-delà de ${String(v.fautifsTotalMax)})`
  );
}

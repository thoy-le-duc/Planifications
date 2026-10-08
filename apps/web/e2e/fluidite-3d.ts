import { expect, type Page } from '@playwright/test';

/**
 * T29b — mesures de fluidité de la vue 3D qui ne dépendent pas de la charge de la machine.
 *
 * Constat mesuré (T29b) : sous SwiftShader (WebGL logiciel), une toile 1280 × 800 qui ne fait
 * que « clear » coûte déjà 18 à 24 ms de swap par image (intervalle médian 33 ms) ; la scène de
 * la ferme T07 y ajoute 9 à 10 ms, et le JavaScript de la vue pèse moins de 1 ms par image. Les
 * intervalles entre images mesurent donc surtout le rendu logiciel et la charge de la machine :
 * un même code passe ou échoue selon l'heure. Des garde-fous stables complètent ce chiffre.
 *
 * Garde-fous stables (indépendants de la charge), qui protègent contre une régression du code :
 * temps JavaScript des callbacks `requestAnimationFrame` par image dessinée (médiane et 95e
 * centile), appels de dessin (draw calls) et triangles par image. Bornes mesurées, avec marge :
 * ferme T07 2 appels et 5 100 triangles ; jumeau T07 placé 7 appels et 77 634 triangles ; démo
 * 7 appels et 16 084 triangles ; JavaScript 0,2 à 0,6 ms par image en médiane.
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

/** Bornes de dessin par image selon la scène (ferme T07 : 2 appels et ~5 100 triangles mesurés). */
export interface BornesDessin {
  readonly appelsMax: number;
  readonly trianglesMax: number;
}
export const BORNES_FERME_T07: BornesDessin = { appelsMax: 4, trianglesMax: 8_000 };
/** Jumeau de la ferme T07 placée (bâtiments, arceaux, bâches) : plus de géométrie que la ferme seule. */
export const BORNES_JUMEAU_T07: BornesDessin = { appelsMax: 10, trianglesMax: 100_000 };
export const BORNES_DEMO: BornesDessin = { appelsMax: 10, trianglesMax: 25_000 };

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

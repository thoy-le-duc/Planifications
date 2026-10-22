/**
 * Rectangle englobant de surface minimale d'un contour (T81) : de quoi poser une serre, qui est un
 * rectangle, à la place d'un contour tracé à la main et un peu de travers. Pur : mètres du repère
 * de la ferme, ni base, ni réseau, ni horloge.
 *
 * Le rectangle d'aire minimale qui contient un polygone a toujours un côté sur un côté de son
 * enveloppe convexe : on essaie chaque côté de l'enveloppe et on garde la plus petite aire (à aire
 * égale, le premier côté de l'enveloppe).
 */
import type { Degres, Metres, PointLocal } from '../domaine/entites.ts';

const RAD = Math.PI / 180;
/** Aire en dessous de laquelle les sommets sont jugés alignés. */
const AIRE_NULLE_M2 = 1e-9;
/** Écart sous lequel deux aires sont jugées égales (le premier côté gagne). */
const EGALITE_AIRE_M2 = 1e-9;

export interface RectangleEnglobant {
  readonly centre: PointLocal;
  /** Plus grande des deux dimensions. */
  readonly longueurM: Metres;
  readonly largeurM: Metres;
  /** Cap de l'axe de la longueur, degrés, sens horaire depuis le nord, dans [0, 180[ (comme `repereZone`). */
  readonly orientationDeg: Degres;
}

const croix = (o: PointLocal, a: PointLocal, b: PointLocal): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Enveloppe convexe (chaîne monotone d'Andrew), sens antihoraire, sans points alignés. */
function enveloppe(points: readonly PointLocal[]): PointLocal[] {
  const tries = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const chaine = (ordre: readonly PointLocal[]): PointLocal[] => {
    const h: PointLocal[] = [];
    for (const p of ordre) {
      for (;;) {
        const b = h[h.length - 1];
        const a = h[h.length - 2];
        if (a === undefined || b === undefined || croix(a, b, p) > 0) break;
        h.pop();
      }
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...chaine(tries), ...chaine([...tries].reverse())];
}

/** `null` : moins de 3 sommets, ou sommets alignés. */
export function rectangleEnglobantMinimal(contour: readonly PointLocal[]): RectangleEnglobant | null {
  const points = contour.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < 3) return null;
  const h = enveloppe(points);
  if (h.length < 3) return null;

  let meilleur: { aire: number; ux: number; uy: number; amin: number; amax: number; bmin: number; bmax: number } | null = null;
  for (let i = 0; i < h.length; i++) {
    const p = h[i];
    const q = h[(i + 1) % h.length];
    if (p === undefined || q === undefined) return null;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d === 0) continue;
    const ux = (q.x - p.x) / d;
    const uy = (q.y - p.y) / d;
    let amin = Infinity;
    let amax = -Infinity;
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const s of h) {
      const a = s.x * ux + s.y * uy;
      const b = -s.x * uy + s.y * ux;
      amin = Math.min(amin, a);
      amax = Math.max(amax, a);
      bmin = Math.min(bmin, b);
      bmax = Math.max(bmax, b);
    }
    const aire = (amax - amin) * (bmax - bmin);
    if (meilleur === null || aire < meilleur.aire - EGALITE_AIRE_M2) meilleur = { aire, ux, uy, amin, amax, bmin, bmax };
  }
  if (meilleur === null || meilleur.aire < AIRE_NULLE_M2) return null;

  const { ux, uy, amin, amax, bmin, bmax } = meilleur;
  const ca = (amin + amax) / 2;
  const cb = (bmin + bmax) / 2;
  const centre = { x: ca * ux - cb * uy, y: ca * uy + cb * ux };
  const da = amax - amin;
  const db = bmax - bmin;
  // La longueur suit l'axe u si a est la plus grande dimension, sinon l'axe perpendiculaire.
  const [lx, ly, longueurM, largeurM] = da >= db ? [ux, uy, da, db] : [-uy, ux, db, da];
  let cap = (Math.atan2(lx, ly) / RAD) % 180;
  if (cap < 0) cap += 180;
  // Le bruit de calcul ne doit pas faire un cap de 179,999999999° pour un axe nord-sud.
  if (cap > 180 - 1e-9) cap = 0;
  return { centre, longueurM, largeurM, orientationDeg: cap };
}

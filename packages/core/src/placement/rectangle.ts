/**
 * Rectangle englobant de surface minimale d'un contour (T81) : de quoi poser une serre, qui est un
 * rectangle, à la place d'un contour tracé à la main et un peu de travers. Pur : mètres du repère
 * de la ferme, ni base, ni réseau, ni horloge.
 *
 * Le rectangle d'aire minimale qui contient un polygone a toujours un côté sur un côté de son
 * enveloppe convexe, donc parallèle à une droite qui joint deux sommets : on essaie chaque paire de
 * sommets (200 au plus : 40 000 directions, instantané) et on garde la plus petite aire. Tout
 * rectangle essayé contient le contour : les directions en trop ne faussent rien.
 */
import type { Degres, Metres, PointLocal } from '../domaine/entites.ts';

const RAD = Math.PI / 180;
/** Aire sous laquelle les sommets sont jugés alignés, et écart sous lequel deux aires sont égales. */
const EPSILON_M2 = 1e-9;

export interface RectangleEnglobant {
  readonly centre: PointLocal;
  /** Plus grande des deux dimensions. */
  readonly longueurM: Metres;
  readonly largeurM: Metres;
  /** Cap de l'axe de la longueur, degrés, sens horaire depuis le nord, dans [0, 180[ (comme `repereZone`). */
  readonly orientationDeg: Degres;
}

/** `null` : moins de 3 sommets, ou sommets alignés. */
export function rectangleEnglobantMinimal(contour: readonly PointLocal[]): RectangleEnglobant | null {
  let meilleur: { aire: number; u: PointLocal; a: readonly [number, number]; b: readonly [number, number] } | null = null;
  for (const [i, p] of contour.entries()) {
    for (const q of contour.slice(i + 1)) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d === 0) continue;
      const u = { x: (q.x - p.x) / d, y: (q.y - p.y) / d };
      const a = contour.map((s) => s.x * u.x + s.y * u.y);
      const b = contour.map((s) => s.y * u.x - s.x * u.y);
      const ba = [Math.min(...a), Math.max(...a)] as const;
      const bb = [Math.min(...b), Math.max(...b)] as const;
      const aire = (ba[1] - ba[0]) * (bb[1] - bb[0]);
      if (meilleur === null || aire < meilleur.aire - EPSILON_M2) meilleur = { aire, u, a: ba, b: bb };
    }
  }
  if (meilleur === null || meilleur.aire < EPSILON_M2) return null;

  const { u, a, b } = meilleur;
  const ca = (a[0] + a[1]) / 2;
  const cb = (b[0] + b[1]) / 2;
  const da = a[1] - a[0];
  const db = b[1] - b[0];
  // La longueur suit l'axe u si a est la plus grande dimension, sinon l'axe perpendiculaire.
  const [lx, ly] = da >= db ? [u.x, u.y] : [-u.y, u.x];
  // Le bruit de calcul ne doit pas faire un cap de 179,999999999° pour un axe nord-sud : arrondi au nanodegré.
  const cap = (Math.round((Math.atan2(lx, ly) / RAD) * 1e9) / 1e9 + 180) % 180;
  return { centre: { x: ca * u.x - cb * u.y, y: ca * u.y + cb * u.x }, longueurM: Math.max(da, db), largeurM: Math.min(da, db), orientationDeg: cap };
}

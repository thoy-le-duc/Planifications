/**
 * Géométrie de scène pour les tests de T28c (unitaires et e2e), indépendante du code de l'appli :
 * coins des rectangles tournés (convention de three, voir contrat-jumeau.ts), recouvrement par axe
 * séparateur, inclusion. Pas d'import de l'appli.
 */
import type { BatimentScene, SocleJumeau, VolumeJumeau } from './contrat-jumeau.ts';
import { tourner } from './projection.ts';

export const TOL = 1e-6;
export const RAD = Math.PI / 180;
export const DEUX_PI = 2 * Math.PI;

/** Deux angles égaux à `periode` près (2π pour un repère, π pour un rectangle symétrique). */
export function memeAngle(a: number, b: number, periode = DEUX_PI): boolean {
  const d = (((a - b) % periode) + periode) % periode;
  return d < 1e-6 || periode - d < 1e-6;
}

export interface Pt {
  readonly x: number;
  readonly z: number;
}

/** Coins d'un rectangle de scène : `ex` selon son x local, `ez` selon son z local, tourné de `angle`. */
export function coinsRect(cx: number, cz: number, ex: number, ez: number, angle: number): Pt[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx = 0, sz = 0]) => {
    const r = tourner((sx * ex) / 2, (sz * ez) / 2, angle);
    return { x: cx + r.x, z: cz + r.z };
  });
}

export const coinsVolume = (v: VolumeJumeau): Pt[] => coinsRect(v.x, v.z, v.longueur, v.largeur, v.angle);
export const coinsSocle = (s: SocleJumeau): Pt[] => coinsRect(s.x, s.z, s.largeur, s.profondeur, s.angle);
export const coinsBatiment = (b: BatimentScene): Pt[] => coinsRect(b.x, b.z, b.largeur, b.profondeur, b.angle);

/** Les polygones convexes se recouvrent-ils de plus de TOL (axe séparant = pas de recouvrement) ? */
export function recouvre(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (p === undefined || q === undefined) continue;
      const nx = -(q.z - p.z);
      const nz = q.x - p.x;
      const norme = Math.hypot(nx, nz);
      const proj = (pts: readonly Pt[]) => {
        const v = pts.map((c) => (c.x * nx + c.z * nz) / norme);
        return [Math.min(...v), Math.max(...v)] as const;
      };
      const [a0, a1] = proj(a);
      const [b0, b1] = proj(b);
      if (a1 <= b0 + TOL || b1 <= a0 + TOL) return false;
    }
  }
  return true;
}

export const aabb = (pts: readonly Pt[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)) });
export const rectDeAabb = (b: ReturnType<typeof aabb>): Pt[] => [
  { x: b.x0, z: b.z0 },
  { x: b.x1, z: b.z0 },
  { x: b.x1, z: b.z1 },
  { x: b.x0, z: b.z1 },
];
/** Polygone à comparer pour un socle : son rectangle (tourné), ou la boîte englobante de son contour. */
export const formeSocle = (s: SocleJumeau): Pt[] => (s.contour === null ? coinsSocle(s) : rectDeAabb(aabb(s.contour)));

/** `a` est entièrement dans le rectangle convexe `b` (à TOL près). */
export function dansRect(a: readonly Pt[], rect: readonly Pt[]): boolean {
  return a.every((c) => {
    let signe = 0;
    for (let i = 0; i < rect.length; i += 1) {
      const p = rect[i];
      const q = rect[(i + 1) % rect.length];
      if (p === undefined || q === undefined) continue;
      const croix = (q.x - p.x) * (c.z - p.z) - (q.z - p.z) * (c.x - p.x);
      if (Math.abs(croix) < TOL * Math.hypot(q.x - p.x, q.z - p.z)) continue;
      const s = Math.sign(croix);
      if (signe === 0) signe = s;
      else if (s !== signe) return false;
    }
    return true;
  });
}


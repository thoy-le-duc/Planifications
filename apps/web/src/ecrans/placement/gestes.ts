/**
 * Gestes de l'éditeur de placement (T28b), en fonctions pures : glisser, pivoter, redimensionner,
 * clavier, et passage d'une planche entre le repère de la ferme et celui de sa zone. Ni React, ni
 * DOM, ni réseau. Contrat : ./test/contrat.ts.
 *
 * Repère : mètres, x est, y nord. Orientation : cap en degrés, sens horaire depuis le nord ; l'axe
 * de la longueur est au cap θ, la largeur à sa droite (θ + 90°), comme `coinsEmprise` du cœur.
 */
import { depuisRepereZone, versRepereZone } from './coeur.ts';
import type { Point } from './tuiles.ts';

export interface RectanglePlace {
  readonly centre: Point;
  readonly orientationDeg: number;
  readonly longueurM: number;
  readonly largeurM: number;
}

export type Cote = 'avant' | 'arriere' | 'droite' | 'gauche';

export interface Touche {
  readonly key: string;
  readonly shiftKey: boolean;
}

export interface Repere {
  readonly centre: Point;
  readonly orientationDeg: number;
}

export interface PlacementPlanche {
  readonly x: number;
  readonly y: number;
  readonly orientation_deg: number;
}

/** Plus petite longueur ou largeur qu'un redimensionnement laisse. */
export const DIMENSION_MIN_M = 0.5;
const PAS_FIN_M = 0.1;
const PAS_GROS_M = 1;
const PAS_ANGLE_DEG = 1;
const CRAN_MAJ_DEG = 15;
const RAD = Math.PI / 180;

/** Ramène un cap dans [0, 360[. */
export function normaliserCap(degres: number): number {
  const c = ((degres % 360) + 360) % 360;
  return c >= 360 ? 0 : c;
}

export function glisser(r: RectanglePlace, de: Point, vers: Point): RectanglePlace {
  return { ...r, centre: { x: r.centre.x + (vers.x - de.x), y: r.centre.y + (vers.y - de.y) } };
}

/** L'axe de la longueur pointe vers le pointeur, au degré (Maj : aux 15°) ; sur le centre : inchangé. */
export function pivoter(r: RectanglePlace, pointeur: Point, maj: boolean): RectanglePlace {
  const dx = pointeur.x - r.centre.x;
  const dy = pointeur.y - r.centre.y;
  if (Math.hypot(dx, dy) < 1e-9) return r;
  const cran = maj ? CRAN_MAJ_DEG : PAS_ANGLE_DEG;
  const cap = normaliserCap(Math.atan2(dx, dy) / RAD);
  return { ...r, orientationDeg: normaliserCap(Math.round(cap / cran) * cran) };
}

/** Axe unitaire (repère de la ferme) vers l'extérieur du côté. */
function axeDuCote(r: RectanglePlace, cote: Cote): Point {
  const t = r.orientationDeg * RAD;
  const longueur = { x: Math.sin(t), y: Math.cos(t) };
  const largeur = { x: Math.cos(t), y: -Math.sin(t) };
  switch (cote) {
    case 'avant':
      return longueur;
    case 'arriere':
      return { x: -longueur.x, y: -longueur.y };
    case 'droite':
      return largeur;
    case 'gauche':
      return { x: -largeur.x, y: -largeur.y };
  }
}

/** Le côté vient sous le pointeur (projeté sur son axe), le côté opposé ne bouge pas. */
export function redimensionner(r: RectanglePlace, cote: Cote, pointeur: Point): RectanglePlace {
  const axe = axeDuCote(r, cote);
  const enLongueur = cote === 'avant' || cote === 'arriere';
  const dimension = enLongueur ? r.longueurM : r.largeurM;
  const projection = (pointeur.x - r.centre.x) * axe.x + (pointeur.y - r.centre.y) * axe.y;
  const nouvelle = Math.max(DIMENSION_MIN_M, projection + dimension / 2);
  const decalage = (nouvelle - dimension) / 2;
  return {
    ...r,
    centre: { x: r.centre.x + axe.x * decalage, y: r.centre.y + axe.y * decalage },
    ...(enLongueur ? { longueurM: nouvelle } : { largeurM: nouvelle }),
  };
}

/** Au micromètre : efface le bruit des additions de 0,1 m. */
const net = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Flèches : 0,1 m (Maj : 1 m) dans le repère de la ferme ; `]` et `[` : ±1°. Autre touche : null. */
export function appliquerTouche(r: RectanglePlace, touche: Touche): RectanglePlace | null {
  const pas = touche.shiftKey ? PAS_GROS_M : PAS_FIN_M;
  const deplacer = (dx: number, dy: number): RectanglePlace => ({ ...r, centre: { x: net(r.centre.x + dx), y: net(r.centre.y + dy) } });
  switch (touche.key) {
    case 'ArrowRight':
      return deplacer(pas, 0);
    case 'ArrowLeft':
      return deplacer(-pas, 0);
    case 'ArrowUp':
      return deplacer(0, pas);
    case 'ArrowDown':
      return deplacer(0, -pas);
    case ']':
      return { ...r, orientationDeg: normaliserCap(net(r.orientationDeg + PAS_ANGLE_DEG)) };
    case '[':
      return { ...r, orientationDeg: normaliserCap(net(r.orientationDeg - PAS_ANGLE_DEG)) };
    default:
      return null;
  }
}

/** Planche : rectangle du repère de la ferme → placement dans le repère de sa zone. */
export function versPlacementPlanche(repere: Repere, r: RectanglePlace): PlacementPlanche {
  const p = versRepereZone(repere, r.centre);
  return { x: p.x, y: p.y, orientation_deg: normaliserCap(r.orientationDeg - repere.orientationDeg) };
}

/** Inverse : placement d'une planche dans sa zone → centre et cap dans le repère de la ferme. */
export function depuisPlacementPlanche(repere: Repere, placement: PlacementPlanche): { centre: Point; orientationDeg: number } {
  return { centre: depuisRepereZone(repere, { x: placement.x, y: placement.y }), orientationDeg: normaliserCap(placement.orientation_deg + repere.orientationDeg) };
}

/** Tourne le rectangle de `degres` (sens horaire positif) autour de son centre ; le cap reste dans [0, 360[. */
export function tournerDe(r: RectanglePlace, degres: number): RectanglePlace {
  return { ...r, orientationDeg: normaliserCap(net(r.orientationDeg + degres)) };
}

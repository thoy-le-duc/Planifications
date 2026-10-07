/**
 * Repère local de la ferme et repère des zones (T28a, Q31 ; docs/modele-donnees.md, v1.x).
 *
 * Repère de la ferme : mètres, x vers l'est, y vers le nord, origine = `ferme.origine_plan`.
 * Orientation : cap en degrés, sens horaire depuis le nord. Tout est pur, sans arrondi.
 */
import type { Degres, Metres, PointLocal, PositionGeographique } from '../domaine/entites.ts';

/** Rayon équatorial WGS 84, en mètres. */
export const RAYON_TERRESTRE_M = 6_378_137;

const RAD = Math.PI / 180;

/**
 * Projection locale équirectangulaire autour de l'origine : x = R·Δλ·cos φ0, y = R·Δφ.
 * Exacte au centimètre près dans un rayon de 5 km (aller-retour exact, c'est la même formule).
 *
 * Antiméridien (±180° de longitude) : Δλ n'est pas ramené dans [−180°, 180°[. Une ferme dont le
 * plan chevaucherait l'antiméridien (îles Fidji, Tchoukotka…) aurait des x faux de toute la
 * circonférence ; hors de ce cas, rien à faire. Aux pôles, cos φ0 → 0 : la projection n'a pas de
 * sens au-delà de ±89°. Ni l'un ni l'autre ne concerne une ferme en Europe (hébergement UE).
 */
export function versLocal(origine: PositionGeographique, point: PositionGeographique): PointLocal {
  const cosPhi0 = Math.cos(origine.latitude * RAD);
  return {
    x: RAYON_TERRESTRE_M * (point.longitude - origine.longitude) * RAD * cosPhi0,
    y: RAYON_TERRESTRE_M * (point.latitude - origine.latitude) * RAD,
  };
}

/** Inverse exact de `versLocal`. */
export function versGeographique(origine: PositionGeographique, point: PointLocal): PositionGeographique {
  const cosPhi0 = Math.cos(origine.latitude * RAD);
  return {
    latitude: origine.latitude + point.y / RAYON_TERRESTRE_M / RAD,
    longitude: origine.longitude + point.x / (RAYON_TERRESTRE_M * cosPhi0) / RAD,
  };
}

/** Repère d'une zone ou d'un bâtiment : centre (repère de la ferme) et cap de la longueur. */
export interface RepereZone {
  readonly centre: PointLocal;
  /** Cap de l'axe de la longueur, degrés, sens horaire depuis le nord. */
  readonly orientationDeg: Degres;
}

export type Coins = readonly [PointLocal, PointLocal, PointLocal, PointLocal];

/**
 * Point du repère de la zone → repère de la ferme. Axe y' le long de la longueur (cap θ),
 * axe x' à sa droite (cap θ + 90°) : ey = (sin θ, cos θ), ex = (cos θ, −sin θ).
 */
export function depuisRepereZone(repere: RepereZone, point: PointLocal): PointLocal {
  const t = repere.orientationDeg * RAD;
  const s = Math.sin(t);
  const c = Math.cos(t);
  return {
    x: repere.centre.x + point.x * c + point.y * s,
    y: repere.centre.y - point.x * s + point.y * c,
  };
}

/** Inverse exact de `depuisRepereZone` (base orthonormée : projection sur ex et ey). */
export function versRepereZone(repere: RepereZone, point: PointLocal): PointLocal {
  const t = repere.orientationDeg * RAD;
  const s = Math.sin(t);
  const c = Math.cos(t);
  const dx = point.x - repere.centre.x;
  const dy = point.y - repere.centre.y;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/**
 * Les 4 coins d'un rectangle (bâtiment), dans le repère de la ferme, en sens antihoraire :
 * (−l/2, −L/2), (+l/2, −L/2), (+l/2, +L/2), (−l/2, +L/2) du repère du rectangle.
 */
export function coinsEmprise(centre: PointLocal, longueurM: Metres, largeurM: Metres, orientationDeg: Degres): Coins {
  const repere: RepereZone = { centre, orientationDeg };
  const l = largeurM / 2;
  const L = longueurM / 2;
  return [
    depuisRepereZone(repere, { x: -l, y: -L }),
    depuisRepereZone(repere, { x: l, y: -L }),
    depuisRepereZone(repere, { x: l, y: L }),
    depuisRepereZone(repere, { x: -l, y: L }),
  ];
}

/** Écart sous lequel deux longueurs de côté sont jugées égales. */
const EGALITE_LONGUEUR_M = 1e-9;

/**
 * Repère d'une zone : celui du bâtiment qui l'abrite, sinon centroïde de surface et cap du plus
 * long côté du polygone (ramené dans [0, 180[ : un côté n'a pas de sens) ; `null` si la zone
 * n'est ni placée ni abritée.
 */
export function repereZone(
  zone: { readonly contour: readonly PointLocal[] | null },
  batiment?: { readonly centre: PointLocal; readonly orientationDeg: Degres } | null,
): RepereZone | null {
  if (batiment !== undefined && batiment !== null) {
    return { centre: batiment.centre, orientationDeg: batiment.orientationDeg };
  }
  const contour = zone.contour;
  if (contour === null || contour.length < 3) return null;
  const premier = contour[0];
  if (premier === undefined) return null;

  // Centroïde de surface (formule du lacet), calculé relativement au premier sommet.
  let aire2 = 0;
  let cx = 0;
  let cy = 0;
  let plusLong = -1;
  let cap = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    if (a === undefined || b === undefined) return null;
    const ax = a.x - premier.x;
    const ay = a.y - premier.y;
    const bx = b.x - premier.x;
    const by = b.y - premier.y;
    const croix = ax * by - bx * ay;
    aire2 += croix;
    cx += (ax + bx) * croix;
    cy += (ay + by) * croix;

    const longueur = Math.hypot(b.x - a.x, b.y - a.y);
    if (longueur > plusLong + EGALITE_LONGUEUR_M) {
      plusLong = longueur;
      cap = Math.atan2(b.x - a.x, b.y - a.y) / RAD;
    }
  }
  if (!Number.isFinite(aire2) || aire2 === 0) return null;
  let orientation = ((cap % 180) + 180) % 180;
  if (orientation >= 180 || 180 - orientation < 1e-12) orientation = 0;
  return {
    centre: { x: premier.x + cx / (3 * aire2), y: premier.y + cy / (3 * aire2) },
    orientationDeg: orientation,
  };
}

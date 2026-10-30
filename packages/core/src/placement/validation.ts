/**
 * Règles d'un placement (T28a, Q31) : contour d'une zone, placement d'un emplacement dans sa
 * zone, emprise d'un bâtiment. Ce sont les règles que le serveur rejouera (T28s) ; la base en
 * rejoue les bornes simples (packages/db, contraintes CHECK et déclencheurs).
 *
 * Pures, sans exception quelle que soit l'entrée ; messages en français. Le placement d'une ligne
 * (validerPlacement) est à part, dans ./ligne.ts : l'éditeur de placement, qui ne valide que des
 * contours, n'en charge pas le code (budget de son morceau, scripts/placement.test.ts).
 */
import type { PointLocal, TypeBatiment } from '../domaine/entites.ts';

/** Distance maximale d'un point placé à l'origine du plan (ou au centre de sa zone). */
export const DISTANCE_MAX_ORIGINE_M = 5_000;
export const CONTOUR_SOMMETS_MIN = 3;
export const CONTOUR_SOMMETS_MAX = 200;
/** Aire minimale d'un contour, en m². */
export const AIRE_MIN_M2 = 0.1;
/** Deux sommets consécutifs à moins de 1 mm l'un de l'autre sont confondus. */
const SOMMETS_CONFONDUS_M = 1e-3;
/** Plafonds d'un bâtiment, bornes comprises. */
export const PLAFONDS_BATIMENT: { readonly longueurM: number; readonly largeurM: number; readonly hauteurM: number } = {
  longueurM: 500,
  largeurM: 200,
  hauteurM: 30,
};
export const TYPES_BATIMENT: readonly TypeBatiment[] = ['serre_tunnel', 'serre_chapelle', 'hangar', 'local', 'chambre_froide', 'magasin', 'autre'];

export type CodeErreurPlacement =
  | 'entree_invalide'
  | 'trop_peu_de_sommets'
  | 'trop_de_sommets'
  | 'coordonnee_invalide'
  | 'trop_loin'
  | 'sommets_confondus'
  | 'auto_intersection'
  | 'aire_nulle'
  | 'incomplet'
  | 'orientation_invalide'
  | 'dimension_invalide'
  | 'plafond_depasse'
  | 'zone_abritee_avec_contour'
  // T88 : les allées d'une serre prennent toute sa longueur.
  | 'grille_impossible';

export interface ErreurPlacement {
  readonly code: CodeErreurPlacement;
  /** Colonne en cause ('orientation_deg', 'contour'…), ou null. */
  readonly champ: string | null;
  /** En français, 200 caractères au plus. */
  readonly message: string;
}

export type ResultatPlacement<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurPlacement };

export interface EntreePlacementEmplacement {
  readonly table: 'emplacement';
  readonly ligne: Readonly<Record<string, unknown>>;
}
export interface EntreePlacementBatiment {
  readonly table: 'batiment';
  readonly ligne: Readonly<Record<string, unknown>>;
}
export interface EntreePlacementZone {
  readonly table: 'zone';
  readonly ligne: Readonly<Record<string, unknown>>;
  /** Un bâtiment non supprimé abrite la zone (le serveur le lit en base). */
  readonly abritee: boolean;
}

export interface PlacementEmplacement {
  readonly placement_x_m: number | null;
  readonly placement_y_m: number | null;
  readonly orientation_deg: number | null;
}
export interface PlacementBatiment {
  readonly longueur_m: number;
  readonly largeur_m: number;
  readonly hauteur_m: number;
  readonly centre_x_m: number;
  readonly centre_y_m: number;
  readonly orientation_deg: number;
  /** T88 : la grille de la serre (chapelles × tronçons, allées) ; nulle = une bande par sous-zone (T86). */
  readonly nb_chapelles: number | null;
  readonly nb_troncons: number | null;
  readonly largeur_allee_m: number | null;
}
export interface PlacementZone {
  readonly contour: readonly PointLocal[] | null;
}

export function refus<T>(code: CodeErreurPlacement, champ: string | null, message: string): ResultatPlacement<T> {
  return { ok: false, erreur: { code, champ, message } };
}

export const estNombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/**
 * (x, y) à plus de 5 km de l'origine. Relecture T61 : la base compare en numeric EXACT
 * (x² + y² ≤ 25 000 000), les flottants arrondissent (un millionième de m² près de la borne).
 * Petite marge : à moins de 10⁻⁶ m² sous la borne, seules des coordonnées entières (calcul exact
 * en flottants jusqu'à 5 km) sont acceptées ; un point juste au-delà est refusé ici, jamais par la base.
 */
export function tropLoin(x: number, y: number): boolean {
  const d = x * x + y * y - DISTANCE_MAX_ORIGINE_M * DISTANCE_MAX_ORIGINE_M;
  return d > 0 || (d > -1e-6 && (x % 1 !== 0 || y % 1 !== 0));
}
export const orientationValide = (v: unknown): v is number => estNombre(v) && v >= 0 && v < 360;

// ── Contour ──────────────────────────────────────────────────────────────────────────────────

/** Signe de l'orientation du triangle (a, b, c) : > 0 à gauche, < 0 à droite, 0 alignés. */
function orient(a: PointLocal, b: PointLocal, c: PointLocal): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** c, aligné avec [a, b], est dans la boîte de [a, b]. */
function surSegment(a: PointLocal, b: PointLocal, c: PointLocal): boolean {
  return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
}

/** Les segments [p1, p2] et [q1, q2] ont au moins un point commun (croisement ou contact). */
function segmentsSeTouchent(p1: PointLocal, p2: PointLocal, q1: PointLocal, q2: PointLocal): boolean {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4 && o1 * o2 <= 0 && o3 * o4 <= 0) return true;
  if (o1 === 0 && surSegment(p1, p2, q1)) return true;
  if (o2 === 0 && surSegment(p1, p2, q2)) return true;
  if (o3 === 0 && surSegment(q1, q2, p1)) return true;
  if (o4 === 0 && surSegment(q1, q2, p2)) return true;
  return false;
}

/** Deux côtés non adjacents du polygone ont un point commun. */
function autoIntersecte(p: readonly PointLocal[]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a1 = p[i];
    const a2 = p[(i + 1) % n];
    if (a1 === undefined || a2 === undefined) return true;
    for (let j = i + 2; j < n; j++) {
      // Le dernier côté est adjacent au premier.
      if (i === 0 && j === n - 1) continue;
      const b1 = p[j];
      const b2 = p[(j + 1) % n];
      if (b1 === undefined || b2 === undefined) return true;
      if (segmentsSeTouchent(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Aire signée (formule du lacet, relative au premier sommet) : > 0 en sens antihoraire. */
function aireSignee(p: readonly PointLocal[]): number {
  const o = p[0];
  if (o === undefined) return 0;
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    if (a === undefined || b === undefined) return 0;
    s += (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y);
  }
  return s / 2;
}

/** Sommet `{x, y}` à coordonnées finies, ou null. */
function lireSommet(v: unknown): PointLocal | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const x: unknown = (v as { x?: unknown }).x;
  const y: unknown = (v as { y?: unknown }).y;
  return estNombre(x) && estNombre(y) ? { x, y } : null;
}

function validerContourSansGarde(entree: unknown): ResultatPlacement<readonly PointLocal[]> {
  if (!Array.isArray(entree)) return refus('entree_invalide', null, 'Le contour doit être une liste de sommets.');
  const brut: readonly unknown[] = entree;
  if (brut.length < CONTOUR_SOMMETS_MIN) {
    return refus('trop_peu_de_sommets', null, `Un contour a au moins ${String(CONTOUR_SOMMETS_MIN)} sommets.`);
  }
  if (brut.length > CONTOUR_SOMMETS_MAX) {
    return refus('trop_de_sommets', null, `Un contour a au plus ${String(CONTOUR_SOMMETS_MAX)} sommets.`);
  }
  const sommets: PointLocal[] = [];
  for (let i = 0; i < brut.length; i++) {
    const s = lireSommet(brut[i]);
    if (s === null) {
      return refus('coordonnee_invalide', null, `Le sommet ${String(i + 1)} n’a pas de coordonnées x et y en mètres.`);
    }
    sommets.push(s);
  }
  for (let i = 0; i < sommets.length; i++) {
    const s = sommets[i];
    if (s !== undefined && tropLoin(s.x, s.y)) {
      return refus('trop_loin', null, `Le sommet ${String(i + 1)} est à plus de 5 km de l’origine du plan.`);
    }
  }
  for (let i = 0; i < sommets.length; i++) {
    const a = sommets[i];
    const b = sommets[(i + 1) % sommets.length];
    if (a !== undefined && b !== undefined && Math.hypot(b.x - a.x, b.y - a.y) < SOMMETS_CONFONDUS_M) {
      if (i === sommets.length - 1) {
        return refus('sommets_confondus', null, 'Le dernier sommet est confondu avec le premier : ne répétez pas le premier sommet à la fin du contour.');
      }
      return refus('sommets_confondus', null, `Les sommets ${String(i + 1)} et ${String(i + 2)} sont confondus.`);
    }
  }
  if (autoIntersecte(sommets)) {
    return refus('auto_intersection', null, 'Le contour se recoupe : deux côtés se croisent ou se touchent.');
  }
  const aire = aireSignee(sommets);
  if (!(Math.abs(aire) > AIRE_MIN_M2)) {
    return refus('aire_nulle', null, 'La surface du contour est nulle ou trop petite (0,1 m² au moins).');
  }
  return { ok: true, valeur: aire > 0 ? sommets : sommets.reverse() };
}

/**
 * Contour d'une zone : 3 à 200 sommets `{x, y}` finis, à 5 km au plus de l'origine, sans
 * sommets consécutifs confondus, sans auto-intersection, d'aire > 0,1 m². Valide : les sommets
 * (x et y seulement) en sens antihoraire.
 */
export function validerContour(entree: unknown): ResultatPlacement<readonly PointLocal[]> {
  try {
    return validerContourSansGarde(entree);
  } catch {
    // Entrée hostile (accesseur qui lève…) : refusée, jamais d'exception.
    return refus('entree_invalide', null, 'Le contour est illisible.');
  }
}

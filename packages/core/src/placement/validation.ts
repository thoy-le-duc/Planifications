/**
 * Règles d'un placement (T28a, Q31) : contour d'une zone, placement d'un emplacement dans sa
 * zone, emprise d'un bâtiment. Ce sont les règles que le serveur rejouera (T28s) ; la base en
 * rejoue les bornes simples (packages/db, contraintes CHECK et déclencheurs).
 *
 * Pures, sans exception quelle que soit l'entrée ; messages en français.
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
export const TYPES_BATIMENT: readonly TypeBatiment[] = ['serre_tunnel', 'serre_chapelle', 'hangar', 'magasin', 'autre'];

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
  | 'zone_abritee_avec_contour';

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
}
export interface PlacementZone {
  readonly contour: readonly PointLocal[] | null;
}

function refus<T>(code: CodeErreurPlacement, champ: string | null, message: string): ResultatPlacement<T> {
  return { ok: false, erreur: { code, champ, message } };
}

const estNombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const tropLoin = (x: number, y: number): boolean => x * x + y * y > DISTANCE_MAX_ORIGINE_M * DISTANCE_MAX_ORIGINE_M;
const orientationValide = (v: unknown): v is number => estNombre(v) && v >= 0 && v < 360;

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
      return refus('sommets_confondus', null, `Les sommets ${String(i + 1)} et ${String(((i + 1) % sommets.length) + 1)} sont confondus.`);
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

// ── Placement d'une ligne ────────────────────────────────────────────────────────────────────

const estNul = (v: unknown): boolean => v === null || v === undefined;

const LIBELLES: Readonly<Record<string, string>> = {
  placement_x_m: 'la position est-ouest',
  placement_y_m: 'la position nord-sud',
  orientation_deg: 'l’orientation',
  longueur_m: 'la longueur',
  largeur_m: 'la largeur',
  hauteur_m: 'la hauteur',
  centre_x_m: 'la position est-ouest du centre',
  centre_y_m: 'la position nord-sud du centre',
};
const libelle = (c: string): string => LIBELLES[c] ?? c;

const COLONNES_EMPLACEMENT = ['placement_x_m', 'placement_y_m', 'orientation_deg'] as const;

function validerEmplacement(ligne: Readonly<Record<string, unknown>>): ResultatPlacement<PlacementEmplacement> {
  const x = ligne.placement_x_m;
  const y = ligne.placement_y_m;
  const o = ligne.orientation_deg;
  const nuls = COLONNES_EMPLACEMENT.filter((c) => estNul(ligne[c]));
  if (nuls.length === COLONNES_EMPLACEMENT.length) {
    return { ok: true, valeur: { placement_x_m: null, placement_y_m: null, orientation_deg: null } };
  }
  const premierNul = nuls[0];
  if (premierNul !== undefined) {
    return refus('incomplet', premierNul, `Placement incomplet : il manque ${libelle(premierNul)}.`);
  }
  if (!estNombre(x)) return refus('coordonnee_invalide', 'placement_x_m', 'La position est-ouest doit être un nombre de mètres.');
  if (!estNombre(y)) return refus('coordonnee_invalide', 'placement_y_m', 'La position nord-sud doit être un nombre de mètres.');
  if (!orientationValide(o)) return refus('orientation_invalide', 'orientation_deg', 'L’orientation doit être comprise entre 0 et 360 degrés (360 exclu).');
  if (tropLoin(x, y)) return refus('trop_loin', 'placement_x_m', 'L’emplacement est à plus de 5 km du centre de sa zone.');
  return { ok: true, valeur: { placement_x_m: x, placement_y_m: y, orientation_deg: o } };
}

const DIMENSIONS = { longueur_m: 'La longueur', largeur_m: 'La largeur', hauteur_m: 'La hauteur' } as const;

const COLONNES_BATIMENT = ['longueur_m', 'largeur_m', 'hauteur_m', 'centre_x_m', 'centre_y_m', 'orientation_deg'] as const;

function validerBatiment(ligne: Readonly<Record<string, unknown>>): ResultatPlacement<PlacementBatiment> {
  const manquante = COLONNES_BATIMENT.find((c) => estNul(ligne[c]));
  if (manquante !== undefined) {
    return refus('incomplet', manquante, `Un bâtiment est toujours placé : il manque ${libelle(manquante)}.`);
  }
  const cx = ligne.centre_x_m;
  const cy = ligne.centre_y_m;
  if (!estNombre(cx)) return refus('coordonnee_invalide', 'centre_x_m', 'La position est-ouest du centre doit être un nombre de mètres.');
  if (!estNombre(cy)) return refus('coordonnee_invalide', 'centre_y_m', 'La position nord-sud du centre doit être un nombre de mètres.');
  const dimensions = [
    ['longueur_m', PLAFONDS_BATIMENT.longueurM],
    ['largeur_m', PLAFONDS_BATIMENT.largeurM],
    ['hauteur_m', PLAFONDS_BATIMENT.hauteurM],
  ] as const;
  const valeurs: number[] = [];
  for (const [c] of dimensions) {
    const v = ligne[c];
    if (!estNombre(v) || v <= 0) {
      return refus('dimension_invalide', c, `${DIMENSIONS[c]} doit être un nombre de mètres plus grand que zéro.`);
    }
    valeurs.push(v);
  }
  for (let i = 0; i < dimensions.length; i++) {
    const d = dimensions[i];
    const v = valeurs[i];
    if (d !== undefined && v !== undefined && v > d[1]) {
      return refus('plafond_depasse', d[0], `${DIMENSIONS[d[0]]} dépasse ${String(d[1])} m.`);
    }
  }
  const o = ligne.orientation_deg;
  if (!orientationValide(o)) return refus('orientation_invalide', 'orientation_deg', 'L’orientation doit être comprise entre 0 et 360 degrés (360 exclu).');
  if (tropLoin(cx, cy)) return refus('trop_loin', 'centre_x_m', 'Le bâtiment est à plus de 5 km de l’origine du plan.');
  const [longueur, largeur, hauteur] = valeurs;
  if (longueur === undefined || largeur === undefined || hauteur === undefined) {
    return refus('dimension_invalide', 'longueur_m', 'Les dimensions du bâtiment sont illisibles.');
  }
  return {
    ok: true,
    valeur: { longueur_m: longueur, largeur_m: largeur, hauteur_m: hauteur, centre_x_m: cx, centre_y_m: cy, orientation_deg: o },
  };
}

function validerZone(ligne: Readonly<Record<string, unknown>>, abritee: boolean): ResultatPlacement<PlacementZone> {
  let contour: unknown = ligne.contour;
  if (estNul(contour)) return { ok: true, valeur: { contour: null } };
  if (abritee) {
    return refus(
      'zone_abritee_avec_contour',
      'contour',
      'Cette zone est abritée par un bâtiment : sa forme est celle du bâtiment, elle n’a pas de contour à elle.',
    );
  }
  if (typeof contour === 'string') {
    try {
      contour = JSON.parse(contour);
    } catch {
      return refus('entree_invalide', 'contour', 'Le contour est illisible.');
    }
  }
  const r = validerContour(contour);
  if (!r.ok) return refus(r.erreur.code, 'contour', r.erreur.message);
  return { ok: true, valeur: { contour: r.valeur } };
}

/**
 * Placement d'une ligne (colonnes snake_case telles que le téléphone les envoie) ; `champ` de
 * l'erreur = nom de la colonne. Voir docs/modele-donnees.md, v1.x.
 */
export function validerPlacement(entree: EntreePlacementEmplacement): ResultatPlacement<PlacementEmplacement>;
export function validerPlacement(entree: EntreePlacementBatiment): ResultatPlacement<PlacementBatiment>;
export function validerPlacement(entree: EntreePlacementZone): ResultatPlacement<PlacementZone>;
export function validerPlacement(
  entree: EntreePlacementEmplacement | EntreePlacementBatiment | EntreePlacementZone,
): ResultatPlacement<PlacementEmplacement | PlacementBatiment | PlacementZone> {
  try {
    switch (entree.table) {
      case 'emplacement':
        return validerEmplacement(entree.ligne);
      case 'batiment':
        return validerBatiment(entree.ligne);
      case 'zone':
        return validerZone(entree.ligne, entree.abritee);
    }
    return refus('entree_invalide', null, 'Table inconnue pour un placement.');
  } catch {
    // Ligne hostile (accesseur qui lève…) : refusée, jamais d'exception.
    return refus('entree_invalide', null, 'La ligne est illisible.');
  }
}

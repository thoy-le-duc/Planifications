/**
 * Chemins, points du plan et rangement des outils (T61, Q44 ; docs/modele-donnees.md, « Plan de
 * la ferme : chemins, repères, rangement »). Règles d'une ligne, rejouées par la porte du
 * téléphone (packages/sync) et par le serveur (apps/api/src/sync/plan-chemins.ts) ; la base en
 * rejoue les bornes simples (packages/db, contraintes CHECK).
 *
 * Pures, sans exception quelle que soit l'entrée ; messages en français.
 */
import type { PointLocal } from '../domaine/entites.ts';
import { DISTANCE_MAX_ORIGINE_M, type CodeErreurPlacement, type ResultatPlacement } from './validation.ts';

export const CHEMIN_POINTS_MIN = 2;
export const CHEMIN_POINTS_MAX = 200;
/** Largeur maximale d'un chemin, en mètres (borne comprise). */
export const PLAFOND_LARGEUR_CHEMIN_M = 20;
/** Sortes d'un point du plan : point d'eau, ou autre repère nommé (portail, abri…). */
export const SORTES_POINT_PLAN = ['point_eau', 'repere'] as const;
export type SortePointPlan = (typeof SORTES_POINT_PLAN)[number];
/** Longueurs au plus d'un nom (après trim). */
export const NOM_POINT_PLAN_MAX = 80;
export const NOM_CHEMIN_MAX = 80;
export const NOM_PLACE_RANGEMENT_MAX = 60;
export const NOM_OUTIL_MAX = 80;

/** Deux points consécutifs à moins de 1 mm l'un de l'autre sont confondus. */
const POINTS_CONFONDUS_M = 1e-3;

export interface CheminValide {
  readonly points: readonly PointLocal[];
  readonly largeur_m: number;
}
export interface PointPlanValide {
  readonly nom: string;
  readonly sorte: SortePointPlan;
  readonly x_m: number;
  readonly y_m: number;
}
export interface PlaceRangementValide {
  readonly nom: string;
}
export interface OutilValide {
  readonly nom: string;
  readonly lieu_rangement_id: string;
  readonly place_rangement_id: string | null;
}

function refus<T>(code: CodeErreurPlacement, champ: string | null, message: string): ResultatPlacement<T> {
  return { ok: false, erreur: { code, champ, message } };
}

const estNombre = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const tropLoin = (x: number, y: number): boolean => x * x + y * y > DISTANCE_MAX_ORIGINE_M * DISTANCE_MAX_ORIGINE_M;
const estObjet = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Texte non vide après trim, `max` caractères au plus : le texte sans espaces autour, ou null. */
function nomValide(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= max && !t.includes('\u0000') ? t : null;
}

function validerCheminSansGarde(ligne: unknown): ResultatPlacement<CheminValide> {
  if (!estObjet(ligne) || !Array.isArray(ligne.points)) {
    return refus('entree_invalide', 'points', 'Le tracé du chemin est illisible : une liste de points est attendue.');
  }
  const brut: readonly unknown[] = ligne.points;
  if (brut.length < CHEMIN_POINTS_MIN) return refus('trop_peu_de_sommets', 'points', 'Un chemin relie au moins 2 points.');
  if (brut.length > CHEMIN_POINTS_MAX) return refus('trop_de_sommets', 'points', `Un chemin a ${String(CHEMIN_POINTS_MAX)} points au plus.`);
  const points: PointLocal[] = [];
  for (let i = 0; i < brut.length; i++) {
    const p = brut[i];
    const x: unknown = estObjet(p) ? p.x : undefined;
    const y: unknown = estObjet(p) ? p.y : undefined;
    if (!estNombre(x) || !estNombre(y)) {
      return refus('coordonnee_invalide', 'points', `Le point ${String(i + 1)} du chemin n’a pas de coordonnées x et y en mètres.`);
    }
    points.push({ x, y });
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p !== undefined && tropLoin(p.x, p.y)) {
      return refus('trop_loin', 'points', `Le point ${String(i + 1)} du chemin est à plus de 5 km de l’origine du plan.`);
    }
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined && Math.hypot(b.x - a.x, b.y - a.y) < POINTS_CONFONDUS_M) {
      return refus('sommets_confondus', 'points', `Les points ${String(i)} et ${String(i + 1)} du chemin sont confondus.`);
    }
  }
  const largeur = ligne.largeur_m;
  if (!estNombre(largeur) || largeur <= 0) {
    return refus('dimension_invalide', 'largeur_m', 'La largeur du chemin doit être un nombre de mètres plus grand que zéro.');
  }
  if (largeur > PLAFOND_LARGEUR_CHEMIN_M) {
    return refus('plafond_depasse', 'largeur_m', `La largeur du chemin dépasse ${String(PLAFOND_LARGEUR_CHEMIN_M)} m.`);
  }
  return { ok: true, valeur: { points, largeur_m: largeur } };
}

/**
 * Chemin (ligne OUVERTE, tracée point par point) : 2 à 200 points `{x, y}` finis, à 5 km au plus
 * de l'origine, sans points consécutifs confondus ; largeur > 0 et ≤ 20 m. Il peut se croiser ou
 * revenir sur lui-même. Valide : les points (x et y seulement) dans l'ordre reçu, et la largeur.
 */
export function validerChemin(ligne: unknown): ResultatPlacement<CheminValide> {
  try {
    return validerCheminSansGarde(ligne);
  } catch {
    // Entrée hostile (accesseur qui lève…) : refusée, jamais d'exception.
    return refus('entree_invalide', 'points', 'Le chemin est illisible.');
  }
}

/** Nom facultatif d'un chemin : nul, ou 1 à 80 caractères après trim. undefined si invalide. */
export function nomDeChemin(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  return nomValide(v, NOM_CHEMIN_MAX) ?? undefined;
}

/** Point du plan (point d'eau ou repère) : nom, sorte, position à 5 km au plus de l'origine. */
export function validerPointPlan(ligne: unknown): ResultatPlacement<PointPlanValide> {
  try {
    if (!estObjet(ligne)) return refus('entree_invalide', null, 'Le point du plan est illisible.');
    const nom = nomValide(ligne.nom, NOM_POINT_PLAN_MAX);
    if (nom === null) return refus('incomplet', 'nom', `Un point du plan a un nom, de ${String(NOM_POINT_PLAN_MAX)} caractères au plus.`);
    const sorte = ligne.sorte;
    if (typeof sorte !== 'string' || !(SORTES_POINT_PLAN as readonly string[]).includes(sorte)) {
      return refus('entree_invalide', 'sorte', 'Un point du plan est un point d’eau ou un repère.');
    }
    const x = ligne.x_m;
    const y = ligne.y_m;
    if (!estNombre(x)) return refus('coordonnee_invalide', 'x_m', 'La position est-ouest du point doit être un nombre de mètres.');
    if (!estNombre(y)) return refus('coordonnee_invalide', 'y_m', 'La position nord-sud du point doit être un nombre de mètres.');
    if (tropLoin(x, y)) return refus('trop_loin', 'x_m', 'Le point est à plus de 5 km de l’origine du plan.');
    return { ok: true, valeur: { nom, sorte: sorte as SortePointPlan, x_m: x, y_m: y } };
  } catch {
    return refus('entree_invalide', null, 'Le point du plan est illisible.');
  }
}

/** Place dans un lieu de rangement (« mur nord ») : un nom de 1 à 60 caractères. */
export function validerPlaceRangement(ligne: unknown): ResultatPlacement<PlaceRangementValide> {
  try {
    const nom = estObjet(ligne) ? nomValide(ligne.nom, NOM_PLACE_RANGEMENT_MAX) : null;
    if (nom === null) return refus('incomplet', 'nom', `Une place de rangement a un nom, de ${String(NOM_PLACE_RANGEMENT_MAX)} caractères au plus.`);
    return { ok: true, valeur: { nom } };
  } catch {
    return refus('entree_invalide', null, 'La place de rangement est illisible.');
  }
}

const identifiant = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Outil de la ferme : un nom de 1 à 80 caractères, un lieu de rangement (obligatoire), une place facultative. */
export function validerOutil(ligne: unknown): ResultatPlacement<OutilValide> {
  try {
    if (!estObjet(ligne)) return refus('entree_invalide', null, 'L’outil est illisible.');
    const nom = nomValide(ligne.nom, NOM_OUTIL_MAX);
    if (nom === null) return refus('incomplet', 'nom', `Un outil a un nom, de ${String(NOM_OUTIL_MAX)} caractères au plus.`);
    const lieu = ligne.lieu_rangement_id;
    if (!identifiant(lieu)) return refus('incomplet', 'lieu_rangement_id', 'Un outil a toujours un lieu de rangement.');
    const place = ligne.place_rangement_id ?? null;
    if (place !== null && !identifiant(place)) return refus('entree_invalide', 'place_rangement_id', 'La place de rangement de l’outil est illisible.');
    return { ok: true, valeur: { nom, lieu_rangement_id: lieu, place_rangement_id: place } };
  } catch {
    return refus('entree_invalide', null, 'L’outil est illisible.');
  }
}

/** Nom comparable : sans majuscules, sans accents, sans espaces autour. */
export function nomComparable(nom: string): string {
  return nom
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * L'outil qu'un travail prévu désigne (le travail porte le NOM de l'outil, ex. « grelinette ») :
 * égalité sans tenir compte des majuscules, des accents ni des espaces autour ; null si aucun
 * (jamais l'outil le plus proche).
 */
export function trouverOutil<T extends { readonly id: string; readonly nom: string }>(nomTravail: string, outils: readonly T[]): T | null {
  const cherche = nomComparable(nomTravail);
  if (cherche === '') return null;
  return outils.find((o) => nomComparable(o.nom) === cherche) ?? null;
}

/**
 * « Grelinette — hangar, mur nord » : nom de l'outil (première lettre en capitale), lieu et place
 * tels que saisis, sans espaces autour. Sans place : « Grelinette — hangar » ; sans lieu : le nom seul.
 */
export function libelleRangement(nomOutil: string, lieu: string | null, place: string | null): string {
  const t = nomOutil.trim();
  const nom = t.charAt(0).toUpperCase() + t.slice(1);
  const l = lieu?.trim() ?? '';
  if (l === '') return nom;
  const p = place?.trim() ?? '';
  return p === '' ? `${nom} — ${l}` : `${nom} — ${l}, ${p}`;
}

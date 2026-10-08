/**
 * Lectures de l'éditeur de placement (T28b) : requêtes surveillées de la porte et conversion des
 * lignes locales (snake_case, JSON en texte) en objets typés. Une ligne illisible est écartée.
 */
import { TYPES_BATIMENT, type TypeBatiment } from '@planif/core';
import type { PorteDonnees, RequeteSurveillee } from '@planif/sync';
import type { Position, Point } from './tuiles.ts';

type Ligne = Readonly<Record<string, unknown>>;

export interface Batiment {
  readonly id: string;
  readonly nom: string;
  readonly type: TypeBatiment;
  readonly centre: Point;
  readonly orientationDeg: number;
  readonly longueurM: number;
  readonly largeurM: number;
  readonly hauteurM: number;
  readonly zoneId: string | null;
  /** Posé dans le brouillon, pas encore écrit. */
  readonly nouveau: boolean;
}

export interface Zone {
  readonly id: string;
  readonly nom: string;
  readonly contour: readonly Point[] | null;
}

export interface Planche {
  readonly id: string;
  readonly zoneId: string;
  readonly code: string;
  readonly longueurM: number;
  readonly largeurM: number;
  readonly placement: { readonly x: number; readonly y: number; readonly orientation_deg: number };
}

export interface FermeLue {
  readonly position: Position | null;
  readonly origine: Position | null;
}

export const TYPES: readonly { readonly valeur: TypeBatiment; readonly libelle: string }[] = [
  { valeur: 'serre_tunnel', libelle: 'Serre tunnel' },
  { valeur: 'serre_chapelle', libelle: 'Serre chapelle' },
  { valeur: 'hangar', libelle: 'Hangar' },
  { valeur: 'magasin', libelle: 'Magasin' },
  { valeur: 'autre', libelle: 'Autre' },
];

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texte = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function json(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

function position(v: unknown): Position | null {
  const j = json(v);
  if (typeof j !== 'object' || j === null) return null;
  const { latitude, longitude } = j as { latitude?: unknown; longitude?: unknown };
  const la = nombre(latitude);
  const lo = nombre(longitude);
  return la === null || lo === null ? null : { latitude: la, longitude: lo };
}

function contour(v: unknown): Point[] | null {
  const j = json(v);
  if (!Array.isArray(j)) return null;
  const points: Point[] = [];
  for (const p of j as unknown[]) {
    const x = nombre((p as { x?: unknown } | null)?.x);
    const y = nombre((p as { y?: unknown } | null)?.y);
    if (x === null || y === null) return null;
    points.push({ x, y });
  }
  return points.length >= 3 ? points : null;
}

const estType = (v: unknown): v is TypeBatiment => (TYPES_BATIMENT as readonly unknown[]).includes(v);

export const requeteFerme = (fermeId: string): RequeteSurveillee<FermeLue | null> => ({
  sql: 'SELECT position, origine_plan FROM ferme WHERE id = ?',
  parametres: [fermeId],
  tables: ['ferme'],
  convertir: (l: Ligne) => ({ position: position(l.position), origine: position(l.origine_plan) }),
});

/** Rôle de l'utilisateur dans la ferme (une ligne par adhésion acceptée). */
export const requeteRoles = (fermeId: string, utilisateurId: string): RequeteSurveillee<string> => ({
  sql: "SELECT role FROM membre WHERE ferme_id = ? AND utilisateur_id = ? AND etat = 'accepte' AND supprime_le IS NULL",
  parametres: [fermeId, utilisateurId],
  tables: ['membre'],
  convertir: (l: Ligne) => texte(l.role) ?? '',
});

export const requeteBatiments = (fermeId: string): RequeteSurveillee<Batiment | null> => ({
  sql: 'SELECT id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id FROM batiment WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY id',
  parametres: [fermeId],
  tables: ['batiment'],
  convertir: (l: Ligne) => {
    const id = texte(l.id);
    const nom = texte(l.nom);
    const [longueurM, largeurM, hauteurM, x, y, o] = [l.longueur_m, l.largeur_m, l.hauteur_m, l.centre_x_m, l.centre_y_m, l.orientation_deg].map(nombre);
    if (id === null || nom === null || !estType(l.type) || longueurM == null || largeurM == null || hauteurM == null || x == null || y == null || o == null) return null;
    return { id, nom, type: l.type, centre: { x, y }, orientationDeg: o, longueurM, largeurM, hauteurM, zoneId: texte(l.zone_id), nouveau: false };
  },
});

export const requeteZones = (fermeId: string): RequeteSurveillee<Zone | null> => ({
  sql: 'SELECT id, nom, contour FROM zone WHERE ferme_id = ? AND supprime_le IS NULL ORDER BY nom, id',
  parametres: [fermeId],
  tables: ['zone'],
  convertir: (l: Ligne) => {
    const id = texte(l.id);
    return id === null ? null : { id, nom: texte(l.nom) ?? '', contour: contour(l.contour) };
  },
});

export const requetePlanches = (fermeId: string): RequeteSurveillee<Planche | null> => ({
  sql: "SELECT id, zone_id, code, longueur_m, largeur_m, placement_x_m, placement_y_m, orientation_deg FROM emplacement WHERE ferme_id = ? AND supprime_le IS NULL AND sorte = 'planche' AND placement_x_m IS NOT NULL ORDER BY id",
  parametres: [fermeId],
  tables: ['emplacement'],
  convertir: (l: Ligne) => {
    const id = texte(l.id);
    const zoneId = texte(l.zone_id);
    const [longueurM, largeurM, x, y, o] = [l.longueur_m, l.largeur_m, l.placement_x_m, l.placement_y_m, l.orientation_deg].map(nombre);
    if (id === null || zoneId === null || longueurM == null || largeurM == null || x == null || y == null || o == null) return null;
    return { id, zoneId, code: texte(l.code) ?? '', longueurM, largeurM, placement: { x, y, orientation_deg: o } };
  },
});

export interface Lectures {
  readonly ferme: FermeLue | null;
  readonly roles: readonly string[];
  readonly batiments: readonly Batiment[];
  readonly zones: readonly Zone[];
  readonly planches: readonly Planche[];
}

export const sansNull = <T,>(l: readonly (T | null)[]): T[] => l.filter((x): x is T => x !== null);

/** Relit tout d'un coup (après une écriture : l'affichage ne passe pas par un état intermédiaire). */
export async function lireTout(porte: PorteDonnees, fermeId: string, utilisateurId: string): Promise<Lectures> {
  const [rf, rr, rb, rz, rp] = await Promise.all([
    lireRequete(porte, requeteFerme(fermeId)),
    lireRequete(porte, requeteRoles(fermeId, utilisateurId)),
    lireRequete(porte, requeteBatiments(fermeId)),
    lireRequete(porte, requeteZones(fermeId)),
    lireRequete(porte, requetePlanches(fermeId)),
  ]);
  return { ferme: rf[0] ?? null, roles: rr, batiments: sansNull(rb), zones: sansNull(rz), planches: sansNull(rp) };
}

async function lireRequete<T>(porte: PorteDonnees, r: RequeteSurveillee<T>): Promise<T[]> {
  const lignes = await porte.lire<Ligne>(r.sql, r.parametres);
  return r.convertir === undefined ? (lignes as unknown as T[]) : lignes.map(r.convertir);
}


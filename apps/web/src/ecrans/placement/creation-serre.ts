/**
 * T89 : ce que le brouillon de l'éditeur garde des créations (zones, sous-zones, planches, grille des bâtiments), et leur cumul.
 * Séparé de la fiche (./serre-fiche.tsx) pour que la duplication (T90, ./duplication.tsx) l'utilise sans importer la fiche.
 */
import type { Zone } from './donnees.ts';

/** Une planche créée par la fiche (son placement est celui que le brouillon de l'éditeur garde). */
export interface PlancheCreee {
  readonly id: string;
  readonly zoneId: string;
  readonly code: string;
  readonly longueurM: number;
  readonly largeurM: number;
}

export interface GrilleCreee {
  /** Nulles pour une serre sans grille (T86), copiée par T90. */
  readonly nb_chapelles: number | null;
  readonly nb_troncons: number | null;
  readonly largeur_allee_m: number | null;
}

/** Les lignes que la fiche crée (une ou plusieurs serres avant « Enregistrer »), et la grille de chaque bâtiment créé. */
export interface CreationSerre {
  readonly grilles: Readonly<Record<string, GrilleCreee>>;
  /** Zones abritées (si elles sont nouvelles) et sous-zones créées. */
  readonly zones: readonly Zone[];
  readonly surfaces: Readonly<Record<string, number>>;
  readonly planches: readonly PlancheCreee[];
  /** Planches existantes rangées dans leur case : leur placement s'écrit avec la serre. */
  readonly reprises: readonly string[];
}

/** Une serre de plus au brouillon (une autre fiche avant « Enregistrer »). */
export function ajouterCreation(a: CreationSerre | null, b: CreationSerre): CreationSerre {
  if (a === null) return b;
  return { grilles: { ...a.grilles, ...b.grilles }, zones: [...a.zones, ...b.zones], surfaces: { ...a.surfaces, ...b.surfaces }, planches: [...a.planches, ...b.planches], reprises: [...a.reprises, ...b.reprises] };
}

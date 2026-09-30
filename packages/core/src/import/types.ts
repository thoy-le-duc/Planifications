/**
 * Types du moteur d'import (T14). Contrat détaillé : ./test/contrat.ts.
 */
// ── Lecture ──────────────────────────────────────────────────────────────────────────────────

/** Cellule lue : texte, nombre (classeur) ou vide. */
export type Cellule = string | number | null;
export type LigneBrute = readonly Cellule[];

/** Système des numéros de série Excel : 1900 (Windows) ou 1904 (anciens classeurs Mac). */
export type SystemeDates = 1900 | 1904;

export interface Feuille {
  readonly nom: string;
  readonly lignes: readonly LigneBrute[];
  /** Système de dates du classeur (`<workbookPr date1904>`), pour les numéros de série. */
  readonly systemeDates: SystemeDates;
}

export type ResultatClasseur =
  | { readonly ok: true; readonly feuilles: readonly Feuille[] }
  | { readonly ok: false; readonly code: 'classeur_illisible'; readonly message: string };

/** Lecteur de classeur (.xlsx) : chargé à part, hors du JavaScript de démarrage. */
export interface LecteurClasseur {
  lire(octets: Uint8Array): Promise<ResultatClasseur>;
}

export type Encodage = 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be';
export type Separateur = ';' | ',' | '\t';

export interface TexteDecode {
  readonly texte: string;
  readonly encodage: Encodage;
  readonly bom: boolean;
}

export interface CsvLu {
  readonly encodage: Encodage;
  readonly bom: boolean;
  readonly separateur: Separateur;
  readonly lignes: readonly (readonly string[])[];
  /** Fichier binaire (un .xlsx renommé, octets nuls) ou trop grand (plus de 5 000 000 de cases) : `lignes` vide. */
  readonly erreur: { readonly code: 'fichier_binaire' | 'fichier_trop_grand'; readonly message: string } | null;
}

// ── Champs et correspondance ─────────────────────────────────────────────────────────────────

export type TypeContenu = 'parcellaire' | 'cultures' | 'series' | 'assolement';

export type CleChamp =
  | 'zone'
  | 'sous_zone'
  | 'emplacement'
  | 'sorte'
  | 'longueur_m'
  | 'largeur_m'
  | 'type_abri'
  | 'surface_m2'
  | 'nombre_places'
  | 'espece'
  | 'variete'
  | 'famille'
  | 'mode'
  | 'duree_pepiniere_jours'
  | 'duree_avant_recolte_jours'
  | 'fenetre_recolte_jours'
  | 'rangs_par_planche'
  | 'ecartement_cm'
  | 'poids_mille_graines_g'
  | 'date_semis'
  | 'date_plantation'
  | 'date_debut_recolte'
  | 'date_fin_recolte'
  | 'nombre_plants'
  | 'annee';

export type UniteMesure = 'm' | 'cm' | 'kg' | 'g';
/** Unité lue dans un en-tête : une mesure, ou une conversion (hectares, semaines). */
export type UniteColonne = UniteMesure | 'ha' | 'semaine';

export interface DefinitionChamp {
  readonly cle: CleChamp;
  /** En français, pour l'écran de correspondance. */
  readonly libelle: string;
  readonly obligatoire: boolean;
}

export interface ColonneAssociee {
  readonly champ: CleChamp | null;
  readonly unite: UniteColonne | null;
}

export interface Correspondance {
  readonly type: TypeContenu;
  /** Une entrée par colonne du fichier, dans l'ordre. */
  readonly colonnes: readonly ColonneAssociee[];
}

// ── Normalisation ────────────────────────────────────────────────────────────────────────────

export type CodeErreurImport =
  | 'nombre_invalide'
  | 'unite_inconnue'
  | 'date_invalide'
  | 'annee_manquante'
  | 'champ_manquant'
  | 'valeur_inconnue'
  | 'hors_bornes'
  | 'dates_incoherentes'
  | 'colonnes_en_trop'
  | 'texte_trop_long'
  /** Correspondance qui associe le même champ à plusieurs colonnes. */
  | 'champ_en_double';

export type Lecture<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly code: CodeErreurImport };

export interface OptionsDate {
  /** 'JJ/MM/AAAA' (défaut) ou 'MM/JJ/AAAA'. */
  readonly ordre?: 'jj_mm' | 'mm_jj';
  /** Système des numéros de série Excel (défaut 1900). */
  readonly systemeDates?: SystemeDates;
}

// ── Valeurs ──────────────────────────────────────────────────────────────────────────────────

export interface Reference {
  readonly id: string;
  readonly nom: string;
  readonly synonymes?: readonly string[];
}

export interface PropositionValeur {
  readonly id: string;
  readonly nom: string;
  readonly score: number;
}

export interface Rapprochement {
  readonly exact: boolean;
  readonly propositions: readonly PropositionValeur[];
}

export type DecisionPrise = { readonly sorte: 'existante'; readonly id: string } | { readonly sorte: 'nouvelle'; readonly nom: string };

export type ReferenceImport = DecisionPrise | { readonly sorte: 'a_decider'; readonly valeur: string };

export type ChampReference = 'espece' | 'famille';

export interface ChoixValeur {
  readonly champ: ChampReference;
  readonly valeur: string;
  readonly decision: DecisionPrise;
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────

export interface Bibliotheque {
  readonly especes: readonly Reference[];
  readonly familles: readonly Reference[];
}

export interface EntreeImport {
  /** Toutes les lignes de la feuille, en-tête compris (et ce qui le précède). */
  readonly lignes: readonly LigneBrute[];
  readonly ligneEntete: number;
  readonly correspondance: Correspondance;
  readonly bibliotheque: Bibliotheque;
  /** Année de la saison, pour les dates en semaines et la plage des numéros de série. */
  readonly anneeSaison: number | null;
  readonly choix?: readonly ChoixValeur[];
  /** Système de dates de la feuille (classeur) ; défaut 1900. */
  readonly systemeDates?: SystemeDates;
}

export type ValeurImport = string | number | ReferenceImport | null;

export interface ErreurImport {
  readonly code: CodeErreurImport;
  readonly champ: CleChamp | null;
  readonly colonne: number | null;
  readonly message: string;
}

export type StatutLigne = 'valide' | 'erreur' | 'a_decider' | 'doublon';

export interface LignePlan {
  readonly ligne: number;
  readonly statut: StatutLigne;
  readonly valeurs: Readonly<Partial<Record<CleChamp, ValeurImport>>>;
  readonly erreurs: readonly ErreurImport[];
  readonly doublonDe: number | null;
}

export interface DecisionValeur {
  readonly champ: ChampReference;
  /** Valeur telle qu'écrite à sa première apparition (sans espaces autour). */
  readonly valeur: string;
  readonly lignes: readonly number[];
  readonly propositions: readonly PropositionValeur[];
}

/** Plage de lignes ignorées qui se suivent avec le même motif (`debut` ≤ `fin`, bornes comprises). */
export interface LigneIgnoree {
  readonly debut: number;
  readonly fin: number;
  readonly motif: 'vide' | 'total';
}

export interface PlanImport {
  readonly type: TypeContenu;
  readonly lignes: readonly LignePlan[];
  readonly ignorees: readonly LigneIgnoree[];
  readonly decisions: readonly DecisionValeur[];
  readonly niveaux: 1 | 2 | 3 | null;
  readonly resume: {
    readonly valides: number;
    readonly erreurs: number;
    readonly aDecider: number;
    readonly doublons: number;
    readonly ignorees: number;
  };
}

// ── Modèle d'import ──────────────────────────────────────────────────────────────────────────

export interface ColonneModele {
  readonly entete: string;
  readonly champ: CleChamp | null;
  readonly unite: UniteColonne | null;
}

export interface ModeleImport {
  readonly version: 1;
  readonly type: TypeContenu;
  /** Par en-tête du fichier (tel qu'écrit), le champ et l'unité validés. */
  readonly colonnes: readonly ColonneModele[];
  readonly choix: readonly ChoixValeur[];
}

/** Pourquoi `creerModele` refuse un modèle (codes stables). */
export type CodeRefusModele = 'champ_en_double' | 'champ_inconnu' | 'unite_refusee' | 'choix_invalide';

/** Résultat de `creerModele` : un modèle créé est toujours relisible par `lireModele`. */
export type ResultatModele =
  | { readonly ok: true; readonly modele: ModeleImport }
  | { readonly ok: false; readonly code: CodeRefusModele; readonly champ: CleChamp | null; readonly colonne: number | null; readonly message: string };

// ── Bibliothèque ─────────────────────────────────────────────────────────────────────────────

export interface FamilleParDefaut {
  readonly nom: string;
  readonly delaiRetourMinimalAns: number;
  readonly delaiRetourConseilleAns: number;
}

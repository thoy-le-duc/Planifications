/**
 * Types partagés par l'écran d'import (T14b), son moteur (./preparation.ts) et le Web Worker de
 * préparation : tout ce qui traverse `postMessage` est ici, en données simples (clonables).
 */
import type { CategorieEspece, ChoixValeur, Correspondance, LigneBrute, PropositionValeur, SystemeDates, TypeContenu, UniteRecolte } from '@planif/core';
import type { OrdreEcriture } from '@planif/sync';

// ── Ce que la base locale sait déjà (lu par la page, envoyé au moteur) ─────────────────────────

export interface ZoneConnue {
  readonly id: string;
  readonly nom: string;
  readonly parenteId: string | null;
}

export interface EmplacementConnu {
  readonly id: string;
  /** Zone où la planche est rangée, la plus basse (sous-zone s'il y en a une) : T14f. */
  readonly zoneId: string;
  readonly code: string;
  readonly sorte: string;
  readonly longueurM: number | null;
  readonly nombrePlaces: number | null;
}

export interface EspeceConnue {
  readonly id: string;
  readonly nom: string;
  readonly familleId: string | null;
}

export interface FamilleConnue {
  readonly id: string;
  readonly nom: string;
}

export interface VarieteConnue {
  readonly id: string;
  readonly especeId: string;
  readonly nom: string;
}

export interface ItineraireConnu {
  readonly id: string;
  readonly especeId: string;
  readonly varieteId: string | null;
  /** Itinéraire de la ferme (sinon de la bibliothèque commune). */
  readonly deLaFerme: boolean;
  readonly nom: string;
  readonly mode: string;
  /** Texte JSON de itineraire.parametres. */
  readonly parametres: string;
}

export interface SaisonConnue {
  readonly id: string;
  readonly nom: string;
  readonly debut: string;
  readonly fin: string;
}

/** Série active de la ferme : ce qui sert à reconnaître un doublon. */
export interface SerieConnue {
  readonly especeId: string;
  readonly miseEnPlace: string;
  /** Emplacements de ses occupations actives (vide : série sans emplacement). */
  readonly emplacementIds: readonly string[];
}

export interface AssolementConnu {
  readonly saisonId: string;
  readonly zoneId: string | null;
  readonly emplacementId: string | null;
  readonly familleId: string;
  readonly especeId: string | null;
}

export interface ContexteBase {
  readonly fermeId: string;
  readonly zones: readonly ZoneConnue[];
  readonly emplacements: readonly EmplacementConnu[];
  readonly especes: readonly EspeceConnue[];
  readonly familles: readonly FamilleConnue[];
  readonly varietes: readonly VarieteConnue[];
  readonly itineraires: readonly ItineraireConnu[];
  readonly saisons: readonly SaisonConnue[];
  readonly series: readonly SerieConnue[];
  readonly assolements: readonly AssolementConnu[];
}

// ── Lecture du fichier ─────────────────────────────────────────────────────────────────────────

export interface Analyse {
  readonly nomFichier: string;
  readonly format: 'csv' | 'xlsx';
  /** En-têtes, une par colonne (texte de la cellule, '' si vide). */
  readonly entetes: readonly string[];
  /** Indice (0) de la ligne d'en-tête. */
  readonly ligneEntete: number;
  readonly typePropose: TypeContenu | null;
  /** Lignes sous l'en-tête (vides comprises). */
  readonly lignesDonnees: number;
  /** Deux ou trois valeurs d'exemple par colonne. */
  readonly exemples: readonly (readonly string[])[];
}

export type ResultatLecture = { readonly ok: true; readonly analyse: Analyse } | { readonly ok: false; readonly message: string };

export interface FeuilleLue {
  readonly lignes: readonly LigneBrute[];
  readonly systemeDates: SystemeDates;
}

// ── Préparation ────────────────────────────────────────────────────────────────────────────────

export interface DemandePreparation {
  readonly correspondance: Correspondance;
  readonly anneeSaison: number | null;
  readonly choix: readonly ChoixValeur[];
  /** Parcellaire sans colonne de zone : la zone où ranger toutes les lignes. */
  readonly zoneParDefaut: string | null;
  readonly contexte: ContexteBase;
  /** Instant ISO de l'import (horodatages, identifiants). */
  readonly maintenant: string;
  readonly nomFichier: string;
  /** Cultures créées (« Créer » à l'étape 4), par valeur du fichier : ce que l'utilisateur a choisi. */
  readonly attributsEspeces: Readonly<Record<string, AttributsEspece>>;
  /** Valeurs distinctes (espèces + familles) au-delà desquelles on ne rapproche plus. */
  readonly plafondValeurs: number;
}

export interface AttributsEspece {
  readonly categorie: CategorieEspece;
  readonly perenne: 0 | 1;
  readonly uniteRecolte: UniteRecolte;
}

export interface DecisionAffichee {
  readonly champ: 'espece' | 'famille';
  readonly valeur: string;
  readonly lignes: number;
  readonly propositions: readonly PropositionValeur[];
  /** Culture à créer (choix « Créer » d'un modèle) dont il manque catégorie, pérenne ou unité. */
  readonly creer?: true;
}

export interface ErreurAffichee {
  readonly message: string;
  /** Cellule du fichier en cause (texte tel qu'écrit), null si l'erreur n'a pas de colonne. */
  readonly cellule: string | null;
}

export type StatutApercu = 'valide' | 'erreur' | 'doublon' | 'a_decider';

export interface LigneApercu {
  readonly ligne: number;
  readonly statut: StatutApercu;
  /** Ce que dit la ligne, en court (« Laitue · N1 · 2027-04-05 »). */
  readonly resume: string;
  readonly erreurs: readonly ErreurAffichee[];
  readonly avertissements: readonly string[];
  /** Doublon : d'une ligne de la base (null) ou du fichier (son numéro). */
  readonly doublonDe?: number | null;
}

/** Sortes de valeurs par défaut (relecture B1), data-defaut de l'encart. */
export type SorteDefaut = 'densite' | 'marge' | 'delais-famille' | 'abri' | 'longueur-serie' | 'variete-inconnue' | 'pepiniere' | 'duree-recolte';

export interface Apercu {
  readonly valides: number;
  readonly erreurs: number;
  readonly doublons: number;
  /** Lignes valides qui portent au moins un avertissement. */
  readonly avertissements: number;
  readonly ignorees: number;
  /** Lignes montrées : erreurs, doublons, avertissements (au plus 100 de chaque), puis quelques valides. */
  readonly lignes: readonly LigneApercu[];
  /** Écritures (une par ligne de la base) et lots d'envoi. */
  readonly ecritures: number;
  readonly lots: number;
  /** Valeurs écrites par défaut (le fichier ne les donne pas), par sorte : l'encart de l'aperçu. */
  readonly defauts: readonly { readonly sorte: SorteDefaut; readonly textes: readonly string[]; readonly nombre: number }[];
  /** Lignes créées par chaque lot d'envoi, « table:id », dans l'ordre d'écriture. */
  readonly lotsCreees: readonly (readonly string[])[];
  /** Lignes créées, par table : de quoi annuler l'import. */
  readonly creees: Readonly<Record<string, readonly string[]>>;
  /** T14e : dates que l'import déduit (pas lues dans le fichier), telles qu'elles seront écrites. */
  readonly datesDeduites: DatesDeduites;
}

/** T14e : `actif_du` des emplacements créés (par date, AAAA-MM-JJ) et bornes des saisons créées. */
export interface DatesDeduites {
  readonly actifsDu: readonly { readonly date: string; readonly emplacements: number }[];
  readonly saisons: readonly { readonly nom: string; readonly debut: string; readonly fin: string }[];
}

export type ResultatPreparation =
  | { readonly sorte: 'plafond'; readonly nombre: number }
  | { readonly sorte: 'decisions'; readonly decisions: readonly DecisionAffichee[] }
  | { readonly sorte: 'apercu'; readonly apercu: Apercu };

/** Ce que la page demande au moteur (dans le Worker, ou sur le fil principal sans Worker). */
export interface Preparateur {
  lireOctets(nomFichier: string, octets: Uint8Array): Promise<ResultatLecture>;
  lireFeuille(nomFichier: string, feuille: FeuilleLue): Promise<ResultatLecture>;
  preparer(demande: DemandePreparation): Promise<ResultatPreparation>;
  /** Ordres du lot `indice` de la dernière préparation (aperçu). */
  lot(indice: number): Promise<readonly OrdreEcriture[]>;
  fermer(): void;
}

// ── Messages du Worker ─────────────────────────────────────────────────────────────────────────

export type Requete =
  | { readonly n: number; readonly quoi: 'lireOctets'; readonly nomFichier: string; readonly octets: Uint8Array }
  | { readonly n: number; readonly quoi: 'lireFeuille'; readonly nomFichier: string; readonly feuille: FeuilleLue }
  | { readonly n: number; readonly quoi: 'preparer'; readonly demande: DemandePreparation }
  | { readonly n: number; readonly quoi: 'lot'; readonly indice: number };

export type Reponse = { readonly n: number; readonly ok: true; readonly valeur: unknown } | { readonly n: number; readonly ok: false; readonly message: string };

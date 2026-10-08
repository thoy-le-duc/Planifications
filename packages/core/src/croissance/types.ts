/**
 * Types de la croissance des cultures (T32a, Q32) : profil de croissance d'une espèce (jsonb
 * `espece.profil_croissance`, clés camelCase), état calculé à une date. La hauteur est une
 * ILLUSTRATION pour le jumeau numérique, pas une prévision de rendement ni de date de récolte.
 */
import type { DateCalendaire } from '../dates/index.ts';

/** Silhouette de la plante, pour la vue 3D (T32b). */
export type FormePlant = 'erige-tuteure' | 'rosette' | 'touffe' | 'rampant' | 'buisson' | 'arbre-ou-liane' | 'bulbe-ou-racine';
/** Allure de la courbe de hauteur : droite, ou en S (lente, rapide, lente). */
export type AllureCroissance = 'lineaire' | 'en-s';
/** Après la fin de récolte : hauteur conservée (tomate) ou baissée (feuillage qui retombe). */
export type FinDeCycle = 'conservee' | 'baissee';

/** Temps pour atteindre la hauteur maximale : en jours depuis la mise en place, ou en fraction du cycle. */
export type DureeCroissance = { readonly en: 'jours'; readonly jours: number } | { readonly en: 'fraction_cycle'; readonly fraction: number };

/** Cycle annuel d'une pérenne (Q32) : jours 'MM-JJ' du débourrement et du repos. */
export interface CycleAnnuel {
  /** 'MM-JJ' */
  readonly debourrement: string;
  /** 'MM-JJ' */
  readonly repos: string;
}

export interface ProfilCroissance {
  readonly forme: FormePlant;
  readonly hauteurMaxM: number;
  readonly duree: DureeCroissance;
  readonly allure: AllureCroissance;
  readonly finDeCycle: FinDeCycle;
  /** Pérennes seulement ; null pour une culture annuelle. */
  readonly cycleAnnuel: CycleAnnuel | null;
}

/** Profil par défaut d'une espèce de la bibliothèque commune. */
export interface ProfilParDefaut {
  readonly espece: string;
  readonly synonymes: readonly string[];
  readonly profil: ProfilCroissance;
  /** Référence, ou exactement MENTION_A_VERIFIER. */
  readonly source: string;
}

export type StadeCroissance =
  | 'aucun'
  | 'levee'
  | 'croissance'
  | 'pleine_production'
  | 'fin'
  | 'debourrement'
  | 'pleine_vegetation'
  | 'repos';

export interface EtatCroissance {
  readonly stade: StadeCroissance;
  readonly hauteurM: number;
  readonly fraction: number;
}

/** Une date repère d'une occupation : la réelle, si elle est remplie, remplace la prévue. */
export interface DateRepere {
  readonly prevue: DateCalendaire | null;
  readonly reelle: DateCalendaire | null;
}

export interface DatesCroissance {
  readonly miseEnPlace: DateRepere;
  readonly debutRecolte: DateRepere;
  readonly finRecolte: DateRepere;
  /** Jour où l'emplacement se libère : intervalle [mise en place, arrachage[. */
  readonly arrachage: DateRepere;
}

export interface EntreePerenne {
  readonly plantation: { readonly datePlantation: DateCalendaire; readonly dateArrachage: DateCalendaire | null };
  /** Campagne de l'année du jour demandé, ou null. */
  readonly campagne: { readonly annee: number; readonly debutRecolte: DateCalendaire | null; readonly finRecolte: DateCalendaire | null } | null;
}

export type CodeErreurCroissance =
  | 'trop_long'
  | 'entree_invalide'
  | 'champ_inconnu'
  | 'champ_manquant'
  | 'forme_inconnue'
  | 'hauteur_invalide'
  | 'duree_invalide'
  | 'allure_inconnue'
  | 'fin_de_cycle_inconnue'
  | 'cycle_annuel_invalide';

export interface ErreurCroissance {
  readonly code: CodeErreurCroissance;
  readonly champ: string | null;
  /** En français, 200 caractères au plus. */
  readonly message: string;
}

export type ResultatCroissance<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly erreur: ErreurCroissance };

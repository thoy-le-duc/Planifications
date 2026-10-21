/**
 * T59 (Q44) — contrat du déroulé de la saison dans la vue 3D : regarder la saison défiler, sans
 * toucher l'écran. Deux modules purs, testés sans navigateur :
 *
 * ── ./deroule.ts (morceau 3D, sans dépendance) ───────────────────────────────────────────────
 * La semaine affichée pendant la lecture se déduit du temps écoulé depuis le départ, en
 * millisecondes d'une horloge monotone (`performance.now()` dans la vue) : aucune `Date`, aucun
 * fuseau. Règles :
 *   - vitesse 1 (par défaut) ou 4 semaines par seconde : une semaine dure 1000 / vitesse ms ;
 *   - semaine = min(dernière, départ + ⌊(maintenant − départMs) / durée⌋) ; la lecture est finie
 *     quand la dernière semaine du plan est atteinte (arrêt en fin de saison) ;
 *   - démarrer sur la dernière semaine repart de la première ; un plan d'une semaine ou moins ne
 *     se lit pas (null) ; une semaine de départ hors bornes est ramenée dans le plan ;
 *   - changer de vitesse en cours de lecture garde la semaine affichée et repart de là ;
 *   - le pilote (`piloterLecture`) ne programme qu'un rappel par changement de semaine (pas de
 *     boucle à chaque image) et n'annonce une semaine (`surSemaine`) que si elle change : le calcul
 *     de croissance, fait par semaine affichée, ne se refait donc jamais deux fois pour la même.
 *   Exemple : départ semaine 10 d'un plan de 15 semaines (0 à 14), vitesse 1 : 11 à 1 s, 12 à 2 s,
 *   13 à 3 s, 14 à 4 s puis fin ; 4 changements de semaine. Vitesse 4 : 14 à 1 s.
 *
 * ── ./deroule-plants.ts (couche des plants, chargée à la demande) ────────────────────────────
 * Les plants de chaque planche pour la semaine affichée, selon l'option de dates :
 *   - « realise » (par défaut, règle de T32a) : la date réelle, si elle est remplie, remplace la
 *     prévue ; la culture de la planche est celle de la scène (barres du plan) ;
 *   - « prevu » (« Prévu seul ») : les dates réelles sont ignorées ; la culture d'une planche est,
 *     parmi ses occupations annuelles, celle dont la période prévue [mise en place, arrachage[
 *     couvre le plus de jours de la semaine [lundi, lundi + 7[ (à égalité, la première dans l'ordre
 *     du plan) ; une planche sans occupation annuelle garde celle de la scène (pérenne).
 *   Succession : arrachage (plus de plants), planche nue, puis la culture suivante en jeunes plants.
 */
import type { DateCalendaire } from '@planif/core';
import type { Plan } from '../../plan/calculs.ts';
import type { CulturesLues } from '../donnees-plants.ts';
import type { PlantsPlanche } from '../plants.ts';
import type { Scene } from '../scene.ts';

export type VitesseDeroule = 1 | 4;

export interface LectureDeroule {
  readonly semaineDepart: number;
  /** Indice de la dernière semaine du plan. */
  readonly derniere: number;
  readonly departMs: number;
  readonly vitesse: VitesseDeroule;
}

export interface PositionLecture {
  readonly semaine: number;
  readonly finie: boolean;
}

/** Horloge injectée : temps monotone (ms) et minuterie ; `programmer` rend de quoi annuler. */
export interface HorlogeDeroule {
  maintenant(): number;
  programmer(rappel: () => void, delaiMs: number): () => void;
}

export interface PiloteDeroule {
  /** Pause : plus aucun rappel, plus aucune semaine annoncée. */
  arreter(): void;
  changerVitesse(vitesse: VitesseDeroule): void;
}

export interface OptionsPilote {
  readonly horloge: HorlogeDeroule;
  readonly semaine: number;
  readonly nbSemaines: number;
  readonly vitesse: VitesseDeroule;
  /** La semaine affichée change (jamais deux fois la même d'affilée). */
  readonly surSemaine: (semaine: number) => void;
  /** Fin de saison atteinte : la lecture s'arrête d'elle-même. */
  readonly surFin: () => void;
}

export interface ModuleDeroule {
  readonly VITESSES_DEROULE: readonly VitesseDeroule[];
  readonly VITESSE_DEROULE_PAR_DEFAUT: VitesseDeroule;
  demarrerLecture(semaine: number, nbSemaines: number, maintenantMs: number, vitesse: VitesseDeroule): LectureDeroule | null;
  semaineDeLecture(lecture: LectureDeroule, maintenantMs: number): PositionLecture;
  /** Délai (ms, ≥ 0) avant le prochain changement de semaine ; null quand la lecture est finie. */
  delaiAvantSemaineSuivante(lecture: LectureDeroule, maintenantMs: number): number | null;
  changerVitesseLecture(lecture: LectureDeroule, vitesse: VitesseDeroule, maintenantMs: number): LectureDeroule;
  /** Lance la lecture ; null quand le plan ne se lit pas (une semaine ou moins). */
  piloterLecture(options: OptionsPilote): PiloteDeroule | null;
}

export type ModeDates = 'realise' | 'prevu';

export interface EntreePlantsSemaine {
  readonly scene: Scene;
  /** Occupations de chaque planche, dans l'ordre du plan (`occupationsParPlanche`). */
  readonly occupations: ReadonlyMap<string, readonly string[]>;
  readonly cultures: CulturesLues;
  /** Lundi de la semaine affichée. */
  readonly jour: DateCalendaire;
  readonly mode: ModeDates;
}

export interface ModuleDeroulePlants {
  readonly MODE_DATES_PAR_DEFAUT: ModeDates;
  occupationsParPlanche(plan: Plan): ReadonlyMap<string, readonly string[]>;
  /** Un élément par volume de la scène, dans le même ordre ; nul quand la planche est nue. */
  plantsDeLaSemaine(entree: EntreePlantsSemaine): readonly (PlantsPlanche | null)[];
}

/** Ce que l'e2e lit sur la vue 3D (data-testid et attributs), en plus de TESTID_3D. */
export const TESTID_DEROULE = {
  /** Bouton « Lecture » / « Pause » à côté du curseur ; `aria-pressed` vrai pendant la lecture. */
  lecture: 'lecture-3d',
  /** <select> de la vitesse : valeurs '1' (défaut) et '4' (semaines par seconde). */
  vitesse: 'vitesse-3d',
  /** Case « Prévu seul » (décochée par défaut : les dates réelles remplacent les prévues). */
  prevuSeul: 'prevu-seul-3d',
} as const;

/**
 * Attributs de la vue (`vue-3d`) :
 *   data-lecture        'lecture' | 'pause' ;
 *   data-calculs-plants nombre de calculs des plants depuis l'ouverture (un par semaine affichée
 *                       au plus, plus un par changement d'option ou de données).
 */
export const ATTRIBUTS_DEROULE = { lecture: 'data-lecture', calculsPlants: 'data-calculs-plants' } as const;

/**
 * Marque de performance posée quand la lecture annonce une nouvelle semaine (detail = { semaine }) ;
 * l'image de cette semaine est marquée ensuite par MARQUES_3D.semaine (même detail). L'écart entre
 * les deux est le temps de l'image d'un changement de semaine pendant la lecture.
 */
export const MARQUE_LECTURE = 'planif:vue-3d-lecture-semaine';

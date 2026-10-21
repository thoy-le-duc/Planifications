/**
 * Vue 3D (T59, Q44) — dérouler la saison : la semaine affichée pendant la lecture. Module PUR, sans
 * dépendance : le temps est un argument (ms d'une horloge monotone, `performance.now()` dans la vue),
 * jamais une `Date` ni un fuseau. Contrat et exemples chiffrés : ./test/contrat-deroule.ts.
 *
 * Le pilote ne programme qu'un rappel par changement de semaine (aucune boucle à chaque image) et
 * n'annonce une semaine que si elle change : la vue ne recalcule la scène et les plants qu'une fois
 * par semaine affichée.
 */

export type VitesseDeroule = 1 | 4;

/** Vitesses offertes, en semaines par seconde. */
export const VITESSES_DEROULE: readonly VitesseDeroule[] = [1, 4];
export const VITESSE_DEROULE_PAR_DEFAUT: VitesseDeroule = 1;

/** Marque posée quand la lecture annonce une semaine (detail = { semaine }), lue par l'e2e de fluidité. */
export const MARQUE_LECTURE = 'planif:vue-3d-lecture-semaine';

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

const dureeSemaineMs = (vitesse: VitesseDeroule): number => 1000 / vitesse;

/** Semaines écoulées depuis le départ (≥ 0, entier). */
const ecoulees = (l: LectureDeroule, maintenantMs: number): number => Math.max(0, Math.floor((maintenantMs - l.departMs) / dureeSemaineMs(l.vitesse)));

/** Lance une lecture depuis `semaine` ; sur la dernière semaine, repart de la première. Null : une semaine ou moins. */
export function demarrerLecture(semaine: number, nbSemaines: number, maintenantMs: number, vitesse: VitesseDeroule): LectureDeroule | null {
  if (!Number.isFinite(nbSemaines) || nbSemaines < 2) return null;
  const derniere = Math.floor(nbSemaines) - 1;
  const bornee = Number.isFinite(semaine) ? Math.min(derniere, Math.max(0, Math.floor(semaine))) : 0;
  return { semaineDepart: bornee >= derniere ? 0 : bornee, derniere, departMs: maintenantMs, vitesse };
}

export function semaineDeLecture(l: LectureDeroule, maintenantMs: number): PositionLecture {
  const semaine = Math.min(l.derniere, l.semaineDepart + ecoulees(l, maintenantMs));
  return { semaine, finie: semaine >= l.derniere };
}

/** Délai (ms, ≥ 0) avant le prochain changement de semaine ; null quand la lecture est finie. */
export function delaiAvantSemaineSuivante(l: LectureDeroule, maintenantMs: number): number | null {
  if (semaineDeLecture(l, maintenantMs).finie) return null;
  const duree = dureeSemaineMs(l.vitesse);
  return Math.max(0, l.departMs + (ecoulees(l, maintenantMs) + 1) * duree - maintenantMs);
}

/** Nouvelle vitesse : la semaine affichée est gardée et la lecture repart de là. */
export function changerVitesseLecture(l: LectureDeroule, vitesse: VitesseDeroule, maintenantMs: number): LectureDeroule {
  return { ...l, semaineDepart: semaineDeLecture(l, maintenantMs).semaine, departMs: maintenantMs, vitesse };
}

/** Au-delà de ce retard (ms) sur l'échéance d'une semaine, la lecture saute à la semaine du moment (onglet en arrière-plan). */
export const RETARD_RATTRAPE_MAX_MS = 1000;
/** En retard de moins que cela, les semaines manquées passent une à une, à cet intervalle (ms) : chacune a le temps d'être dessinée. */
export const DELAI_RATTRAPAGE_MS = 60;

/** Retard (ms) sur l'échéance de la semaine `semaine` de la lecture. */
const retardMs = (l: LectureDeroule, semaine: number, maintenantMs: number): number => maintenantMs - (l.departMs + (semaine - l.semaineDepart) * dureeSemaineMs(l.vitesse));

/** Horloge injectée : temps monotone (ms) et minuterie ; `programmer` rend de quoi annuler. */
export interface HorlogeDeroule {
  maintenant(): number;
  programmer(rappel: () => void, delaiMs: number): () => void;
}

export interface PiloteDeroule {
  arreter(): void;
  changerVitesse(vitesse: VitesseDeroule): void;
}

export interface OptionsPilote {
  readonly horloge: HorlogeDeroule;
  readonly semaine: number;
  readonly nbSemaines: number;
  readonly vitesse: VitesseDeroule;
  readonly surSemaine: (semaine: number) => void;
  readonly surFin: () => void;
}

/** Lance la lecture : un rappel par changement de semaine, `surFin` une fois la dernière atteinte. */
export function piloterLecture(o: OptionsPilote): PiloteDeroule | null {
  const { horloge } = o;
  let lecture = demarrerLecture(o.semaine, o.nbSemaines, horloge.maintenant(), o.vitesse);
  if (lecture === null) return null;
  let annoncee = lecture.semaineDepart;
  let annuler: (() => void) | null = null;
  let active = true;

  const arreter = (): void => {
    active = false;
    annuler?.();
    annuler = null;
  };
  const programmer = (): void => {
    if (!active || lecture === null) return;
    const delai = delaiAvantSemaineSuivante(lecture, horloge.maintenant());
    if (delai === null) return;
    annuler = horloge.programmer(tic, delai);
  };
  function tic(): void {
    annuler = null;
    if (!active || lecture === null) return;
    const maintenant = horloge.maintenant();
    const { semaine, finie } = semaineDeLecture(lecture, maintenant);
    // Léger retard (fil occupé un instant) : une semaine à la fois, rattrapée vite ; aucune ne saute.
    // Gros retard (onglet en arrière-plan) : droit à la semaine du moment.
    const suivante = semaine > annoncee + 1 && retardMs(lecture, annoncee + 1, maintenant) < RETARD_RATTRAPE_MAX_MS ? annoncee + 1 : semaine;
    if (suivante !== annoncee) {
      annoncee = suivante;
      o.surSemaine(suivante);
    }
    if (suivante >= lecture.derniere || (finie && suivante === semaine)) {
      arreter();
      o.surFin();
      return;
    }
    if (suivante < semaine) {
      annuler = horloge.programmer(tic, DELAI_RATTRAPAGE_MS);
      return;
    }
    programmer();
  }

  // Départ sur la dernière semaine : la lecture repart de la première, annoncée tout de suite.
  if (lecture.semaineDepart !== Math.floor(o.semaine)) o.surSemaine(annoncee);
  programmer();
  return {
    arreter,
    changerVitesse(vitesse: VitesseDeroule): void {
      if (!active || lecture === null) return;
      annuler?.();
      annuler = null;
      lecture = changerVitesseLecture(lecture, vitesse, horloge.maintenant());
      annoncee = lecture.semaineDepart;
      programmer();
    },
  };
}

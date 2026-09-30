/**
 * Journée déjà calculée, par porte, ferme et jour (T13). Rouvrir l'onglet « Aujourd'hui » dessine
 * tout de suite la dernière journée connue (budget de 300 ms au tap), puis la relit : la base a
 * pu changer pendant que l'écran était fermé (synchro).
 *
 * Tant qu'un écran est ouvert, la journée est relue à chaque changement des tables lues (saisie
 * locale ou synchro) : une lecture à la fois, et un changement arrivé pendant une lecture en
 * relance une après elle (la dernière voit le dernier changement).
 */
import type { PorteDonnees } from '@planif/sync';
import { calculerJournee, lireJournee, TABLES_AUJOURDHUI, type Journee, type LignesJournee } from './calculs.ts';

interface Suivi {
  /** Dernières lignes lues ; la journée n'en est calculée que pour un écran qui la montre. */
  lignes: LignesJournee | null;
  journee: Journee | null;
  enCours: Promise<LignesJournee> | null;
  sale: boolean;
  readonly abonnes: Set<(j: Journee) => void>;
  arreter: (() => void) | null;
}

/** Préparation abandonnée : aucun écran ne l'attendait plus. */
class LectureAbandonnee extends Error {}

const suivis = new WeakMap<PorteDonnees, Map<string, Suivi>>();

function suiviDe(porte: PorteDonnees, fermeId: string, jour: string): Suivi {
  let parCle = suivis.get(porte);
  if (parCle === undefined) {
    parCle = new Map();
    suivis.set(porte, parCle);
  }
  const cle = `${fermeId}|${jour}`;
  let s = parCle.get(cle);
  if (s === undefined) {
    s = { lignes: null, journee: null, enCours: null, sale: false, abonnes: new Set(), arreter: null };
    parCle.set(cle, s);
  }
  return s;
}

/** Journée des dernières lignes lues, calculée à la première demande. */
function journeeDe(s: Suivi, jour: string): Journee | null {
  if (s.journee === null && s.lignes !== null) s.journee = calculerJournee(s.lignes, jour);
  return s.journee;
}

/**
 * Lit la journée ; une lecture à la fois, relancée si la base a changé pendant. Sans écran
 * ouvert (préparation, ou l'utilisateur est passé à un autre onglet), les lignes sont gardées
 * sans calcul : aucun travail sur la page pendant qu'un autre écran défile.
 */
function relire(porte: PorteDonnees, fermeId: string, jour: string, s: Suivi, apres?: Promise<unknown>): Promise<LignesJournee> {
  const differee = apres !== undefined;
  if (s.enCours !== null) {
    s.sale = true;
    return s.enCours;
  }
  s.sale = false;
  const lecture = (apres ?? Promise.resolve())
    .catch(() => undefined)
    // Préparation dont l'écran a été quitté avant son tour : rien à lire pour personne (la base
    // sert l'écran affiché) ; le prochain affichage lira.
    .then(() => (differee && s.abonnes.size === 0 ? Promise.reject(new LectureAbandonnee()) : lireJournee(porte, fermeId, jour, new Date())));
  s.enCours = lecture;
  lecture.then(
    (lignes) => {
      s.enCours = null;
      s.lignes = lignes;
      s.journee = null;
      if (s.abonnes.size > 0) {
        const j = journeeDe(s, jour);
        if (j !== null) for (const rappel of [...s.abonnes]) rappel(j);
      }
      if (s.sale && s.abonnes.size > 0) void relire(porte, fermeId, jour, s).catch(() => undefined);
    },
    (erreur: unknown) => {
      s.enCours = null;
      if (!(erreur instanceof LectureAbandonnee)) console.error('Journée illisible', erreur);
    },
  );
  return lecture;
}

/** Dernière journée connue pour ce jour (calculée au besoin), ou null. */
export function journeeEnCache(porte: PorteDonnees, fermeId: string, jour: string): Journee | null {
  return journeeDe(suiviDe(porte, fermeId, jour), jour);
}

/**
 * Suit la journée : `rappel` à chaque journée relue (tout de suite une relecture, puis à chaque
 * changement des tables lues). `surEchec` si la première lecture échoue. Rend le désabonnement.
 */
export function suivreJournee(
  porte: PorteDonnees,
  fermeId: string,
  jour: string,
  rappel: (j: Journee) => void,
  surEchec: (erreur: unknown) => void,
): () => void {
  const s = suiviDe(porte, fermeId, jour);
  s.abonnes.add(rappel);
  if (s.arreter === null) {
    // Le premier appel (immédiat) lance la lecture, ou attend celle qui est déjà en cours (rien
    // n'a changé) ; chaque changement ensuite en relance une.
    let premier = true;
    s.arreter = porte.surveiller({ sql: 'SELECT 1 AS temoin', tables: TABLES_AUJOURDHUI }, () => {
      const enCours = premier ? s.enCours : null;
      premier = false;
      (enCours ?? relire(porte, fermeId, jour, s)).catch(surEchec);
    });
  } else {
    relire(porte, fermeId, jour, s).catch(surEchec);
  }
  return () => {
    s.abonnes.delete(rappel);
    if (s.abonnes.size === 0 && s.arreter !== null) {
      s.arreter();
      s.arreter = null;
    }
  };
}

/**
 * Prépare la journée (base ouverte, avant l’affichage) : lue une fois (calculée à l’affichage), après
 * `apres` (le début du plan, préparé d'abord : la base ne sert qu'une requête à la fois, et la
 * journée d'une grande ferme ne doit pas retarder le tap sur « Planches »). L'écran ouvert entre
 * temps attend cette lecture au lieu d'en lancer une autre.
 */
export async function prechargerJournee(porte: PorteDonnees, fermeId: string, jour: string, apres: Promise<unknown>): Promise<void> {
  const s = suiviDe(porte, fermeId, jour);
  if (s.lignes === null) await relire(porte, fermeId, jour, s, apres).catch((e: unknown) => {
    if (!(e instanceof LectureAbandonnee)) throw e;
  });
}

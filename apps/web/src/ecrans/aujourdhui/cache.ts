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
import { calculerJournee, lireJournee, TABLES_AUJOURDHUI, type Journee } from './calculs.ts';

interface Suivi {
  journee: Journee | null;
  enCours: Promise<Journee> | null;
  sale: boolean;
  readonly abonnes: Set<(j: Journee) => void>;
  arreter: (() => void) | null;
}

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
    s = { journee: null, enCours: null, sale: false, abonnes: new Set(), arreter: null };
    parCle.set(cle, s);
  }
  return s;
}

/** Lit et calcule la journée ; une lecture à la fois, relancée si la base a changé pendant. */
function relire(porte: PorteDonnees, fermeId: string, jour: string, s: Suivi): Promise<Journee> {
  if (s.enCours !== null) {
    s.sale = true;
    return s.enCours;
  }
  s.sale = false;
  const lecture = lireJournee(porte, fermeId, jour, new Date()).then((lignes) => calculerJournee(lignes, jour, new Date()));
  s.enCours = lecture;
  lecture.then(
    (j) => {
      s.enCours = null;
      s.journee = j;
      for (const rappel of [...s.abonnes]) rappel(j);
      if (s.sale && s.abonnes.size > 0) void relire(porte, fermeId, jour, s).catch(() => undefined);
    },
    (erreur: unknown) => {
      s.enCours = null;
      console.error('Journée illisible', erreur);
    },
  );
  return lecture;
}

/** Dernière journée calculée pour ce jour, ou null. */
export function journeeEnCache(porte: PorteDonnees, fermeId: string, jour: string): Journee | null {
  return suiviDe(porte, fermeId, jour).journee;
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
    // Le premier appel (immédiat) lance la lecture ; chaque changement ensuite en relance une.
    s.arreter = porte.surveiller({ sql: 'SELECT 1 AS temoin', tables: TABLES_AUJOURDHUI }, () => {
      relire(porte, fermeId, jour, s).catch(surEchec);
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

/** Prépare la journée (base ouverte, avant l'affichage) : lue et calculée une fois. */
export async function prechargerJournee(porte: PorteDonnees, fermeId: string, jour: string): Promise<void> {
  const s = suiviDe(porte, fermeId, jour);
  if (s.journee === null) await relire(porte, fermeId, jour, s);
}

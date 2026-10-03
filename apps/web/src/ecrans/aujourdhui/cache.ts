/**
 * Journée déjà calculée, par porte, ferme et jour (T13). Rouvrir l'onglet « Aujourd'hui » dessine
 * tout de suite la dernière journée connue (budget de 300 ms au tap), puis la relit : la base a
 * pu changer pendant que l'écran était fermé (synchro).
 *
 * Tant qu'un écran est ouvert, la journée est relue à chaque changement des tables lues (saisie
 * locale ou synchro) : une lecture à la fois, et un changement arrivé pendant une lecture en
 * relance une après elle (la dernière voit le dernier changement).
 *
 * T13c, relecture incrémentale : une saisie de l'écran (`annoncerSaisie`, appelé par
 * ./ecritures.ts avant d'écrire) dit quelle culture elle touche. Le changement qui suit ne relit
 * alors que le journal de cette culture (`lireCultures`) et recalcule la journée en reprenant le
 * reste (`recalculerCultures`) : même résultat qu'une relecture complète, en quelques requêtes.
 * Tout autre changement (synchro, saisie d'ailleurs) relit tout. Filet : une synchro arrivée dans
 * le même avis de changement qu'une saisie passerait inaperçue ; une relecture complète suit donc
 * toute relecture incrémentale, au calme (`VERIFICATION_MS` sans saisie), et cède la place à la
 * moindre saisie.
 *
 * T13f : les tâches marquées faites (masques) sont gardées ici, par porte et ferme (pas par jour :
 * la clé d'une tâche ne dépend pas du jour, les numéros viennent d'une seule horloge) : un écran
 * quitté puis rouvert avant la relecture, même le lendemain, les retrouve (un second « Fait »
 * n'écrit rien). Une relecture incrémentale ne porte son numéro que pour les cultures relues.
 */
import type { PorteDonnees } from '@planif/sync';
import {
  calculerEtat,
  LectureAbandonnee,
  lireCultures,
  lireJournee,
  recalculerCultures,
  TABLES_AUJOURDHUI,
  type Culture,
  type EtatJournee,
  type Journee,
  type LignesJournee,
} from './calculs.ts';

/** Délai sans saisie après lequel une relecture complète vérifie les relectures incrémentales. */
export const VERIFICATION_MS = 4_000;

/**
 * T13e : horloge des lectures. Chaque lecture prend un numéro quand elle commence ; la journée
 * qu'elle produit le porte (`lectureDe`). Une écriture de l'écran prend le sien en finissant
 * (`marquerEcriture`) : une journée dont la lecture est plus ancienne n'a pas pu voir l'écriture.
 */
let horloge = 0;

/**
 * Numéros de lecture d'une journée : celui de sa dernière lecture complète, et, culture par culture
 * (id de série ou de campagne), celui de la dernière relecture incrémentale qui l'a relue (T13f).
 */
interface Numeros {
  readonly complete: number;
  readonly cultures: ReadonlyMap<string, number>;
}
const lectures = new WeakMap<Journee, Numeros>();

/** Numéro pris à la fin d'une écriture de l'écran. */
export function marquerEcriture(): number {
  return ++horloge;
}

/**
 * Numéro de la dernière lecture de `journee` qui a lu la culture `cibleId` (0 : inconnu, tenu pour
 * ancien). Une relecture incrémentale d'une autre culture ne compte pas : elle n'a pas relu celle-ci.
 */
export function lectureDe(journee: Journee | null, cibleId: string): number {
  const n = journee === null ? undefined : lectures.get(journee);
  return n === undefined ? 0 : (n.cultures.get(cibleId) ?? n.complete);
}

/**
 * Masque d'une tâche marquée faite : 'attente' pendant l'écriture, puis le numéro pris à la fin de
 * l'écriture. Il tient tant que la journée affichée n'a pas relu la culture de la tâche depuis.
 */
export type Masque = number | 'attente';
export type Masques = ReadonlyMap<string, Masque>;

/** La tâche `cle` (préfixée par l'id de sa culture, calculs.ts) est-elle masquée sur `journee` ? */
export function estMasquee(masques: Masques, journee: Journee | null, cle: string): boolean {
  const m = masques.get(cle);
  return m !== undefined && (m === 'attente' || lectureDe(journee, cle.split(':')[0] ?? '') < m);
}

/** Ce que la prochaine relecture doit relire : tout, ou le journal de quelques cultures. */
type ARelire =
  | { readonly sorte: 'tout' }
  | {
      readonly sorte: 'cultures';
      readonly series: Set<string>;
      readonly campagnes: Set<string>;
      /** Une saisie en remplace une autre : les chaînes du journal sont à relire. */
      chaines: boolean;
    };

/** Saisie annoncée par l'écran, pas encore vue par un changement de la base. */
interface Annonce {
  readonly cible: Culture['cible'];
  readonly remplace: boolean;
}

interface Suivi {
  readonly fermeId: string;
  readonly jour: string;
  /** Dernières lignes lues en entier ; la journée n'en est calculée que pour un écran qui la montre. */
  lignes: LignesJournee | null;
  /** Numéro de la lecture qui a produit `lignes`. */
  numeroLignes: number;
  /** Journée calculée, et de quoi la recalculer culture par culture. */
  etat: EtatJournee | null;
  enCours: Promise<unknown> | null;
  /** La lecture en cours est une vérification : elle cède la place à toute relecture demandée. */
  verificationEnCours: boolean;
  sale: boolean;
  aRelire: ARelire | null;
  annonces: Annonce[];
  verification: ReturnType<typeof setTimeout> | null;
  /** Un écran a montré la journée puis l'a quittée : une préparation en cours s'arrête. */
  quittee: boolean;
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
    s = {
      fermeId,
      jour,
      lignes: null,
      numeroLignes: 0,
      etat: null,
      enCours: null,
      verificationEnCours: false,
      sale: false,
      aRelire: null,
      annonces: [],
      verification: null,
      quittee: false,
      abonnes: new Set(),
      arreter: null,
    };
    parCle.set(cle, s);
  }
  return s;
}

/** Journée des dernières lignes lues, calculée à la première demande. */
function journeeDe(s: Suivi): Journee | null {
  if (s.etat === null && s.lignes !== null) {
    s.etat = calculerEtat(s.lignes, s.jour);
    s.lignes = null;
    lectures.set(s.etat.journee, { complete: s.numeroLignes, cultures: new Map() });
  }
  return s.etat?.journee ?? null;
}

function arreterVerification(s: Suivi): void {
  if (s.verification !== null) clearTimeout(s.verification);
  s.verification = null;
}

/** Ajoute `besoin` à ce que la prochaine relecture doit relire. */
function demander(s: Suivi, besoin: ARelire): void {
  const a = s.aRelire;
  if (besoin.sorte === 'tout' || a?.sorte === 'tout') s.aRelire = { sorte: 'tout' };
  else if (a === null) s.aRelire = besoin;
  else {
    for (const id of besoin.series) a.series.add(id);
    for (const id of besoin.campagnes) a.campagnes.add(id);
    a.chaines ||= besoin.chaines;
  }
}

/** Un changement des tables lues : les saisies annoncées seules sont relues, sinon tout. */
function noterChangement(s: Suivi): void {
  const annonces = s.annonces;
  s.annonces = [];
  if (annonces.length === 0) {
    demander(s, { sorte: 'tout' });
    return;
  }
  const besoin: ARelire = { sorte: 'cultures', series: new Set(), campagnes: new Set(), chaines: false };
  for (const a of annonces) {
    if (a.cible.sorte === 'serie') besoin.series.add(a.cible.serieId);
    else besoin.campagnes.add(a.cible.campagneId);
    besoin.chaines ||= a.remplace;
  }
  demander(s, besoin);
}

/** Remet la journée relue aux écrans ouverts (sans écran, elle n'est pas calculée). */
function remettre(s: Suivi): void {
  if (s.abonnes.size === 0) return;
  const j = journeeDe(s);
  if (j !== null) for (const rappel of [...s.abonnes]) rappel(j);
}

/**
 * Relit la journée (ce que demande `s.aRelire`, tout par défaut) ; une lecture à la fois,
 * relancée si la base a changé pendant. Sans écran ouvert (préparation, ou l'utilisateur est
 * passé à un autre onglet), les lignes sont gardées sans calcul : aucun travail sur la page
 * pendant qu'un autre écran défile.
 */
function relire(porte: PorteDonnees, s: Suivi, options: { readonly apres?: Promise<unknown>; readonly verification?: boolean; readonly preparation?: boolean } = {}): Promise<unknown> {
  if (s.enCours !== null) {
    s.sale = true;
    return s.enCours;
  }
  s.sale = false;
  arreterVerification(s);
  const besoin = s.aRelire ?? { sorte: 'tout' };
  s.aRelire = null;
  const verification = options.verification === true;
  s.verificationEnCours = verification;
  // Écran quitté (avant le tour de la préparation, ou pendant la lecture) : la lecture s'arrête
  // et laisse la base à l'écran affiché ; le prochain affichage relira. Une vérification s'arrête
  // aussi dès qu'une autre relecture est demandée (une saisie n'attend pas derrière elle).
  const continuer = () => (s.abonnes.size > 0 || (options.preparation === true && !s.quittee)) && !(verification && s.aRelire !== null);
  const etat = s.etat;
  let lecture: Promise<unknown>;
  if (besoin.sorte === 'cultures' && etat !== null && s.abonnes.size > 0) {
    const cultures = { series: [...besoin.series], campagnes: [...besoin.campagnes] };
    const numero = ++horloge;
    lecture = lireCultures(porte, etat.contexte, cultures, besoin.chaines, new Date(), continuer).then((lues) => {
      const suivant = recalculerCultures(etat, lues);
      if (suivant === null) {
        // Pas sûr (voir recalculerCultures) : tout relire, juste après.
        demander(s, { sorte: 'tout' });
        return;
      }
      s.etat = suivant;
      // Numéroter seulement les cultures relues : les autres gardent le numéro de leur lecture.
      const avant = lectures.get(etat.journee);
      const parCulture = new Map(avant?.cultures);
      for (const id of [...cultures.series, ...cultures.campagnes]) parCulture.set(id, numero);
      lectures.set(suivant.journee, { complete: avant?.complete ?? 0, cultures: parCulture });
      remettre(s);
      s.verification = setTimeout(() => {
        s.verification = null;
        if (s.abonnes.size === 0) return;
        demander(s, { sorte: 'tout' });
        relire(porte, s, { verification: true }).catch(() => undefined);
      }, VERIFICATION_MS);
    });
  } else {
    // Une lecture complète voit toutes les saisies écrites avant elle : leurs annonces tombent
    // (au pire, le changement d'une saisie en cours d'écriture fera tout relire).
    s.annonces = [];
    let numero = 0;
    lecture = (options.apres ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        numero = ++horloge;
        return lireJournee(porte, s.fermeId, s.jour, new Date(), continuer);
      })
      .then((lignes) => {
        s.lignes = lignes;
        s.numeroLignes = numero;
        s.etat = null;
        remettre(s);
      });
  }
  s.enCours = lecture;
  const fin = () => {
    s.enCours = null;
    s.verificationEnCours = false;
    if ((s.sale || s.aRelire !== null) && s.abonnes.size > 0) {
      if (s.aRelire === null) demander(s, { sorte: 'tout' });
      relire(porte, s).catch(() => undefined);
    }
  };
  lecture.then(fin, (erreur: unknown) => {
    if (erreur instanceof LectureAbandonnee) {
      // Un écran revenu entre temps attendait peut-être cette lecture : il en aura une autre.
      if (s.abonnes.size > 0 && s.aRelire === null) s.sale = true;
    } else {
      console.error('Journée illisible', erreur);
      // Une relecture incrémentale en échec : tout relire.
      if (besoin.sorte === 'cultures') demander(s, { sorte: 'tout' });
    }
    fin();
  });
  return lecture;
}

/** Dernière journée connue pour ce jour (calculée au besoin), ou null. */
export function journeeEnCache(porte: PorteDonnees, fermeId: string, jour: string): Journee | null {
  return journeeDe(suiviDe(porte, fermeId, jour));
}

/** Masques d'une ferme (remplacés à chaque changement), et les écrans qui les suivent. */
interface MasquesFerme {
  masques: Masques;
  readonly abonnes: Set<() => void>;
}

const masquesParPorte = new WeakMap<PorteDonnees, Map<string, MasquesFerme>>();

function masquesFerme(porte: PorteDonnees, fermeId: string): MasquesFerme {
  let parFerme = masquesParPorte.get(porte);
  if (parFerme === undefined) {
    parFerme = new Map();
    masquesParPorte.set(porte, parFerme);
  }
  let m = parFerme.get(fermeId);
  if (m === undefined) {
    m = { masques: new Map(), abonnes: new Set() };
    parFerme.set(fermeId, m);
  }
  return m;
}

/** Tâches marquées faites de la ferme (même objet tant qu'elles ne changent pas). */
export function masquesDe(porte: PorteDonnees, fermeId: string): Masques {
  return masquesFerme(porte, fermeId).masques;
}

/** Suit les masques de la ferme : `rappel` à chaque changement. Rend le désabonnement. */
export function suivreMasques(porte: PorteDonnees, fermeId: string, rappel: () => void): () => void {
  const m = masquesFerme(porte, fermeId);
  m.abonnes.add(rappel);
  return () => {
    m.abonnes.delete(rappel);
  };
}

/**
 * Change les masques de la ferme : `changer` reçoit une copie à modifier. Les masques tombés sur
 * la journée `affichee` (celle que l'écran montre, qui a relu leur culture depuis l'écriture) sont
 * oubliés au passage ; jamais contre une autre journée, qu'un rendu n'aurait pas encore montrée.
 */
export function changerMasques(porte: PorteDonnees, fermeId: string, affichee: Journee | null, changer: (m: Map<string, Masque>) => void): void {
  const f = masquesFerme(porte, fermeId);
  const avant = f.masques;
  const n = affichee === null ? new Map(avant) : new Map([...avant].filter(([cle]) => estMasquee(avant, affichee, cle)));
  changer(n);
  f.masques = n;
  for (const rappel of [...f.abonnes]) rappel();
}

/**
 * Annonce une saisie de l'écran sur `culture`, AVANT de l'écrire : le changement qu'elle
 * provoquera ne relira que cette culture (`remplace` : elle corrige ou annule une saisie, les
 * chaînes du journal sont relues aussi). Rend la fonction qui retire l'annonce si l'écriture
 * échoue (aucun changement ne viendra).
 */
export function annoncerSaisie(porte: PorteDonnees, fermeId: string, culture: Culture['cible'], remplace: boolean): () => void {
  const annonce: Annonce = { cible: culture, remplace };
  const touches: Suivi[] = [];
  for (const s of suivis.get(porte)?.values() ?? []) {
    if (s.fermeId !== fermeId || s.arreter === null) continue;
    s.annonces.push(annonce);
    touches.push(s);
  }
  return () => {
    for (const s of touches) s.annonces = s.annonces.filter((a) => a !== annonce);
  };
}

/** Oublie les journées des jours passés de la ferme qu'aucun écran ne montre (le cache ne grossit pas). */
function oublierJoursPasses(porte: PorteDonnees, fermeId: string, jour: string): void {
  const parCle = suivis.get(porte);
  if (parCle === undefined) return;
  for (const [cle, s] of parCle) {
    if (s.fermeId !== fermeId || s.jour >= jour || s.abonnes.size > 0) continue;
    arreterVerification(s);
    s.quittee = true;
    parCle.delete(cle);
  }
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
  oublierJoursPasses(porte, fermeId, jour);
  const s = suiviDe(porte, fermeId, jour);
  s.abonnes.add(rappel);
  s.quittee = false;
  const echec = (e: unknown) => {
    if (!(e instanceof LectureAbandonnee)) surEchec(e);
  };
  if (s.arreter === null) {
    // Le premier appel (immédiat) lance la lecture, ou attend celle qui est déjà en cours (rien
    // n'a changé) ; chaque changement ensuite en relance une.
    let premier = true;
    s.arreter = porte.surveiller({ sql: 'SELECT 1 AS temoin', tables: TABLES_AUJOURDHUI }, () => {
      if (premier) {
        premier = false;
        if (s.enCours !== null && !s.verificationEnCours) {
          s.enCours.catch(echec);
          return;
        }
        demander(s, { sorte: 'tout' });
      } else {
        noterChangement(s);
      }
      relire(porte, s).catch(echec);
    });
  } else {
    demander(s, { sorte: 'tout' });
    relire(porte, s).catch(echec);
  }
  return () => {
    s.abonnes.delete(rappel);
    if (s.abonnes.size === 0 && s.arreter !== null) {
      s.arreter();
      s.arreter = null;
      s.annonces = [];
      s.quittee = true;
      arreterVerification(s);
    }
  };
}

/**
 * Prépare la journée (base ouverte, avant l’affichage) : lue une fois (calculée à l’affichage), après
 * `apres` s'il est donné. Au lancement, App lui fait attendre le début du plan, au plus
 * ATTENTE_PLAN_MAX_MS (App.tsx, T13c) : Aujourd'hui, écran d'accueil, ne reste pas bloqué derrière
 * le plan. L'écran ouvert entre temps attend cette lecture au lieu d'en lancer une autre.
 */
export async function prechargerJournee(porte: PorteDonnees, fermeId: string, jour: string, apres?: Promise<unknown>): Promise<void> {
  const s = suiviDe(porte, fermeId, jour);
  if (s.lignes === null && s.etat === null) {
    demander(s, { sorte: 'tout' });
    await relire(porte, s, { ...(apres === undefined ? {} : { apres }), preparation: true }).catch((e: unknown) => {
      if (!(e instanceof LectureAbandonnee)) throw e;
    });
  }
}

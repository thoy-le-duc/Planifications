/**
 * État de récolte d'une occupation à une date (T32e, Q34) : aucune, fruits en formation (avec une
 * maturité de 0 à 1), à récolter, fin de récolte. Déterministe : le jour est un argument, les
 * écarts se comptent en jours entiers (dates calendaires, sans fuseau). Rien n'est inventé sans
 * date : sans début de récolte, `aucune`. La date réelle, si elle est remplie, remplace la prévue.
 *
 * Règles et exemples : en-tête de test/contrat-recolte.ts.
 */
import { ajouterJours, ecartEnJours, type DateCalendaire } from '../dates/index.ts';
import type { DateRepere, DatesCroissance, EntreePerenne } from './types.ts';

export type PhaseRecolte = 'aucune' | 'fruits-en-formation' | 'a-recolter' | 'fin-de-recolte';

export interface EtatRecolte {
  readonly phase: PhaseRecolte;
  /** De 0 à 1 : croît linéairement pendant la formation des fruits, vaut 1 ensuite, 0 sans récolte. */
  readonly maturite: number;
}

/** Les quatre phases, dans l'ordre. */
export const PHASES_RECOLTE: readonly PhaseRecolte[] = /* @__PURE__ */ Object.freeze(['aucune', 'fruits-en-formation', 'a-recolter', 'fin-de-recolte'] as const);

/** Durée de la formation des fruits avant le début de récolte (ils grossissent sur ces jours). */
export const JOURS_FORMATION_FRUITS = 28;
/** « Dernières semaines » de la fenêtre de récolte : le feuillage jaunit sur ces jours (au plus : voir `joursAvantLaFin`). */
export const JOURS_FIN_RECOLTE = 14;

const AUCUNE: EtatRecolte = /* @__PURE__ */ Object.freeze({ phase: 'aucune', maturite: 0 });
const A_RECOLTER: EtatRecolte = /* @__PURE__ */ Object.freeze({ phase: 'a-recolter', maturite: 1 });
const FIN: EtatRecolte = /* @__PURE__ */ Object.freeze({ phase: 'fin-de-recolte', maturite: 1 });

const repere = (r: DateRepere): DateCalendaire | null => r.reelle ?? r.prevue;

/**
 * Nombre de jours « à récolter » avant la fin de récolte (T32f) : la fin de récolte commence à
 * max(F − 14, B + ⌈(F − B) / 2⌉), donc jamais avant la moitié de la fenêtre et toujours au moins
 * un jour « à récolter » (de 1 jour à 28 jours : la moitié ; au-delà : les 14 derniers jours).
 */
const joursAvantLaFin = (b: DateCalendaire, f: DateCalendaire): number => {
  const longueur = ecartEnJours(b, f);
  return Math.max(0, longueur - JOURS_FIN_RECOLTE, Math.ceil(longueur / 2));
};

/**
 * Phase pour un début `b` et une fin `f` de récolte (null = inconnue), `jour` supposé dans la vie
 * de la plante. Fin inconnue : à récolter dès `b`, sans fin inventée.
 */
function phase(b: DateCalendaire, f: DateCalendaire | null, jour: DateCalendaire): EtatRecolte {
  const avantDebut = ecartEnJours(jour, b);
  if (avantDebut > 0) {
    if (avantDebut > JOURS_FORMATION_FRUITS) return AUCUNE;
    return { phase: 'fruits-en-formation', maturite: (JOURS_FORMATION_FRUITS - avantDebut) / JOURS_FORMATION_FRUITS };
  }
  if (f !== null && ecartEnJours(b, jour) >= joursAvantLaFin(b, f)) return FIN;
  return A_RECOLTER;
}

/** Culture annuelle (occupation d'une série) : état de récolte au jour `jour`. */
export function recolteA(dates: DatesCroissance, jour: DateCalendaire): EtatRecolte {
  const b = repere(dates.debutRecolte);
  if (b === null) return AUCUNE;
  const m = repere(dates.miseEnPlace);
  if (m !== null && jour < m) return AUCUNE;
  const a = repere(dates.arrachage);
  if (a !== null && jour >= a) return AUCUNE;
  return phase(b, repere(dates.finRecolte), jour);
}

/**
 * La campagne est « en cours » au jour `jour` (T32f) : elle le contient, ou elle commence dans les
 * 28 jours, quelle que soit l'année à laquelle elle est rattachée. Sans date de fin, elle va jusqu'au
 * 31 décembre de son année (rien n'est inventé au-delà). Sans début : jamais.
 */
export function campagneEnCours(campagne: EntreePerenne['campagne'], jour: DateCalendaire): boolean {
  const debut = campagne?.debutRecolte ?? null;
  if (campagne === null || debut === null) return false;
  if (ecartEnJours(jour, debut) > JOURS_FORMATION_FRUITS) return false;
  const fin = campagne.finRecolte;
  return fin !== null ? jour < fin : jour <= (`${String(campagne.annee).padStart(4, '0')}-12-31` as DateCalendaire);
}

/** Pérenne à récolte annuelle (fraise, asperge, kiwi…) : suit la campagne qui contient le jour ou qui commence dans les 28 jours. */
export function recoltePerenneA(entree: EntreePerenne, jour: DateCalendaire): EtatRecolte {
  const { datePlantation, dateArrachage } = entree.plantation;
  if (jour < datePlantation || (dateArrachage !== null && jour >= dateArrachage)) return AUCUNE;
  const debut = entree.campagne?.debutRecolte ?? null;
  // Après la fin de la campagne, la plante n'est plus en récolte (la période est annuelle).
  if (debut === null || !campagneEnCours(entree.campagne, jour)) return AUCUNE;
  return phase(debut, entree.campagne?.finRecolte ?? null, jour);
}

/**
 * Avancement du jaunissement du feuillage (0 à 1) : 0 hors « fin de récolte », puis croissant
 * (positif dès le premier jour de la fin de récolte, 1 à la fin de la fenêtre, puis 1 jusqu'à
 * l'arrachage). Fin de récolte inconnue : jamais de jaunissement (rien n'est inventé).
 */
function avancementJaunissement(debut: DateCalendaire | null, fin: DateCalendaire | null, jour: DateCalendaire): number {
  if (fin === null || debut === null) return 0;
  const joursDeFin = ecartEnJours(debut, fin) - joursAvantLaFin(debut, fin);
  const ecoules = ecartEnJours(ajouterJours(debut, joursAvantLaFin(debut, fin)), jour);
  return Math.min(1, (ecoules + 1) / (joursDeFin + 1));
}

/** Jaunissement d'une culture annuelle au jour `jour` (0 hors « fin de récolte »). */
export function jaunissementA(dates: DatesCroissance, jour: DateCalendaire): number {
  return recolteA(dates, jour).phase === 'fin-de-recolte' ? avancementJaunissement(repere(dates.debutRecolte), repere(dates.finRecolte), jour) : 0;
}

/** Jaunissement d'une pérenne à récolte annuelle au jour `jour` (0 hors « fin de récolte »). */
export function jaunissementPerenneA(entree: EntreePerenne, jour: DateCalendaire): number {
  return recoltePerenneA(entree, jour).phase === 'fin-de-recolte' ? avancementJaunissement(entree.campagne?.debutRecolte ?? null, entree.campagne?.finRecolte ?? null, jour) : 0;
}

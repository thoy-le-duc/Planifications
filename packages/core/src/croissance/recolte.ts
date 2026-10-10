/**
 * État de récolte d'une occupation à une date (T32e, Q34) : aucune, fruits en formation (avec une
 * maturité de 0 à 1), à récolter, fin de récolte. Déterministe : le jour est un argument, les
 * écarts se comptent en jours entiers (dates calendaires, sans fuseau). Rien n'est inventé sans
 * date : sans début de récolte, `aucune`. La date réelle, si elle est remplie, remplace la prévue.
 *
 * Règles et exemples : en-tête de test/contrat-recolte.ts.
 */
import { ecartEnJours, type DateCalendaire } from '../dates/index.ts';
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
/** « Dernières semaines » de la fenêtre de récolte : le feuillage jaunit sur ces jours. */
export const JOURS_FIN_RECOLTE = 14;

const AUCUNE: EtatRecolte = /* @__PURE__ */ Object.freeze({ phase: 'aucune', maturite: 0 });
const A_RECOLTER: EtatRecolte = /* @__PURE__ */ Object.freeze({ phase: 'a-recolter', maturite: 1 });
const FIN: EtatRecolte = /* @__PURE__ */ Object.freeze({ phase: 'fin-de-recolte', maturite: 1 });

const repere = (r: DateRepere): DateCalendaire | null => r.reelle ?? r.prevue;

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
  if (f !== null && ecartEnJours(jour, f) <= JOURS_FIN_RECOLTE) return FIN;
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

/** Pérenne à récolte annuelle (fraise, asperge, kiwi…) : suit la campagne de l'année du jour. */
export function recoltePerenneA(entree: EntreePerenne, jour: DateCalendaire): EtatRecolte {
  const { datePlantation, dateArrachage } = entree.plantation;
  if (jour < datePlantation || (dateArrachage !== null && jour >= dateArrachage)) return AUCUNE;
  const campagne = entree.campagne;
  if (campagne === null || campagne.debutRecolte === null || campagne.annee !== Number(jour.slice(0, 4))) return AUCUNE;
  // Après la fin de la campagne, la plante n'est plus en récolte (la période est annuelle).
  if (campagne.finRecolte !== null && jour >= campagne.finRecolte) return AUCUNE;
  return phase(campagne.debutRecolte, campagne.finRecolte, jour);
}

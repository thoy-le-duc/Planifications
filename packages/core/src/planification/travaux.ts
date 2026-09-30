/**
 * Travaux prévus d'un itinéraire (T22) : leurs dates dans une série, leur temps estimé, la
 * charge d'une semaine, et l'instantané qu'une série fige. Fonctions pures, arithmétique en
 * jours absolus (`dates/`), sans objet `Date`. Contrat : ./test/contrat-travaux.ts.
 */
import { dateDepuisJourAbsolu, jourAbsolu } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import { verifierExhaustif } from '../domaine/index.ts';
import type { Itineraire, ParametresItineraire, RepereTravail, TailleSerie, TempsEstime, TravailPrevu } from '../domaine/index.ts';
import type { DatesSerie, EtapeSerie } from './dates-serie.ts';

/** Étape de la série que désigne un repère. */
export function etapeDuRepere(repere: RepereTravail): EtapeSerie {
  switch (repere) {
    case 'semis_pepiniere':
      return 'semisPepiniere';
    case 'mise_en_place':
      return 'miseEnPlace';
    case 'debut_recolte':
      return 'debutRecolte';
    case 'fin_recolte':
      return 'finRecolte';
    default:
      return verifierExhaustif(repere);
  }
}

/**
 * Jours absolus des occurrences d'un travail, croissants : repère + décalage, puis tous les N
 * jours tant que la date ne dépasse pas le repère de fin (compris). Repère absent des dates
 * (semis pépinière d'un semis direct) : aucune occurrence.
 */
export function joursTravailPrevu(travail: TravailPrevu, dates: DatesSerie): readonly number[] {
  const repere = dates[etapeDuRepere(travail.repere)];
  if (repere === undefined) return [];
  const debut = jourAbsolu(repere) + travail.decalageJours;
  const repetition = travail.repetition;
  if (repetition === null) return [debut];
  const fin = dates[etapeDuRepere(repetition.repereFin)];
  const pas = repetition.tousLesJours;
  // Filet : une période non entière ou nulle (donnée non validée) ne boucle jamais.
  if (fin === undefined || !Number.isSafeInteger(pas) || pas < 1) return [];
  const jourFin = jourAbsolu(fin);
  const jours: number[] = [];
  for (let j = debut; j <= jourFin; j += pas) jours.push(j);
  return jours;
}

/** Dates des occurrences d'un travail prévu dans une série, croissantes. */
export function datesTravailPrevu(travail: TravailPrevu, dates: DatesSerie): readonly DateCalendaire[] {
  return joursTravailPrevu(travail, dates).map(dateDepuisJourAbsolu);
}

/**
 * Temps estimé d'un travail pour une série, en minutes entières (arrondi à la plus proche, demi
 * vers le haut) : par 100 m, au prorata de la longueur (série en plants : `null`) ; par planche,
 * par emplacement distinct (aucun : `null`).
 */
export function tempsEstimeMinutes(
  temps: TempsEstime | null,
  serie: { readonly taille: TailleSerie; readonly nombreEmplacements: number },
): number | null {
  if (temps === null) return null;
  if (temps.par === 'planche') return serie.nombreEmplacements > 0 ? temps.minutes * serie.nombreEmplacements : null;
  if (serie.taille.unite !== 'longueur') return null;
  // minutes × longueur en millionièmes entiers (la longueur a au plus quelques décimales), puis
  // division entière par 100 m : 29 × 50 / 100 = 14,5 → 15, jamais 14,4999… → 14.
  const produit = Math.round(temps.minutes * serie.taille.longueurM * 1e6);
  return Math.floor((produit + 50e6) / 100e6);
}

/** Charge d'une liste de tâches : la somme de leurs temps estimés connus, en minutes. */
export function chargeSemaine(taches: readonly { readonly tempsEstimeMinutes?: number | null }[]): number {
  let total = 0;
  for (const t of taches) {
    const m = t.tempsEstimeMinutes;
    if (typeof m === 'number') total += m;
  }
  return total;
}

/** Clés de l'identité d'un itinéraire : elles ne font pas partie de l'instantané. */
const IDENTITE = new Set(['id', 'fermeId', 'especeId', 'varieteId', 'nom', 'supprimeLe']);

/**
 * Instantané d'un itinéraire : ses paramètres (travaux prévus compris), sans son identité, en
 * copie profonde. C'est ce que `serie.parametres` fige : modifier l'itinéraire ensuite ne change
 * jamais une série existante.
 */
export function instantaneItineraire(itineraire: Itineraire): ParametresItineraire {
  const parametres = Object.fromEntries(Object.entries(itineraire).filter(([cle]) => !IDENTITE.has(cle)));
  return JSON.parse(JSON.stringify(parametres)) as ParametresItineraire;
}

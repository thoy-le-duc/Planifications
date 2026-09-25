/**
 * Dates d'une série (T02) : calcul depuis une ancre, en avant ou à rebours, puis recalage sur
 * les dates réellement saisies. Fonctions pures, calculs en jours entiers via `dates/`.
 */
import { ajouterJours, ecartEnJours, lundiDeSemaine, nombreSemainesIso } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import { verifierExhaustif } from '../domaine/index.ts';
import type { AncreSerie, DatesPrevuesSerie, Jours, ParametresPerenne } from '../domaine/index.ts';

/** Étapes d'une série, dans l'ordre chronologique. */
export type EtapeSerie = 'semisPepiniere' | 'miseEnPlace' | 'debutRecolte' | 'finRecolte';

const ETAPES: readonly EtapeSerie[] = ['semisPepiniere', 'miseEnPlace', 'debutRecolte', 'finRecolte'];

interface DureesRecolte {
  /** Comptée depuis la mise en place (semis direct ou plantation). */
  readonly dureeAvantRecolteJours: Jours;
  readonly fenetreRecolteJours: Jours;
}

/** Sous-ensemble de `ParametresItineraire` utile aux dates : l'instantané complet s'y assigne. */
export type ParametresDatesSerie =
  | (DureesRecolte & { readonly mode: 'semis_direct' })
  | (DureesRecolte & { readonly mode: 'plant_maison'; readonly dureePepiniereJours: Jours })
  | (DureesRecolte & { readonly mode: 'plant_achete' });

/**
 * Dates d'une série : le type `DatesPrevuesSerie` de T01, sous un nom propre au module.
 * `semisPepiniere` n'existe qu'en plant maison : ailleurs la clé est absente.
 */
export type DatesSerie = DatesPrevuesSerie;

/** Dates réelles saisies, étape par étape. */
export type RealisesSerie = Readonly<Partial<Record<EtapeSerie, DateCalendaire>>>;

export interface PlantationPerenne {
  readonly datePlantation: DateCalendaire;
  readonly perenne: ParametresPerenne;
}

export interface DatesCampagne {
  readonly debutRecolte: DateCalendaire;
  readonly finRecolte: DateCalendaire;
}

/** Durée (jours ou années) entière et positive ou nulle, sinon RangeError. */
function exigerDuree(n: number, nom: string): number {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${nom} doit être un nombre entier positif ou nul : ${String(n)}`);
  }
  return n;
}

/** Durée de pépinière, ou `null` quand la série n'a pas de semis pépinière. */
function dureePepiniere(parametres: ParametresDatesSerie): Jours | null {
  return parametres.mode === 'plant_maison' ? exigerDuree(parametres.dureePepiniereJours, 'la durée en pépinière') : null;
}

/** Date de mise en place déduite de l'ancre. */
function miseEnPlaceDepuisAncre(
  parametres: ParametresDatesSerie,
  ancre: AncreSerie,
  avantRecolte: Jours,
  pepiniere: Jours | null,
): DateCalendaire {
  switch (ancre.type) {
    case 'plantation':
      return ancre.date;
    case 'debut_recolte':
      return ajouterJours(ancre.date, -avantRecolte);
    case 'semis':
      if (parametres.mode === 'plant_achete') {
        throw new RangeError("un plant acheté n'a pas de semis à la ferme : ancrer sur la plantation ou la récolte");
      }
      return ajouterJours(ancre.date, pepiniere ?? 0);
    default:
      return verifierExhaustif(ancre);
  }
}

/** Assemble les dates en laissant la clé `semisPepiniere` absente quand elle est sans objet. */
function assembler(
  semisPepiniere: DateCalendaire | undefined,
  suite: Omit<DatesSerie, 'semisPepiniere'>,
): DatesSerie {
  return semisPepiniere === undefined ? { ...suite } : { semisPepiniere, ...suite };
}

/** Dates prévues d'une série depuis ses paramètres et une seule date d'ancre. */
export function calculerDatesSerie(parametres: ParametresDatesSerie, ancre: AncreSerie): DatesSerie {
  const avantRecolte = exigerDuree(parametres.dureeAvantRecolteJours, 'la durée avant récolte');
  const fenetre = exigerDuree(parametres.fenetreRecolteJours, 'la fenêtre de récolte');
  const pepiniere = dureePepiniere(parametres);

  const miseEnPlace = miseEnPlaceDepuisAncre(parametres, ancre, avantRecolte, pepiniere);
  const debutRecolte = ajouterJours(miseEnPlace, avantRecolte);
  return assembler(pepiniere === null ? undefined : ajouterJours(miseEnPlace, -pepiniere), {
    miseEnPlace,
    debutRecolte,
    finRecolte: ajouterJours(debutRecolte, fenetre),
  });
}

/** Dernière étape réalisée (ordre chronologique) et son écart au prévu, ou `null` sans réalisé. */
function dernierEcart(prevues: DatesSerie, realises: RealisesSerie): { index: number; ecart: number } | null {
  let dernier: { index: number; ecart: number } | null = null;
  for (const [index, etape] of ETAPES.entries()) {
    const reel = realises[etape];
    if (reel === undefined) {
      continue;
    }
    const prevue = prevues[etape];
    if (prevue === undefined) {
      throw new RangeError(`étape réalisée « ${etape} » absente des dates prévues de la série`);
    }
    dernier = { index, ecart: ecartEnJours(prevue, reel) };
  }
  return dernier;
}

/**
 * Recale les dates prévues sur le réel : chaque étape réalisée prend sa date réelle, les étapes
 * non réalisées après la dernière réalisée glissent de son écart, celles d'avant ne bougent pas.
 */
export function appliquerRealises(datesPrevues: DatesSerie, realises: RealisesSerie): DatesSerie {
  const dernier = dernierEcart(datesPrevues, realises);
  const recaler = (etape: EtapeSerie, prevue: DateCalendaire): DateCalendaire => {
    const reel = realises[etape];
    if (reel !== undefined) {
      return reel;
    }
    return dernier !== null && ETAPES.indexOf(etape) > dernier.index ? ajouterJours(prevue, dernier.ecart) : prevue;
  };
  const semis = datesPrevues.semisPepiniere;
  return assembler(semis === undefined ? undefined : recaler('semisPepiniere', semis), {
    miseEnPlace: recaler('miseEnPlace', datesPrevues.miseEnPlace),
    debutRecolte: recaler('debutRecolte', datesPrevues.debutRecolte),
    finRecolte: recaler('finRecolte', datesPrevues.finRecolte),
  });
}

/** Lundi de la semaine ISO demandée, la semaine 53 étant ramenée à la S52 les années qui n'en ont que 52. */
function lundiDeSemaineBornee(annee: number, semaine: number): DateCalendaire {
  return lundiDeSemaine(annee, Math.min(semaine, nombreSemainesIso(annee)));
}

/**
 * Dates de récolte d'une pérenne pour la campagne `annee`, ou `null` quand il n'y a pas de récolte
 * cette année-là.
 *
 * - `annee` est une année ISO : la période est en semaines ISO, et la S1 peut commencer fin
 *   décembre de l'année civile précédente (S1 2026 = lundi 2025-12-29).
 * - Récolte du lundi de la semaine de début au dimanche de la semaine de fin ; si la fin est avant
 *   le début, la période chevauche le nouvel an et finit l'année suivante (la campagne porte
 *   l'année où la récolte commence).
 * - Une semaine 53 est ramenée à la dernière semaine des années qui n'en ont que 52.
 * - `null` avant l'année de plantation + `anneesAvantPremiereRecolte` (année civile de la
 *   plantation), et aussi quand le début de récolte tombe avant la plantation : une plantation
 *   faite pendant ou après la période de récolte ne récolte pas cette année-là, la campagne entière
 *   est sautée (règle simple, sans période tronquée).
 * - RangeError si `anneesAvantPremiereRecolte` n'est pas un entier positif ou nul.
 */
export function calculerDatesCampagne(plantation: PlantationPerenne, annee: number): DatesCampagne | null {
  const { datePlantation, perenne } = plantation;
  const attente = exigerDuree(perenne.anneesAvantPremiereRecolte, "le nombre d'années avant la première récolte");
  if (annee < Number(datePlantation.slice(0, 4)) + attente) {
    return null;
  }
  const { semaineDebut, semaineFin } = perenne.periodeRecolteAnnuelle;
  const debutRecolte = lundiDeSemaineBornee(annee, semaineDebut);
  if (debutRecolte < datePlantation) {
    return null;
  }
  const anneeFin = semaineFin < semaineDebut ? annee + 1 : annee;
  return { debutRecolte, finRecolte: ajouterJours(lundiDeSemaineBornee(anneeFin, semaineFin), 6) };
}

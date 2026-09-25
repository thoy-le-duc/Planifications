/**
 * Semainier (T06) : ce qu'il y a à faire dans une semaine ISO, tiré du plan sans rien ressaisir.
 *
 * Fonction pure. Les dates d'une série sont recalées par ses réalisés (`appliquerRealises`, T02) ;
 * toute l'arithmétique passe par le jour absolu de `dates/`, sans objet `Date`.
 */
import { jourAbsolu, lundiDeSemaine } from '../dates/index.ts';
import type { DateCalendaire, SemaineIso } from '../dates/index.ts';
import { verifierExhaustif } from '../domaine/index.ts';
import type {
  CultureConcernee,
  DatesPrevuesSerie,
  EtapeRealisee,
  Id,
  ModeItineraire,
  StatutSerie,
  TailleSerie,
} from '../domaine/index.ts';
import { appliquerRealises } from './dates-serie.ts';
import type { EtapeSerie, RealisesSerie } from './dates-serie.ts';

export interface EmplacementConcerne {
  readonly id: Id<'Emplacement'>;
  /** Emplacement.code ('T2-P03'). */
  readonly code: string;
  /** Nom de la zone de l'emplacement ('Tunnel 2'). */
  readonly zone: string;
}

/** Vue d'une série jointe à l'espèce, la variété et aux emplacements de ses occupations. */
export interface SerieSemainier {
  readonly id: Id<'Serie'>;
  readonly statut: StatutSerie;
  readonly mode: ModeItineraire;
  readonly culture: string;
  readonly variete: string | null;
  /** Dates prévues avant recalage par les réalisés. */
  readonly datesPrevues: DatesPrevuesSerie;
  readonly taille: TailleSerie;
  readonly emplacements: readonly EmplacementConcerne[];
}

/** Vue d'une campagne de pérenne et de sa plantation. */
export interface CampagneSemainier {
  readonly id: Id<'Campagne'>;
  readonly culture: string;
  readonly variete: string | null;
  readonly debutRecoltePrevu: DateCalendaire | null;
  readonly nombrePlants: number;
  readonly emplacements: readonly EmplacementConcerne[];
}

/**
 * Réalisés dérivés du journal par l'appelant. Une série ou une campagne absente des Map n'a
 * aucun réalisé ; pour une campagne, la date est celle de la première récolte saisie.
 */
export interface RealisesSemainier {
  readonly series: ReadonlyMap<Id<'Serie'>, RealisesSerie>;
  readonly campagnes: ReadonlyMap<Id<'Campagne'>, DateCalendaire>;
}

export type EtapeTache = EtapeRealisee | 'debut_recolte';

export interface TacheSemainier {
  readonly etape: EtapeTache;
  readonly cible: CultureConcernee;
  readonly culture: string;
  readonly variete: string | null;
  /** Triés par zone puis par code, en ordre naturel. */
  readonly emplacements: readonly EmplacementConcerne[];
  /** Campagne : `{ unite: 'plants', nombrePlants }`. */
  readonly taille: TailleSerie;
  /** Date recalée par les réalisés. */
  readonly datePrevue: DateCalendaire;
  readonly enRetard: boolean;
  /** 0 quand la tâche n'est pas en retard. */
  readonly joursDeRetard: number;
}

/** Étapes d'une série dans l'ordre chronologique : leur rang sert à la fois aux réalisés et au tri. */
const ETAPES_SERIE: readonly EtapeSerie[] = ['semisPepiniere', 'miseEnPlace', 'debutRecolte', 'finRecolte'];
const RANG_DEBUT_RECOLTE = ETAPES_SERIE.indexOf('debutRecolte');

/** Ordre naturel français : 'T2-P9' avant 'T2-P10'. Créé une fois pour tout le module. */
const COLLATOR = new Intl.Collator('fr', { numeric: true });

function etapeTache(etape: EtapeSerie, mode: ModeItineraire): EtapeTache {
  switch (etape) {
    case 'semisPepiniere':
      return 'semis_pepiniere';
    case 'miseEnPlace':
      return mode === 'semis_direct' ? 'semis_direct' : 'plantation';
    case 'debutRecolte':
      return 'debut_recolte';
    case 'finRecolte':
      return 'arrachage';
    default:
      return verifierExhaustif(etape);
  }
}

function comparerEmplacements(a: EmplacementConcerne, b: EmplacementConcerne): number {
  return COLLATOR.compare(a.zone, b.zone) || COLLATOR.compare(a.code, b.code);
}

/** Copie triée (les entrées ne sont jamais modifiées). */
function trierEmplacements(emplacements: readonly EmplacementConcerne[]): readonly EmplacementConcerne[] {
  return emplacements.length < 2 ? [...emplacements] : [...emplacements].sort(comparerEmplacements);
}

/** Tâche en construction, avec ses clés de tri. */
interface Candidate {
  readonly tache: TacheSemainier;
  readonly jour: number;
  readonly rangEtape: number;
}

/** Bornes de la semaine et date du jour, en jours absolus, calculées une seule fois. */
interface Fenetre {
  readonly lundi: number;
  readonly dimanche: number;
  readonly aujourdhui: number;
}

/**
 * Retard en jours si la tâche doit figurer dans la semaine, `null` sinon. Elle y figure si sa
 * date tombe dans la semaine, ou si elle est d'avant la semaine et déjà en retard.
 */
function retardSiDansLaSemaine(jour: number, fenetre: Fenetre): number | null {
  if (jour > fenetre.dimanche) {
    return null;
  }
  const retard = fenetre.aujourdhui - jour;
  if (jour < fenetre.lundi && retard <= 0) {
    return null;
  }
  return retard > 0 ? retard : 0;
}

function comparerCandidates(a: Candidate, b: Candidate): number {
  const ta = a.tache;
  const tb = b.tache;
  if (ta.enRetard !== tb.enRetard) {
    return ta.enRetard ? -1 : 1;
  }
  if (a.jour !== b.jour) {
    return a.jour - b.jour;
  }
  const ea = ta.emplacements[0];
  const eb = tb.emplacements[0];
  if (ea === undefined || eb === undefined) {
    if (ea !== eb) {
      return ea === undefined ? 1 : -1;
    }
  } else {
    const parEmplacement = comparerEmplacements(ea, eb);
    if (parEmplacement !== 0) {
      return parEmplacement;
    }
  }
  // Égalité restante : rang de l'étape, puis ordre d'entrée (tri stable).
  return a.rangEtape - b.rangEtape;
}

function ajouterSerie(serie: SerieSemainier, realises: RealisesSerie | undefined, fenetre: Fenetre, sortie: Candidate[]): void {
  const dates = realises === undefined ? serie.datesPrevues : appliquerRealises(serie.datesPrevues, realises);
  // Décision provisoire (PR #2) : une étape réalisée vaut pour toutes les étapes antérieures.
  let dernierRealise = -1;
  if (realises !== undefined) {
    for (let rang = 0; rang < ETAPES_SERIE.length; rang++) {
      const etape = ETAPES_SERIE[rang];
      if (etape !== undefined && realises[etape] !== undefined) {
        dernierRealise = rang;
      }
    }
  }
  let emplacements: readonly EmplacementConcerne[] | null = null;
  for (let rang = dernierRealise + 1; rang < ETAPES_SERIE.length; rang++) {
    const etape = ETAPES_SERIE[rang];
    const date = etape === undefined ? undefined : dates[etape];
    if (etape === undefined || date === undefined) {
      continue;
    }
    const jour = jourAbsolu(date);
    const retard = retardSiDansLaSemaine(jour, fenetre);
    if (retard === null) {
      continue;
    }
    emplacements ??= trierEmplacements(serie.emplacements);
    sortie.push({
      jour,
      rangEtape: rang,
      tache: {
        etape: etapeTache(etape, serie.mode),
        cible: { sorte: 'serie', serieId: serie.id },
        culture: serie.culture,
        variete: serie.variete,
        emplacements,
        taille: serie.taille,
        datePrevue: date,
        enRetard: retard > 0,
        joursDeRetard: retard,
      },
    });
  }
}

function ajouterCampagne(campagne: CampagneSemainier, fenetre: Fenetre, sortie: Candidate[]): void {
  const date = campagne.debutRecoltePrevu;
  if (date === null) {
    return;
  }
  const jour = jourAbsolu(date);
  const retard = retardSiDansLaSemaine(jour, fenetre);
  if (retard === null) {
    return;
  }
  sortie.push({
    jour,
    rangEtape: RANG_DEBUT_RECOLTE,
    tache: {
      etape: 'debut_recolte',
      cible: { sorte: 'campagne', campagneId: campagne.id },
      culture: campagne.culture,
      variete: campagne.variete,
      emplacements: trierEmplacements(campagne.emplacements),
      taille: { unite: 'plants', nombrePlants: campagne.nombrePlants },
      datePrevue: date,
      enRetard: retard > 0,
      joursDeRetard: retard,
    },
  });
}

/**
 * Tâches de la semaine ISO demandée, triées : en retard d'abord, puis par date, par zone et code
 * du premier emplacement (ordre naturel, sans emplacement en dernier), par étape, par ordre d'entrée.
 *
 * - Seules les séries 'prevue' et 'en_cours' comptent.
 * - Une étape réalisée, ou antérieure à une étape réalisée, ne donne plus de tâche.
 * - Une tâche en retard (date prévue avant la date du jour) d'avant la semaine y est reprise,
 *   sans limite dans le temps.
 * - RangeError si la semaine n'existe pas (S53 d'une année qui n'en a que 52).
 */
export function semainier(
  semaine: SemaineIso,
  series: readonly SerieSemainier[],
  campagnes: readonly CampagneSemainier[],
  realises: RealisesSemainier,
  dateDuJour: DateCalendaire,
): readonly TacheSemainier[] {
  const lundi = jourAbsolu(lundiDeSemaine(semaine.annee, semaine.semaine));
  const fenetre: Fenetre = { lundi, dimanche: lundi + 6, aujourdhui: jourAbsolu(dateDuJour) };

  const candidates: Candidate[] = [];
  for (const serie of series) {
    if (serie.statut === 'prevue' || serie.statut === 'en_cours') {
      ajouterSerie(serie, realises.series.get(serie.id), fenetre, candidates);
    }
  }
  for (const campagne of campagnes) {
    if (!realises.campagnes.has(campagne.id)) {
      ajouterCampagne(campagne, fenetre, candidates);
    }
  }
  candidates.sort(comparerCandidates);
  return candidates.map((c) => c.tache);
}

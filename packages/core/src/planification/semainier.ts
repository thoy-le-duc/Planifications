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
import { ETAPES_SERIE, appliquerRealises } from './dates-serie.ts';
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
  /** Au-delà (strictement), la tâche de début de récolte n'est plus listée ; `null` : pas de borne. */
  readonly finRecoltePrevue: DateCalendaire | null;
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

/**
 * Rang de tri d'une étape à date et emplacement égaux : l'arrachage d'abord (on libère la planche
 * avant de semer ou de planter), puis l'ordre chronologique.
 */
const RANG_TRI: Readonly<Record<EtapeSerie, number>> = {
  finRecolte: 0,
  semisPepiniere: 1,
  miseEnPlace: 2,
  debutRecolte: 3,
};

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
  /** Identifiant de la série ou de la campagne : départage final. */
  readonly idCible: string;
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
  if (a.rangEtape !== b.rangEtape) {
    return a.rangEtape - b.rangEtape;
  }
  // Ordre des chaînes (pas de collator) : le résultat ne dépend jamais de l'ordre d'entrée.
  return a.idCible < b.idCible ? -1 : a.idCible > b.idCible ? 1 : 0;
}

/**
 * Réalisés sans les étapes absentes des dates prévues (semis pépinière saisi sur un semis direct
 * ou un plant acheté) : ignorées plutôt que de faire planter le semainier. Même objet si tout va.
 */
function realisesCoherents(prevues: DatesPrevuesSerie, realises: RealisesSerie): RealisesSerie {
  if (realises.semisPepiniere === undefined || prevues.semisPepiniere !== undefined) {
    return realises;
  }
  const reste: Partial<Record<EtapeSerie, DateCalendaire>> = { ...realises };
  delete reste.semisPepiniere;
  return reste;
}

function ajouterSerie(serie: SerieSemainier, realises: RealisesSerie | undefined, fenetre: Fenetre, sortie: Candidate[]): void {
  const prevues = serie.datesPrevues;
  const coherents = realises === undefined ? undefined : realisesCoherents(prevues, realises);
  const dates = coherents === undefined ? prevues : appliquerRealises(prevues, coherents);
  // Décision provisoire (PR #2) : une étape réalisée vaut pour toutes les étapes antérieures.
  let dernierRealise = -1;
  if (coherents !== undefined) {
    for (const [index, etape] of ETAPES_SERIE.entries()) {
      if (coherents[etape] !== undefined) {
        dernierRealise = index;
      }
    }
  }
  let emplacements: readonly EmplacementConcerne[] | null = null;
  for (const [index, etape] of ETAPES_SERIE.entries()) {
    const date = dates[etape];
    if (index <= dernierRealise || date === undefined) {
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
      rangEtape: RANG_TRI[etape],
      idCible: serie.id,
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
  const fin = campagne.finRecoltePrevue;
  if (date === null || (fin !== null && jourAbsolu(fin) < fenetre.aujourdhui)) {
    return;
  }
  const jour = jourAbsolu(date);
  const retard = retardSiDansLaSemaine(jour, fenetre);
  if (retard === null) {
    return;
  }
  sortie.push({
    jour,
    rangEtape: RANG_TRI.debutRecolte,
    idCible: campagne.id,
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
 * du premier emplacement (ordre naturel, sans emplacement en dernier), par étape (arrachage
 * d'abord), puis par identifiant.
 *
 * - Seules les séries 'prevue' et 'en_cours' comptent.
 * - Une étape réalisée, ou antérieure à une étape réalisée, ne donne plus de tâche.
 * - Un réalisé d'une étape absente des dates prévues est ignoré.
 * - Campagne : plus listée une fois sa fin de récolte prévue passée.
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

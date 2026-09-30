/**
 * Semainier (T06) : ce qu'il y a à faire dans une semaine ISO, tiré du plan sans rien ressaisir.
 *
 * Fonction pure. Les dates d'une série sont recalées par ses réalisés (`appliquerRealises`, T02) ;
 * toute l'arithmétique passe par le jour absolu de `dates/`, sans objet `Date`.
 */
import { dateDepuisJourAbsolu, jourAbsolu, lundiDeSemaine } from '../dates/index.ts';
import type { DateCalendaire, SemaineIso } from '../dates/index.ts';
import { verifierExhaustif } from '../domaine/index.ts';
import type {
  CategorieIntervention,
  CultureConcernee,
  DatesPrevuesSerie,
  EtapeRealisee,
  Id,
  ModeItineraire,
  StatutSerie,
  TailleSerie,
  TravailPrevu,
} from '../domaine/index.ts';
import { ETAPES_SERIE, appliquerRealises } from './dates-serie.ts';
import type { DatesSerie, EtapeSerie, RealisesSerie } from './dates-serie.ts';
import { etapeDuRepere, joursTravailPrevu, tempsEstimeMinutes } from './travaux.ts';

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
  /** T22 : travaux prévus de l'instantané de la série ; absente = aucun. */
  readonly travauxPrevus?: readonly TravailPrevu[];
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
  /**
   * T22 : événements « intervention » en vigueur de chaque série (corrections et annulations
   * déjà appliquées par l'appelant) ; absente = aucune.
   */
  readonly interventions?: ReadonlyMap<Id<'Serie'>, readonly InterventionRealisee[]>;
}

/** Intervention réalisée sur une série : ce qui solde un travail prévu du même type. */
export interface InterventionRealisee {
  readonly date: DateCalendaire;
  readonly categorie: CategorieIntervention;
  /** Libellé du type, comparé au texte près au type du travail prévu. */
  readonly type: string;
}

export type EtapeTache = EtapeRealisee | 'debut_recolte';

/** Tâche d'une étape de série ou de campagne (T06). */
export interface TacheEtape {
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

/** Travail prévu d'une tâche : le travail de l'instantané et sa position dans `travauxPrevus`. */
export type TravailDeTache = TravailPrevu & { readonly indice: number };

/** Tâche d'un travail prévu d'itinéraire (T22) : mêmes champs qu'une étape de série. */
export interface TacheTravail {
  readonly etape: 'travail';
  readonly cible: CultureConcernee;
  readonly culture: string;
  readonly variete: string | null;
  /** Les planches de la série, triées par zone puis par code. */
  readonly emplacements: readonly EmplacementConcerne[];
  readonly taille: TailleSerie;
  /** Date de l'occurrence (dates de la série recalées par les réalisés). */
  readonly datePrevue: DateCalendaire;
  readonly enRetard: boolean;
  readonly joursDeRetard: number;
  readonly travail: TravailDeTache;
  /** Temps estimé pour la série, en minutes ; `null` sans estimation. */
  readonly tempsEstimeMinutes: number | null;
}

export type TacheSemainier = TacheEtape | TacheTravail;

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

/**
 * Rang d'un travail prévu à date et emplacement égaux : après l'arrachage, avant le semis et la
 * plantation (on prépare la planche avant de semer).
 */
const RANG_TRAVAIL = 0.5;

/** Tâche en construction, avec ses clés de tri. */
interface Candidate {
  readonly tache: TacheSemainier;
  readonly jour: number;
  readonly rangEtape: number;
  /** Identifiant de la série ou de la campagne. */
  readonly idCible: string;
  /** Indice du travail prévu (0 pour une étape) : départage final. */
  readonly indice: number;
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
  if (a.idCible !== b.idCible) return a.idCible < b.idCible ? -1 : 1;
  return a.indice - b.indice;
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

/** Emplacements distincts (par identifiant). */
function nombreDistincts(emplacements: readonly EmplacementConcerne[]): number {
  if (emplacements.length < 2) return emplacements.length;
  return new Set(emplacements.map((e) => e.id)).size;
}

/**
 * Nombre d'occurrences de `jours` soldées par les interventions : chacune solde l'occurrence la
 * plus proche de sa date (à égalité, la plus ancienne) et toutes les précédentes (Q11).
 */
function occurrencesSoldees(jours: readonly number[], travail: TravailPrevu, interventions: readonly InterventionRealisee[]): number {
  let soldees = 0;
  for (const i of interventions) {
    if (i.categorie !== travail.categorie || i.type !== travail.type) continue;
    const jour = jourAbsolu(i.date);
    // Première occurrence au jour de l'intervention ou après (recherche dichotomique).
    let bas = 0;
    let haut = jours.length;
    while (bas < haut) {
      const milieu = (bas + haut) >>> 1;
      if ((jours[milieu] ?? 0) < jour) bas = milieu + 1;
      else haut = milieu;
    }
    const apres = jours[bas];
    const avant = jours[bas - 1];
    let plusProche = bas;
    if (apres === undefined || (avant !== undefined && jour - avant <= apres - jour)) plusProche = bas - 1;
    if (plusProche + 1 > soldees) soldees = plusProche + 1;
  }
  return soldees;
}

/**
 * Tâches des travaux prévus d'une série (T22). `dates` : recalées par les réalisés ;
 * `dernierRealise` : index (ETAPES_SERIE) de la dernière étape réalisée, −1 sans réalisé.
 */
function ajouterTravaux(
  serie: SerieSemainier,
  travaux: readonly TravailPrevu[],
  dates: DatesSerie,
  dernierRealise: number,
  interventions: readonly InterventionRealisee[],
  fenetre: Fenetre,
  emplacementsTries: () => readonly EmplacementConcerne[],
  sortie: Candidate[],
): void {
  for (const [indice, travail] of travaux.entries()) {
    const jours = joursTravailPrevu(travail, dates);
    if (jours.length === 0) continue;
    let premiere = interventions.length === 0 ? 0 : occurrencesSoldees(jours, travail, interventions);
    // Caducité (Q23) : l'étape repère réalisée (ou rendue faite par une étape postérieure, Q11)
    // efface les occurrences datées avant elle, même sans intervention.
    const etapeRepere = etapeDuRepere(travail.repere);
    const repere = dates[etapeRepere];
    if (repere !== undefined && ETAPES_SERIE.indexOf(etapeRepere) <= dernierRealise) {
      const jourRepere = jourAbsolu(repere);
      while (premiere < jours.length && (jours[premiere] ?? 0) < jourRepere) premiere++;
    }
    let retardRetenu: { jour: number; retard: number } | null = null;
    const semaine: { jour: number; retard: number }[] = [];
    for (let k = premiere; k < jours.length; k++) {
      const jour = jours[k] ?? 0;
      if (jour > fenetre.dimanche) break;
      const retard = retardSiDansLaSemaine(jour, fenetre);
      if (retard === null) continue;
      // Une seule ligne en retard par travail : la plus récente (les dates sont croissantes).
      if (retard > 0) retardRetenu = { jour, retard };
      else semaine.push({ jour, retard });
    }
    const occurrences = retardRetenu === null ? semaine : [retardRetenu, ...semaine];
    if (occurrences.length === 0) continue;
    const tempsMinutes = tempsEstimeMinutes(travail.tempsEstime, { taille: serie.taille, nombreEmplacements: nombreDistincts(serie.emplacements) });
    const travailDeTache: TravailDeTache = { ...travail, indice };
    for (const { jour, retard } of occurrences) {
      sortie.push({
        jour,
        rangEtape: RANG_TRAVAIL,
        idCible: serie.id,
        indice,
        tache: {
          etape: 'travail',
          cible: { sorte: 'serie', serieId: serie.id },
          culture: serie.culture,
          variete: serie.variete,
          emplacements: emplacementsTries(),
          taille: serie.taille,
          datePrevue: dateDepuisJourAbsolu(jour),
          enRetard: retard > 0,
          joursDeRetard: retard,
          travail: travailDeTache,
          tempsEstimeMinutes: tempsMinutes,
        },
      });
    }
  }
}

function ajouterSerie(
  serie: SerieSemainier,
  realises: RealisesSerie | undefined,
  interventions: readonly InterventionRealisee[],
  fenetre: Fenetre,
  sortie: Candidate[],
): void {
  const prevues = serie.datesPrevues;
  const coherents = realises === undefined ? undefined : realisesCoherents(prevues, realises);
  const dates = coherents === undefined ? prevues : appliquerRealises(prevues, coherents);
  // Q11 : une étape réalisée vaut pour toutes les étapes antérieures.
  let dernierRealise = -1;
  if (coherents !== undefined) {
    for (const [index, etape] of ETAPES_SERIE.entries()) {
      if (coherents[etape] !== undefined) {
        dernierRealise = index;
      }
    }
  }
  let emplacements: readonly EmplacementConcerne[] | null = null;
  // Q12 : une seule ligne en retard par série, la première rencontrée (étapes en ordre chronologique).
  let retardListe = false;
  for (const [index, etape] of ETAPES_SERIE.entries()) {
    const date = dates[etape];
    if (index <= dernierRealise || date === undefined) {
      continue;
    }
    const jour = jourAbsolu(date);
    const retard = retardSiDansLaSemaine(jour, fenetre);
    if (retard === null || (retard > 0 && retardListe)) {
      continue;
    }
    retardListe ||= retard > 0;
    emplacements ??= trierEmplacements(serie.emplacements);
    sortie.push({
      jour,
      rangEtape: RANG_TRI[etape],
      idCible: serie.id,
      indice: 0,
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
  const travaux = serie.travauxPrevus;
  if (travaux !== undefined && travaux.length > 0) {
    const tries = () => (emplacements ??= trierEmplacements(serie.emplacements));
    ajouterTravaux(serie, travaux, dates, dernierRealise, interventions, fenetre, tries, sortie);
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
    indice: 0,
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
 * - Une seule tâche en retard par série (Q12) : la plus ancienne étape non faite. Les tâches de
 *   la semaine pas encore en retard restent listées.
 * - T22 : les travaux prévus d'une série deviennent des tâches 'travail' (dates de
 *   `datesTravailPrevu` sur les dates recalées), soldées par une intervention du même type sur
 *   la série (l'occurrence la plus proche et les précédentes), caduques avant leur repère une
 *   fois celui-ci réalisé (Q23) ; une seule ligne en retard par travail, la plus récente, hors
 *   de la règle Q12 des étapes.
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
  const aucune: readonly InterventionRealisee[] = [];
  for (const serie of series) {
    if (serie.statut === 'prevue' || serie.statut === 'en_cours') {
      ajouterSerie(serie, realises.series.get(serie.id), realises.interventions?.get(serie.id) ?? aucune, fenetre, candidates);
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

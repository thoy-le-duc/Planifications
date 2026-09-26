/**
 * Alertes de rotation (T04) : ne pas remettre une famille trop tôt au même endroit.
 *
 * L'historique d'un emplacement E réunit ses occupations passées, celles des emplacements qu'il
 * remplace (de proche en proche), et l'assolement passé posé sur ces emplacements, sur la zone
 * de E ou sur ses zones parentes. Fonctions pures : aucune donnée lue ailleurs.
 */
import { ajouterJours } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import type {
  Assolement,
  CibleAssolement,
  DelaisRetour,
  Emplacement,
  Espece,
  Famille,
  Id,
  Occupation,
  Saison,
  Zone,
} from '../domaine/index.ts';
import { periodeOccupation } from './occupations.ts';

export type NiveauAlerteRotation = 'rouge' | 'orange';

/** Culture à placer ; `famille` est celle de l'espèce, ou `null` si l'appelant ne la connaît pas. */
export interface CulturePrevue {
  readonly espece: Pick<Espece, 'id' | 'familleId' | 'delaisRetour'>;
  readonly famille: Pick<Famille, 'id' | 'delaiRetourMinimalAns' | 'delaiRetourConseilleAns'> | null;
}

export interface OccupationHistorique {
  readonly occupation: Pick<Occupation, 'id' | 'emplacementId' | 'prevuDu' | 'prevuAu' | 'reel' | 'supprimeLe'>;
  /** Espèce de l'occupant (série ou plantation). */
  readonly especeId: Id<'Espece'>;
  /** Famille de cette espèce. */
  readonly familleId: Id<'Famille'>;
}

export interface HistoriqueRotation {
  readonly occupations: readonly OccupationHistorique[];
  /** Toutes natures ; l'assolement prévu est ignoré. */
  readonly assolements: readonly Assolement[];
  readonly saisons: readonly Pick<Saison, 'id' | 'fin'>[];
}

type EmplacementParcellaire = Pick<Emplacement, 'id' | 'zoneId' | 'remplace'>;

export interface HierarchieParcellaire {
  readonly zones: readonly Pick<Zone, 'id' | 'zoneParenteId'>[];
  readonly emplacements: readonly EmplacementParcellaire[];
}

export type SourceLigneRotation =
  | { readonly sorte: 'occupation'; readonly occupationId: Id<'Occupation'> }
  | { readonly sorte: 'assolement'; readonly assolementId: Id<'Assolement'> };

export interface LigneEnCause {
  readonly niveau: NiveauAlerteRotation;
  readonly source: SourceLigneRotation;
  readonly culture: { readonly familleId: Id<'Famille'>; readonly especeId: Id<'Espece'> | null };
  /** Année retenue pour la ligne : dernier jour occupé, ou fin de la saison. */
  readonly annee: number;
  /** anneeMiseEnPlace − annee, toujours ≥ 0. */
  readonly ecartAns: number;
  readonly lieu: CibleAssolement;
}

export interface AlerteRotation {
  /** Le plus grave de ses lignes. */
  readonly niveau: NiveauAlerteRotation;
  readonly delais: DelaisRetour;
  readonly origineDelais: 'espece' | 'famille';
  /** Jamais vide, la plus grave d'abord. */
  readonly lignes: readonly LigneEnCause[];
}

/** Ligne d'historique retenue, avant le calcul du niveau. */
type LigneRetenue = Omit<LigneEnCause, 'niveau' | 'ecartAns'>;

interface LieuxRetenus {
  readonly emplacements: ReadonlySet<Id<'Emplacement'>>;
  readonly zones: ReadonlySet<Id<'Zone'>>;
}

/** Année civile d'une date 'AAAA-MM-JJ'. */
function anneeDe(date: DateCalendaire): number {
  return Number(date.slice(0, 4));
}

/** Délais de l'espèce s'ils sont remplis, sinon ceux de la famille ; `null` si aucun. */
function delaisApplicables(
  culture: CulturePrevue,
): { readonly delais: DelaisRetour; readonly origine: AlerteRotation['origineDelais'] } | null {
  if (culture.espece.delaisRetour !== null) {
    return { delais: culture.espece.delaisRetour, origine: 'espece' };
  }
  if (culture.famille === null) {
    return null;
  }
  const { delaiRetourMinimalAns, delaiRetourConseilleAns } = culture.famille;
  return { delais: { minimalAns: delaiRetourMinimalAns, conseilleAns: delaiRetourConseilleAns }, origine: 'famille' };
}

/** E puis les emplacements qu'il remplace, de proche en proche ; chaque sommet une seule fois. */
function emplacementsRetenus(
  emplacement: EmplacementParcellaire,
  hierarchie: HierarchieParcellaire,
): ReadonlySet<Id<'Emplacement'>> {
  const parId = new Map(hierarchie.emplacements.map((e) => [e.id, e]));
  const visites = new Set<Id<'Emplacement'>>([emplacement.id]);
  const aVisiter = [...emplacement.remplace];
  for (let suivant = aVisiter.shift(); suivant !== undefined; suivant = aVisiter.shift()) {
    if (!visites.has(suivant)) {
      visites.add(suivant);
      aVisiter.push(...(parId.get(suivant)?.remplace ?? []));
    }
  }
  return visites;
}

/** La zone de E puis ses parentes jusqu'à la racine ; s'arrête sur un cycle ou une zone inconnue. */
function zonesRetenues(emplacement: EmplacementParcellaire, hierarchie: HierarchieParcellaire): ReadonlySet<Id<'Zone'>> {
  const parentes = new Map(hierarchie.zones.map((z) => [z.id, z.zoneParenteId]));
  const visites = new Set<Id<'Zone'>>();
  let zone: Id<'Zone'> | null = emplacement.zoneId;
  while (zone !== null && !visites.has(zone)) {
    visites.add(zone);
    zone = parentes.get(zone) ?? null;
  }
  return visites;
}

/**
 * Année d'une occupation : celle de son dernier jour occupé, ramenée à l'année prévue si la
 * culture est encore en place ; `null` si elle commence après l'année prévue.
 */
function anneeOccupation(occupation: OccupationHistorique['occupation'], anneeMiseEnPlace: number): number | null {
  const periode = periodeOccupation(occupation);
  if (anneeDe(periode.du) > anneeMiseEnPlace) {
    return null;
  }
  if (periode.au === null) {
    return anneeMiseEnPlace;
  }
  return Math.min(anneeDe(ajouterJours(periode.au, -1)), anneeMiseEnPlace);
}

function lignesOccupations(
  historique: HistoriqueRotation,
  familleId: Id<'Famille'>,
  lieux: LieuxRetenus,
  anneeMiseEnPlace: number,
): LigneRetenue[] {
  return historique.occupations.flatMap(({ occupation, especeId, familleId: familleLigne }) => {
    if (occupation.supprimeLe !== null || familleLigne !== familleId || !lieux.emplacements.has(occupation.emplacementId)) {
      return [];
    }
    const annee = anneeOccupation(occupation, anneeMiseEnPlace);
    if (annee === null) {
      return [];
    }
    return [
      {
        source: { sorte: 'occupation', occupationId: occupation.id },
        culture: { familleId: familleLigne, especeId },
        annee,
        lieu: { sorte: 'emplacement', emplacementId: occupation.emplacementId },
      },
    ];
  });
}

function cibleRetenue(cible: CibleAssolement, lieux: LieuxRetenus): boolean {
  return cible.sorte === 'zone' ? lieux.zones.has(cible.zoneId) : lieux.emplacements.has(cible.emplacementId);
}

function lignesAssolements(
  historique: HistoriqueRotation,
  familleId: Id<'Famille'>,
  lieux: LieuxRetenus,
  anneeMiseEnPlace: number,
): LigneRetenue[] {
  const finsSaisons = new Map(historique.saisons.map((s) => [s.id, s.fin]));
  return historique.assolements.flatMap((ligne) => {
    const fin = finsSaisons.get(ligne.saisonId);
    if (
      ligne.nature === 'prevu' ||
      ligne.supprimeLe !== null ||
      ligne.familleId !== familleId ||
      fin === undefined ||
      anneeDe(fin) > anneeMiseEnPlace ||
      !cibleRetenue(ligne.cible, lieux)
    ) {
      return [];
    }
    return [
      {
        source: { sorte: 'assolement', assolementId: ligne.id },
        culture: { familleId: ligne.familleId, especeId: ligne.especeId },
        annee: anneeDe(fin),
        lieu: ligne.cible,
      },
    ];
  });
}

function niveauPourEcart(ecartAns: number, delais: DelaisRetour): NiveauAlerteRotation | null {
  if (ecartAns < delais.minimalAns) {
    return 'rouge';
  }
  return ecartAns < delais.conseilleAns ? 'orange' : null;
}

function idSource(source: SourceLigneRotation): string {
  return source.sorte === 'occupation' ? source.occupationId : source.assolementId;
}

const RANG_NIVEAU: Readonly<Record<NiveauAlerteRotation, number>> = { rouge: 0, orange: 1 };
const RANG_SORTE: Readonly<Record<SourceLigneRotation['sorte'], number>> = { occupation: 0, assolement: 1 };

/** Rouge avant orange, puis la plus récente, puis occupations avant assolements, puis id. */
function comparerLignes(a: LigneEnCause, b: LigneEnCause): number {
  const idA = idSource(a.source);
  const idB = idSource(b.source);
  return (
    RANG_NIVEAU[a.niveau] - RANG_NIVEAU[b.niveau] ||
    a.ecartAns - b.ecartAns ||
    RANG_SORTE[a.source.sorte] - RANG_SORTE[b.source.sorte] ||
    (idA < idB ? -1 : idA > idB ? 1 : 0)
  );
}

/**
 * Alertes de rotation pour `culturePrevue` mise en place sur `emplacement` l'année
 * `anneeMiseEnPlace` : [] ou une seule alerte regroupant toutes les lignes en cause.
 * RangeError si l'année n'est pas un entier.
 */
export function alertesRotation(
  culturePrevue: CulturePrevue,
  emplacement: EmplacementParcellaire,
  anneeMiseEnPlace: number,
  historique: HistoriqueRotation,
  hierarchie: HierarchieParcellaire,
): readonly AlerteRotation[] {
  if (!Number.isInteger(anneeMiseEnPlace)) {
    throw new RangeError(`l'année de mise en place doit être un entier : ${String(anneeMiseEnPlace)}`);
  }
  const applicables = delaisApplicables(culturePrevue);
  if (applicables === null) {
    return [];
  }
  const { delais, origine } = applicables;
  const familleId = culturePrevue.espece.familleId;
  const lieux: LieuxRetenus = {
    emplacements: emplacementsRetenus(emplacement, hierarchie),
    zones: zonesRetenues(emplacement, hierarchie),
  };
  const lignes = [
    ...lignesOccupations(historique, familleId, lieux, anneeMiseEnPlace),
    ...lignesAssolements(historique, familleId, lieux, anneeMiseEnPlace),
  ]
    .flatMap((ligne): LigneEnCause[] => {
      const ecartAns = anneeMiseEnPlace - ligne.annee;
      const niveau = niveauPourEcart(ecartAns, delais);
      return niveau === null ? [] : [{ niveau, ...ligne, ecartAns }];
    })
    .sort(comparerLignes);
  const [plusGrave] = lignes;
  if (plusGrave === undefined) {
    return [];
  }
  return [{ niveau: plusGrave.niveau, delais, origineDelais: origine, lignes }];
}

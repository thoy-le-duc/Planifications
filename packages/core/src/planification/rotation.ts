/**
 * Alertes de rotation (T04) : ne pas remettre une famille trop tôt au même endroit.
 *
 * L'historique d'un emplacement E réunit ses occupations passées, celles des emplacements qu'il
 * remplace (de proche en proche), et l'assolement passé posé sur ces emplacements, sur leurs
 * zones ou sur les zones parentes de celles-ci. Fonctions pures : aucune donnée lue ailleurs.
 *
 * Hors-sol (T04b) : un emplacement est hors-sol s'il est une gouttière, ou si sa zone directe a
 * l'abri `hors_sol`. Pas de sol, pas de fatigue de sol : aucune alerte sur un emplacement
 * hors-sol, et une culture passée en hors-sol ne compte jamais dans l'historique.
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
  SorteEmplacement,
  TypeAbri,
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

/** `sorte` absente : traité comme une planche ou un rang (pleine terre). */
type EmplacementParcellaire = Pick<Emplacement, 'id' | 'zoneId' | 'remplace'> & { readonly sorte?: SorteEmplacement };

/** `typeAbri` absent : abri inconnu, traité comme de la pleine terre. */
type ZoneParcellaire = Pick<Zone, 'id' | 'zoneParenteId'> & { readonly typeAbri?: TypeAbri };

export interface HierarchieParcellaire {
  readonly zones: readonly ZoneParcellaire[];
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

interface DelaisApplicables {
  readonly delais: DelaisRetour;
  readonly origine: AlerteRotation['origineDelais'];
}

/** Délais de l'espèce s'ils sont remplis, sinon ceux de la famille ; `null` si aucun. */
function choisirDelais(culture: CulturePrevue): DelaisApplicables | null {
  if (culture.espece.delaisRetour !== null) {
    return { delais: culture.espece.delaisRetour, origine: 'espece' };
  }
  if (culture.famille === null) {
    return null;
  }
  const { delaiRetourMinimalAns, delaiRetourConseilleAns } = culture.famille;
  return { delais: { minimalAns: delaiRetourMinimalAns, conseilleAns: delaiRetourConseilleAns }, origine: 'famille' };
}

/**
 * Délais applicables, après contrôle de la culture prévue. RangeError si la famille fournie
 * n'est pas celle de l'espèce, ou si les délais retenus ont un minimal supérieur au conseillé.
 */
function delaisApplicables(culture: CulturePrevue): DelaisApplicables | null {
  if (culture.famille !== null && culture.famille.id !== culture.espece.familleId) {
    throw new RangeError(
      `la famille ${culture.famille.id} n'est pas celle de l'espèce ${culture.espece.id} (${culture.espece.familleId})`,
    );
  }
  const applicables = choisirDelais(culture);
  if (applicables !== null && applicables.delais.minimalAns > applicables.delais.conseilleAns) {
    const { minimalAns, conseilleAns } = applicables.delais;
    throw new RangeError(
      `délais de retour incohérents (${applicables.origine}) : minimal ${String(minimalAns)} an(s) > conseillé ${String(conseilleAns)} an(s)`,
    );
  }
  return applicables;
}

/** Zone d'abri `hors_sol`, d'après la hiérarchie ; zone inconnue ou abri absent : non. */
function zoneHorsSol(zoneId: Id<'Zone'>, abris: ReadonlyMap<Id<'Zone'>, TypeAbri | undefined>): boolean {
  return abris.get(zoneId) === 'hors_sol';
}

/** Gouttière, ou emplacement dont la zone directe a l'abri `hors_sol`. */
function emplacementHorsSol(
  emplacement: EmplacementParcellaire,
  abris: ReadonlyMap<Id<'Zone'>, TypeAbri | undefined>,
): boolean {
  return emplacement.sorte === 'gouttiere' || zoneHorsSol(emplacement.zoneId, abris);
}

/** E puis les emplacements qu'il remplace, de proche en proche ; chaque sommet une seule fois. */
function emplacementsRetenus(
  emplacement: EmplacementParcellaire,
  parId: ReadonlyMap<Id<'Emplacement'>, EmplacementParcellaire>,
): ReadonlySet<Id<'Emplacement'>> {
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

/** Les zones de départ puis toutes leurs parentes ; s'arrête sur un cycle ou une zone inconnue. */
function zonesRetenues(
  depart: readonly Id<'Zone'>[],
  hierarchie: HierarchieParcellaire,
): ReadonlySet<Id<'Zone'>> {
  const parentes = new Map(hierarchie.zones.map((z) => [z.id, z.zoneParenteId]));
  const visites = new Set<Id<'Zone'>>();
  for (const zoneDepart of depart) {
    let zone: Id<'Zone'> | null = zoneDepart;
    while (zone !== null && !visites.has(zone)) {
      visites.add(zone);
      zone = parentes.get(zone) ?? null;
    }
  }
  return visites;
}

/**
 * Lieux de E : E et les emplacements qu'il remplace ; la zone de E et celles des emplacements
 * remplacés connus (c'est le même sol), avec toutes leurs parentes. Les emplacements remplacés
 * hors-sol sont écartés, avec leur zone : leurs cultures n'ont pas touché le sol. Les zones
 * d'abri `hors_sol` sont écartées aussi (pas d'assolement qui compte sur elles).
 */
function lieuxRetenus(
  emplacement: EmplacementParcellaire,
  hierarchie: HierarchieParcellaire,
  abris: ReadonlyMap<Id<'Zone'>, TypeAbri | undefined>,
): LieuxRetenus {
  const parId = new Map(hierarchie.emplacements.map((e) => [e.id, e]));
  const parcourus = emplacementsRetenus(emplacement, parId);
  const emplacements = new Set<Id<'Emplacement'>>();
  const zonesRemplacees: Id<'Zone'>[] = [];
  for (const id of parcourus) {
    const connu = id === emplacement.id ? emplacement : parId.get(id);
    if (connu === undefined) {
      emplacements.add(id);
    } else if (!emplacementHorsSol(connu, abris)) {
      emplacements.add(id);
      zonesRemplacees.push(connu.zoneId);
    }
  }
  const zones = new Set([...zonesRetenues(zonesRemplacees, hierarchie)].filter((z) => !zoneHorsSol(z, abris)));
  return { emplacements, zones };
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
  exclure: ReadonlySet<Id<'Occupation'>>,
): LigneRetenue[] {
  return historique.occupations.flatMap(({ occupation, especeId, familleId: familleLigne }) => {
    if (
      occupation.supprimeLe !== null ||
      exclure.has(occupation.id) ||
      familleLigne !== familleId ||
      !lieux.emplacements.has(occupation.emplacementId)
    ) {
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
 * `anneeMiseEnPlace` (année civile de sa mise en place prévue) : [] ou une seule alerte
 * regroupant toutes les lignes en cause. `exclure` : occupations à ne pas compter, typiquement
 * celles de la culture revérifiée, pour ne pas la comparer à elle-même.
 * RangeError si l'année n'est pas un entier, ou si la culture prévue est incohérente.
 */
export function alertesRotation(
  culturePrevue: CulturePrevue,
  emplacement: EmplacementParcellaire,
  anneeMiseEnPlace: number,
  historique: HistoriqueRotation,
  hierarchie: HierarchieParcellaire,
  exclure: ReadonlySet<Id<'Occupation'>> = new Set(),
): readonly AlerteRotation[] {
  if (!Number.isInteger(anneeMiseEnPlace)) {
    throw new RangeError(`l'année de mise en place doit être un entier : ${String(anneeMiseEnPlace)}`);
  }
  const applicables = delaisApplicables(culturePrevue);
  if (applicables === null) {
    return [];
  }
  const { delais, origine } = applicables;
  const abris = new Map(hierarchie.zones.map((z) => [z.id, z.typeAbri]));
  if (emplacementHorsSol(emplacement, abris)) {
    return [];
  }
  const familleId = culturePrevue.espece.familleId;
  const lieux = lieuxRetenus(emplacement, hierarchie, abris);
  const lignes = [
    ...lignesOccupations(historique, familleId, lieux, anneeMiseEnPlace, exclure),
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

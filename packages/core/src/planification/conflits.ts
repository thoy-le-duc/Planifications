/**
 * Conflits de place sur un emplacement (T03) : chevauchement de tronçons, surcharge de longueur
 * ou de places, occupation hors de la période active de l'emplacement.
 *
 * Tout se calcule en entiers : jours absolus pour le temps, centimètres (ou places) pour l'espace.
 * Le temps est parcouru par balayage des débuts et fins triés : entre deux événements, l'ensemble
 * des occupations présentes ne change pas, on l'examine une fois par tranche.
 */
import { dateDepuisJourAbsolu, jourAbsolu } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import { verifierExhaustif } from '../domaine/index.ts';
import type { Emplacement, Id, Occupation, PlaceOccupee } from '../domaine/index.ts';
import { DATE_SANS_FIN, periodeOccupation } from './occupations.ts';

export type SorteConflit = 'chevauchement' | 'surcharge' | 'emplacement_inactif';

export interface Conflit {
  readonly sorte: SorteConflit;
  readonly emplacementId: Id<'Emplacement'>;
  /** Occupations en cause, dans l'ordre de la liste d'entrée. */
  readonly occupations: readonly Id<'Occupation'>[];
  /** Début du recouvrement. */
  readonly du: DateCalendaire;
  /** Jour où il cesse ; `null` = sans fin. */
  readonly au: DateCalendaire | null;
}

const RANG_SORTE: Readonly<Record<SorteConflit, number>> = { chevauchement: 0, surcharge: 1, emplacement_inactif: 2 };

/** Jour absolu de DATE_SANS_FIN : la fin « infinie », en entier. */
const JOUR_SANS_FIN = jourAbsolu(DATE_SANS_FIN);

/** Occupation ramenée à des entiers ; `rang` = position dans la liste d'entrée. */
interface Segment {
  readonly rang: number;
  readonly id: Id<'Occupation'>;
  readonly debut: number;
  readonly fin: number;
  readonly quantite: number;
  /** Début du tronçon en centimètres, `null` sans position. */
  readonly positionCm: number | null;
}

/** Conflit en cours de construction, en entiers. */
interface ConflitBrut {
  readonly sorte: SorteConflit;
  readonly debut: number;
  fin: number;
  readonly rangs: Set<number>;
}

function centimetres(metres: number): number {
  return Math.round(metres * 100);
}

/** Place en unités entières : centimètres ou places. */
function quantite(place: PlaceOccupee): number {
  switch (place.unite) {
    case 'longueur':
      return centimetres(place.longueurM);
    case 'places':
      return place.nombrePlaces;
    default:
      return verifierExhaustif(place);
  }
}

function capacite(emplacement: Emplacement): number {
  return emplacement.sorte === 'gouttiere' ? emplacement.nombrePlaces : centimetres(emplacement.longueurM);
}

function versSegment(occupation: Occupation, rang: number): Segment {
  const periode = periodeOccupation(occupation);
  return {
    rang,
    id: occupation.id,
    debut: jourAbsolu(periode.du),
    fin: periode.au === null ? JOUR_SANS_FIN : jourAbsolu(periode.au),
    quantite: quantite(occupation.place),
    positionCm: occupation.positionM === null ? null : centimetres(occupation.positionM),
  };
}

/** Segments de cet emplacement, non supprimés et de durée non nulle. */
function segmentsDe(emplacement: Emplacement, occupations: readonly Occupation[]): Segment[] {
  const segments: Segment[] = [];
  occupations.forEach((occupation, rang) => {
    if (occupation.emplacementId === emplacement.id && occupation.supprimeLe === null) {
      const segment = versSegment(occupation, rang);
      if (segment.debut < segment.fin) {
        segments.push(segment);
      }
    }
  });
  return segments;
}

/**
 * Tronçons positionnés qui en recouvrent au moins un autre. Triés par début, les tronçons forment
 * des grappes (chaque début avant la fin la plus lointaine déjà vue) : tout membre d'une grappe
 * d'au moins deux tronçons en recouvre un autre, et réciproquement.
 */
function tronconsEnRecouvrement(presents: readonly Segment[]): Segment[] {
  const troncons = presents
    .filter((s) => s.positionCm !== null && s.quantite > 0)
    .sort((a, b) => (a.positionCm ?? 0) - (b.positionCm ?? 0));
  const enCause: Segment[] = [];
  let grappe: Segment[] = [];
  let finGrappe = Number.NEGATIVE_INFINITY;
  const clore = (): void => {
    if (grappe.length > 1) {
      enCause.push(...grappe);
    }
  };
  for (const troncon of troncons) {
    const debut = troncon.positionCm ?? 0;
    if (debut >= finGrappe) {
      clore();
      grappe = [];
    }
    grappe.push(troncon);
    finGrappe = Math.max(finGrappe, debut + troncon.quantite);
  }
  clore();
  return enCause;
}

/** Occupations en cause pendant une tranche où l'ensemble des présents est fixe. */
function enCauseDansTranche(presents: readonly Segment[], capaciteMax: number): Map<SorteConflit, readonly Segment[]> {
  const resultat = new Map<SorteConflit, readonly Segment[]>();
  const chevauchants = tronconsEnRecouvrement(presents);
  if (chevauchants.length > 0) {
    resultat.set('chevauchement', chevauchants);
  }
  const total = presents.reduce((somme, s) => somme + s.quantite, 0);
  if (presents.some((s) => s.positionCm === null) && total > capaciteMax) {
    resultat.set('surcharge', presents);
  }
  return resultat;
}

/** Jours où l'ensemble des présents change, triés. */
function joursDeBascule(segments: readonly Segment[]): number[] {
  const jours = new Set<number>();
  for (const s of segments) {
    jours.add(s.debut);
    jours.add(s.fin);
  }
  return [...jours].sort((a, b) => a - b);
}

/**
 * Balayage du temps : débuts et fins triés par jour, les fins traitées avant les débuts du même
 * jour (intervalles [du, au[). Les tranches en conflit qui se suivent, pour une même sorte, sont
 * fusionnées.
 */
function conflitsDePlace(segments: readonly Segment[], capaciteMax: number): ConflitBrut[] {
  const parDebut = [...segments].sort((a, b) => a.debut - b.debut);
  const jours = joursDeBascule(segments);
  const bruts: ConflitBrut[] = [];
  const ouverts = new Map<SorteConflit, ConflitBrut>();
  let presents: Segment[] = [];
  let prochain = 0;
  for (const [i, jour] of jours.entries()) {
    const suivant = jours[i + 1];
    if (suivant === undefined) {
      break;
    }
    presents = presents.filter((s) => s.fin > jour);
    for (let entrant = parDebut[prochain]; entrant !== undefined && entrant.debut <= jour; entrant = parDebut[prochain]) {
      presents.push(entrant);
      prochain += 1;
    }
    for (const [sorte, enCause] of enCauseDansTranche(presents, capaciteMax)) {
      const ouvert = ouverts.get(sorte);
      if (ouvert?.fin === jour) {
        ouvert.fin = suivant;
        enCause.forEach((s) => ouvert.rangs.add(s.rang));
      } else {
        const nouveau: ConflitBrut = { sorte, debut: jour, fin: suivant, rangs: new Set(enCause.map((s) => s.rang)) };
        bruts.push(nouveau);
        ouverts.set(sorte, nouveau);
      }
    }
  }
  return bruts;
}

/** Parties d'occupation hors de [actifDu, actifAu[ : un conflit par côté qui déborde. */
function conflitsInactifs(emplacement: Emplacement, segments: readonly Segment[]): ConflitBrut[] {
  const actifDu = jourAbsolu(emplacement.actifDu);
  const actifAu = emplacement.actifAu === null ? null : jourAbsolu(emplacement.actifAu);
  const bruts: ConflitBrut[] = [];
  for (const s of segments) {
    const rangs = new Set([s.rang]);
    if (s.debut < actifDu) {
      bruts.push({ sorte: 'emplacement_inactif', debut: s.debut, fin: Math.min(s.fin, actifDu), rangs });
    }
    if (actifAu !== null && s.fin > actifAu) {
      bruts.push({ sorte: 'emplacement_inactif', debut: Math.max(s.debut, actifAu), fin: s.fin, rangs });
    }
  }
  return bruts;
}

function premierRang(brut: ConflitBrut): number {
  return Math.min(...brut.rangs);
}

/** Ordre du résultat : début, puis sorte, puis rang de la première occupation en cause. */
function comparer(a: ConflitBrut, b: ConflitBrut): number {
  return a.debut - b.debut || RANG_SORTE[a.sorte] - RANG_SORTE[b.sorte] || premierRang(a) - premierRang(b);
}

function versConflit(emplacement: Emplacement, brut: ConflitBrut, ids: ReadonlyMap<number, Id<'Occupation'>>): Conflit {
  return {
    sorte: brut.sorte,
    emplacementId: emplacement.id,
    occupations: [...brut.rangs].sort((a, b) => a - b).flatMap((rang) => ids.get(rang) ?? []),
    du: dateDepuisJourAbsolu(brut.debut),
    au: brut.fin === JOUR_SANS_FIN ? null : dateDepuisJourAbsolu(brut.fin),
  };
}

/**
 * Conflits de place d'un emplacement. Seules comptent ses occupations non supprimées ; les dates
 * réelles priment sur les prévues. Résultat trié par date, sorte, puis ordre d'entrée.
 */
export function detecterConflits(emplacement: Emplacement, occupations: readonly Occupation[]): Conflit[] {
  const segments = segmentsDe(emplacement, occupations);
  const ids = new Map(segments.map((s) => [s.rang, s.id]));
  return [...conflitsDePlace(segments, capacite(emplacement)), ...conflitsInactifs(emplacement, segments)]
    .sort(comparer)
    .map((brut) => versConflit(emplacement, brut, ids));
}

/**
 * Conflits de place sur un emplacement (T03) : chevauchement de tronçons, surcharge de longueur
 * ou de places, tronçon qui dépasse l'emplacement, occupation hors de la période active de
 * l'emplacement, période inversée.
 *
 * Tout se calcule en entiers : jours absolus pour le temps, centimètres (ou places) pour l'espace.
 * Le temps est parcouru par balayage des débuts et fins triés : entre deux jours de bascule,
 * l'ensemble des occupations présentes ne change pas, on l'examine une fois par tranche.
 */
import { dateDepuisJourAbsolu, jourAbsolu } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import { verifierExhaustif } from '../domaine/index.ts';
import type { Emplacement, Id, Occupation, PlaceOccupee } from '../domaine/index.ts';
import { centimetres, DATE_SANS_FIN, periodeOccupation } from './occupations.ts';

export type SorteConflit = 'chevauchement' | 'surcharge' | 'depassement' | 'emplacement_inactif' | 'periode_invalide';

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

const RANG_SORTE: Readonly<Record<SorteConflit, number>> = {
  chevauchement: 0,
  surcharge: 1,
  depassement: 2,
  emplacement_inactif: 3,
  periode_invalide: 4,
};

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
  debut: number;
  fin: number;
  readonly rangs: Set<number>;
}

/** Occupations en cause ensemble pendant une tranche. */
interface Groupe {
  readonly sorte: SorteConflit;
  readonly segments: readonly Segment[];
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

function brut(sorte: SorteConflit, debut: number, fin: number, segments: readonly Segment[]): ConflitBrut {
  return { sorte, debut, fin, rangs: new Set(segments.map((s) => s.rang)) };
}

/**
 * Occupations de cet emplacement, non supprimées : les périodes valides deviennent des segments,
 * les périodes inversées des conflits 'periode_invalide' ; les périodes nulles sont ignorées.
 */
function trier(
  emplacement: Emplacement,
  occupations: readonly Occupation[],
): { readonly segments: Segment[]; readonly invalides: ConflitBrut[] } {
  const segments: Segment[] = [];
  const invalides: ConflitBrut[] = [];
  occupations.forEach((occupation, rang) => {
    if (occupation.emplacementId !== emplacement.id || occupation.supprimeLe !== null) {
      return;
    }
    const segment = versSegment(occupation, rang);
    if (segment.debut < segment.fin) {
      segments.push(segment);
    } else if (segment.debut > segment.fin) {
      invalides.push(brut('periode_invalide', segment.debut, segment.fin, [segment]));
    }
  });
  return { segments, invalides };
}

/**
 * Grappes de tronçons positionnés reliés par recouvrement. Triés par début, un tronçon rejoint la
 * grappe s'il commence avant la fin la plus lointaine déjà vue. Seules les grappes d'au moins deux
 * tronçons sont rendues : chacun de leurs membres en recouvre un autre.
 */
function grappesEnRecouvrement(presents: readonly Segment[]): Segment[][] {
  const troncons = presents
    .filter((s) => s.positionCm !== null && s.quantite > 0)
    .sort((a, b) => (a.positionCm ?? 0) - (b.positionCm ?? 0));
  const grappes: Segment[][] = [];
  let grappe: Segment[] = [];
  let finGrappe = Number.NEGATIVE_INFINITY;
  for (const troncon of troncons) {
    const debut = troncon.positionCm ?? 0;
    if (debut >= finGrappe) {
      grappe = [];
      grappes.push(grappe);
    }
    grappe.push(troncon);
    finGrappe = Math.max(finGrappe, debut + troncon.quantite);
  }
  return grappes.filter((g) => g.length > 1);
}

/** Groupes en conflit pendant une tranche où l'ensemble des présents est fixe. */
function groupesDeTranche(presents: readonly Segment[], capaciteMax: number): Groupe[] {
  const groupes: Groupe[] = grappesEnRecouvrement(presents).map((segments) => ({ sorte: 'chevauchement', segments }));
  const total = presents.reduce((somme, s) => somme + s.quantite, 0);
  if (presents.some((s) => s.positionCm === null) && total > capaciteMax) {
    groupes.push({ sorte: 'surcharge', segments: presents });
  }
  return groupes;
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
 * Rattache un groupe de la tranche [jour, suivant[ aux conflits de même sorte finis le `jour` et
 * qui partagent une de ses occupations : ils sont prolongés et fusionnés. Sans lien, nouveau
 * conflit. Les conflits fusionnés dans un autre vont dans `absorbes`.
 */
function rattacher(
  groupe: Groupe,
  candidats: readonly ConflitBrut[],
  absorbes: Set<ConflitBrut>,
  bruts: ConflitBrut[],
  suivant: number,
  jour: number,
): ConflitBrut {
  const lies = candidats.filter(
    (c) => c.sorte === groupe.sorte && !absorbes.has(c) && groupe.segments.some((s) => c.rangs.has(s.rang)),
  );
  const [cible, ...autres] = lies;
  if (cible === undefined) {
    const nouveau = brut(groupe.sorte, jour, suivant, groupe.segments);
    bruts.push(nouveau);
    return nouveau;
  }
  for (const autre of autres) {
    cible.debut = Math.min(cible.debut, autre.debut);
    autre.rangs.forEach((rang) => cible.rangs.add(rang));
    absorbes.add(autre);
  }
  groupe.segments.forEach((s) => cible.rangs.add(s.rang));
  cible.fin = suivant;
  return cible;
}

/**
 * Balayage du temps : à chaque jour de bascule, on retire les occupations finies et on ajoute
 * celles qui commencent (intervalles [du, au[), puis on examine la tranche jusqu'au jour suivant.
 */
function conflitsDePlace(segments: readonly Segment[], capaciteMax: number): ConflitBrut[] {
  const parDebut = [...segments].sort((a, b) => a.debut - b.debut);
  const jours = joursDeBascule(segments);
  const bruts: ConflitBrut[] = [];
  const absorbes = new Set<ConflitBrut>();
  let ouverts: ConflitBrut[] = [];
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
    const candidats = ouverts.filter((c) => c.fin === jour);
    ouverts = groupesDeTranche(presents, capaciteMax).map((groupe) =>
      rattacher(groupe, candidats, absorbes, bruts, suivant, jour),
    );
  }
  return bruts.filter((b) => !absorbes.has(b));
}

/** Tronçons positionnés qui sortent de l'emplacement : un conflit par occupation, toute sa période. */
function conflitsDepassement(segments: readonly Segment[], capaciteMax: number): ConflitBrut[] {
  return segments
    .filter((s) => s.positionCm !== null && s.positionCm + s.quantite > capaciteMax)
    .map((s) => brut('depassement', s.debut, s.fin, [s]));
}

/**
 * Parties d'occupation hors de [actifDu, actifAu[ : un conflit par côté qui déborde. Emplacement
 * en suppression douce : inactif partout, un conflit par occupation sur toute sa période.
 */
function conflitsInactifs(emplacement: Emplacement, segments: readonly Segment[]): ConflitBrut[] {
  if (emplacement.supprimeLe !== null) {
    return segments.map((s) => brut('emplacement_inactif', s.debut, s.fin, [s]));
  }
  const actifDu = jourAbsolu(emplacement.actifDu);
  const actifAu = emplacement.actifAu === null ? null : jourAbsolu(emplacement.actifAu);
  const bruts: ConflitBrut[] = [];
  for (const s of segments) {
    if (s.debut < actifDu) {
      bruts.push(brut('emplacement_inactif', s.debut, Math.min(s.fin, actifDu), [s]));
    }
    if (actifAu !== null && s.fin > actifAu) {
      bruts.push(brut('emplacement_inactif', Math.max(s.debut, actifAu), s.fin, [s]));
    }
  }
  return bruts;
}

function premierRang(conflit: ConflitBrut): number {
  return Math.min(...conflit.rangs);
}

/** Ordre du résultat : début, puis sorte, puis rang de la première occupation en cause. */
function comparer(a: ConflitBrut, b: ConflitBrut): number {
  return a.debut - b.debut || RANG_SORTE[a.sorte] - RANG_SORTE[b.sorte] || premierRang(a) - premierRang(b);
}

function versConflit(emplacement: Emplacement, conflit: ConflitBrut, ids: readonly Id<'Occupation'>[]): Conflit {
  return {
    sorte: conflit.sorte,
    emplacementId: emplacement.id,
    occupations: [...conflit.rangs].sort((a, b) => a - b).flatMap((rang) => ids[rang] ?? []),
    du: dateDepuisJourAbsolu(conflit.debut),
    au: conflit.fin === JOUR_SANS_FIN ? null : dateDepuisJourAbsolu(conflit.fin),
  };
}

/**
 * Conflits de place d'un emplacement. Seules comptent ses occupations non supprimées ; les dates
 * réelles priment sur les prévues. Résultat trié par date, sorte, puis ordre d'entrée.
 */
export function detecterConflits(emplacement: Emplacement, occupations: readonly Occupation[]): Conflit[] {
  const { segments, invalides } = trier(emplacement, occupations);
  const capaciteMax = capacite(emplacement);
  const ids = occupations.map((o) => o.id);
  return [
    ...conflitsDePlace(segments, capaciteMax),
    ...conflitsDepassement(segments, capaciteMax),
    ...conflitsInactifs(emplacement, segments),
    ...invalides,
  ]
    .sort(comparer)
    .map((conflit) => versConflit(emplacement, conflit, ids));
}

/**
 * État des serres et tunnels (T58, docs/backlog/T58-etat-serres.md ; docs/modele-donnees.md §1
 * et §5) : équipements déclarés d'un abri (ouvrants latéraux, ouvrants de faîtage, portes,
 * chauffage, voile), état courant de chacun d'après le journal, abris encore ouverts et rappel du
 * soir. Pur : ni base, ni réseau, ni horloge (l'instant est toujours un paramètre) ; rien ne lève.
 * Contrat : ./test/contrat.ts.
 *
 * Un changement d'état est un événement du journal de type `etat_abri`, détail
 * { zoneId, equipement, actif } ; la liste d'équipements d'une zone est `zone.equipements_abri`
 * (nulle : la liste par défaut de son type d'abri). Rejoué par l'écran Aujourd'hui, la vue 3D
 * (apps/web) et le serveur (apps/api/src/sync/etat-abri.ts) : une seule règle.
 */
import type { EquipementAbri, TypeAbri } from '../domaine/index.ts';
import { enVigueurDesTraitements } from '../phyto/index.ts';

/** Ordre canonique : toutes les listes rendues le suivent. */
export const EQUIPEMENTS_ABRI = ['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile'] as const satisfies readonly EquipementAbri[];

/** Les équipements qui OUVRENT un abri (le chauffage et le voile n'ouvrent rien). */
const OUVRANTS: readonly EquipementAbri[] = ['ouvrants_lateraux', 'ouvrants_faitage', 'portes'];

export type ResultatAbri<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly message: string };

/** Ce que les règles lisent d'une zone. */
export interface ZoneAbri {
  readonly id: string;
  readonly nom: string;
  readonly typeAbri: TypeAbri;
  /** Liste de la zone ; nulle : la liste par défaut du type d'abri. */
  readonly equipementsAbri: readonly EquipementAbri[] | null;
}

/** Un changement d'état lu du journal (événement `etat_abri`). */
export interface EvenementEtatAbri {
  readonly id: string;
  readonly zoneId: string;
  readonly equipement: EquipementAbri;
  /** Vrai : ouverts, allumé, posé ; faux : fermés, éteint, retiré. */
  readonly actif: boolean;
  /** Instant ISO de la saisie. */
  readonly horodatage: string;
  readonly remplaceSorte: 'correction' | 'annulation' | null;
  readonly remplaceEvenementId: string | null;
}

export interface EtatEquipement {
  readonly actif: boolean;
  /** Instant ISO depuis lequel l'état vaut (celui de l'original pour une correction). */
  readonly depuis: string;
  /** Événement en vigueur qui porte l'état (la correction, le cas échéant). */
  readonly evenementId: string;
}

export interface EtatEquipementDeZone {
  readonly equipement: EquipementAbri;
  readonly etat: EtatEquipement | null;
}

export interface AbriOuvert {
  readonly zoneId: string;
  readonly nom: string;
  readonly ouverts: readonly EquipementAbri[];
}

export interface RappelDuSoir {
  readonly nombre: number;
  readonly phrase: string;
  readonly zones: readonly AbriOuvert[];
}

/** Heure locale de la ferme à partir de laquelle le rappel s'affiche. */
export const HEURE_RAPPEL_SERRES = 18;

const DEFAUTS: Readonly<Record<TypeAbri, readonly EquipementAbri[]>> = {
  serre: EQUIPEMENTS_ABRI,
  tunnel: ['ouvrants_lateraux', 'portes', 'voile'],
  // Abri hors-sol (fraises en gouttière) : le plus souvent un tunnel ; même liste par défaut.
  hors_sol: ['ouvrants_lateraux', 'portes', 'voile'],
  plein_champ: [],
};

const LIBELLES: Readonly<Record<EquipementAbri, string>> = {
  ouvrants_lateraux: 'ouvrants latéraux',
  ouvrants_faitage: 'ouvrants de faîtage',
  portes: 'portes',
  chauffage: 'chauffage',
  voile: 'voile',
};

const estEquipement = (v: unknown): v is EquipementAbri => typeof v === 'string' && (EQUIPEMENTS_ABRI as readonly string[]).includes(v);

/** Liste en ordre canonique (copie neuve). */
const canonique = (liste: readonly EquipementAbri[]): EquipementAbri[] => EQUIPEMENTS_ABRI.filter((e) => liste.includes(e));

/** Liste par défaut d'un type d'abri (copie : la modifier ne change pas le défaut). */
export function equipementsParDefaut(typeAbri: TypeAbri): EquipementAbri[] {
  return [...DEFAUTS[typeAbri]];
}

/** Équipements déclarés d'une zone : sa liste, sinon le défaut de son type ; ordre canonique. */
export function equipementsDeZone(zone: Pick<ZoneAbri, 'typeAbri' | 'equipementsAbri'>): EquipementAbri[] {
  return zone.equipementsAbri === null ? equipementsParDefaut(zone.typeAbri) : canonique(zone.equipementsAbri);
}

/**
 * Liste d'équipements reçue (tableau, ou texte JSON d'un tableau : format de la synchro) : noms
 * connus, sans doublon, vide permis. Rendue en ordre canonique.
 */
export function validerEquipementsAbri(valeur: unknown): ResultatAbri<EquipementAbri[]> {
  let v = valeur;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return { ok: false, message: 'liste des équipements illisible' };
    }
  }
  if (!Array.isArray(v)) return { ok: false, message: 'les équipements forment une liste' };
  const liste = v as readonly unknown[];
  const vus = new Set<EquipementAbri>();
  for (const e of liste) {
    if (!estEquipement(e)) return { ok: false, message: `équipement inconnu : ${typeof e === 'string' ? e.slice(0, 40) : 'valeur sans nom'}` };
    if (vus.has(e)) return { ok: false, message: `équipement en double : ${LIBELLES[e]}` };
    vus.add(e);
  }
  return { ok: true, valeur: canonique([...vus]) };
}

export function libelleEquipement(e: EquipementAbri): string {
  return LIBELLES[e];
}

/** « ouvrants latéraux ouverts », « portes fermées », « chauffage allumé », « voile retiré »… */
export function phraseEtat(e: EquipementAbri, actif: boolean): string {
  switch (e) {
    case 'portes':
      return actif ? 'portes ouvertes' : 'portes fermées';
    case 'chauffage':
      return actif ? 'chauffage allumé' : 'chauffage éteint';
    case 'voile':
      return actif ? 'voile posé' : 'voile retiré';
    case 'ouvrants_lateraux':
    case 'ouvrants_faitage':
      return `${LIBELLES[e]} ${actif ? 'ouverts' : 'fermés'}`;
  }
}

const instantDe = (h: string): number => {
  const t = Date.parse(h);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** Événement en vigueur et l'heure à laquelle il vaut (celle de l'original de sa chaîne). */
interface EnVigueur {
  readonly evenement: EvenementEtatAbri;
  readonly depuis: string;
}

/**
 * Événements en vigueur (chaînes de T10g, `enVigueurDesTraitements`), chacun à l'heure de
 * l'original de sa chaîne : une correction prend la place de l'événement qu'elle corrige.
 */
function enVigueur(evenements: readonly EvenementEtatAbri[]): EnVigueur[] {
  const parId = new Map(evenements.map((e) => [e.id.toLowerCase(), e]));
  return enVigueurDesTraitements(evenements).map((e) => {
    let courant = e;
    const vus = new Set<string>([courant.id.toLowerCase()]);
    for (;;) {
      const parent = courant.remplaceEvenementId === null ? undefined : parId.get(courant.remplaceEvenementId.toLowerCase());
      if (parent === undefined || vus.has(parent.id.toLowerCase())) break;
      vus.add(parent.id.toLowerCase());
      courant = parent;
    }
    return { evenement: e, depuis: courant.horodatage };
  });
}

function dernierEtat(vigueur: readonly EnVigueur[], zoneId: string, equipement: EquipementAbri, instant: number): EtatEquipement | null {
  let meilleur: EnVigueur | null = null;
  for (const v of vigueur) {
    if (v.evenement.zoneId !== zoneId || v.evenement.equipement !== equipement) continue;
    const t = instantDe(v.depuis);
    if (t > instant) continue;
    if (meilleur === null) {
      meilleur = v;
      continue;
    }
    const tm = instantDe(meilleur.depuis);
    if (t > tm || (t === tm && v.evenement.id > meilleur.evenement.id)) meilleur = v;
  }
  return meilleur === null ? null : { actif: meilleur.evenement.actif, depuis: meilleur.depuis, evenementId: meilleur.evenement.id };
}

/**
 * État d'un équipement d'une zone à `instant` : le dernier événement en vigueur (heure, puis id)
 * dont l'heure est passée. `null` : état inconnu.
 */
export function etatCourant(evenements: readonly EvenementEtatAbri[], zoneId: string, equipement: EquipementAbri, instant: string): EtatEquipement | null {
  return dernierEtat(enVigueur(evenements), zoneId, equipement, instantDe(instant));
}

function etatsAvec(vigueur: readonly EnVigueur[], zone: ZoneAbri, instant: number): EtatEquipementDeZone[] {
  return equipementsDeZone(zone).map((equipement) => ({ equipement, etat: dernierEtat(vigueur, zone.id, equipement, instant) }));
}

/** État de chaque équipement DÉCLARÉ de la zone, en ordre canonique. */
export function etatsDeLaZone(evenements: readonly EvenementEtatAbri[], zone: ZoneAbri, instant: string): EtatEquipementDeZone[] {
  return etatsAvec(enVigueur(evenements), zone, instantDe(instant));
}

/**
 * État de chaque équipement déclaré de chaque zone, en une passe sur le journal (les écrans
 * Aujourd'hui et 3D) : comme `etatsDeLaZone` zone par zone, sans recalculer les chaînes.
 */
export function etatsDesZones(evenements: readonly EvenementEtatAbri[], zones: readonly ZoneAbri[], instant: string): Map<string, EtatEquipementDeZone[]> {
  const vigueur = enVigueur(evenements);
  const t = instantDe(instant);
  return new Map(zones.map((z) => [z.id, etatsAvec(vigueur, z, t)]));
}

const COLLATOR = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/** Ordre des abris : nom (naturel, sans la casse), puis id. */
export function comparerAbris(a: { readonly nom: string; readonly id: string }, b: { readonly nom: string; readonly id: string }): number {
  return COLLATOR.compare(a.nom, b.nom) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Abris ouverts à `instant` : au moins un ouvrant ou une porte DÉCLARÉ et actif (état inconnu =
 * fermé). Triés par nom, puis id.
 */
export function abrisOuverts(zones: readonly ZoneAbri[], evenements: readonly EvenementEtatAbri[], instant: string): AbriOuvert[] {
  const vigueur = enVigueur(evenements);
  const t = instantDe(instant);
  return [...zones]
    .sort(comparerAbris)
    .map((z) => ({
      zoneId: z.id,
      nom: z.nom,
      ouverts: etatsAvec(vigueur, z, t)
        .filter((x) => OUVRANTS.includes(x.equipement) && x.etat?.actif === true)
        .map((x) => x.equipement),
    }))
    .filter((a) => a.ouverts.length > 0);
}

/** Heure locale (0 à 23) d'un instant dans le fuseau de la ferme ; nulle si illisible. */
function heureLocale(instant: string, fuseau: string): number | null {
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return null;
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: fuseau }).formatToParts(new Date(t)).find((p) => p.type === 'hour')?.value;
    const n = Number(h);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Rappel du soir : à partir de 18 h 00 (heure de la ferme), « 2 serres encore ouvertes » s'il y a
 * des abris ouverts ; sinon nul.
 */
export function rappelDuSoir(entree: {
  readonly zones: readonly ZoneAbri[];
  readonly evenements: readonly EvenementEtatAbri[];
  readonly maintenant: string;
  readonly fuseau: string;
}): RappelDuSoir | null {
  const heure = heureLocale(entree.maintenant, entree.fuseau);
  if (heure === null || heure < HEURE_RAPPEL_SERRES) return null;
  const zones = abrisOuverts(entree.zones, entree.evenements, entree.maintenant);
  if (zones.length === 0) return null;
  const n = zones.length;
  const phrase = n === 1 ? '1 serre encore ouverte' : `${String(n)} serres encore ouvertes`;
  return { nombre: n, phrase, zones };
}

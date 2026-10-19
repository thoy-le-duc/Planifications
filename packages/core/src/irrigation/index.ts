/**
 * Vannes d'irrigation (T57, docs/backlog/T57-vannes-irrigation.md ; docs/modele-donnees.md §1) :
 * création en lot, règles d'une vanne et de sa position sur le plan, liens datés vanne ↔
 * emplacements (l'historique se garde quand le réseau change), dernière irrigation de chaque
 * planche. Pur : ni base, ni réseau, ni horloge ; rien ne lève. Contrat : ./test/contrat.ts.
 *
 * Rejoué par l'écran « Vannes » (apps/web), la porte du téléphone (packages/sync, position) et le
 * serveur (apps/api/src/sync/structure-lignes.ts) : une seule règle, trois endroits qui l'appliquent.
 */
import { ajouterJours, estDateValide } from '../dates/index.ts';
import { DISTANCE_MAX_ORIGINE_M } from '../placement/validation.ts';

/** Plafonds d'une vanne : ils arrêtent une faute de frappe, pas une grande ferme. */
export const PLAFONDS_VANNES = {
  /** Numéro de vanne au plus. */
  numeroMax: 9_999,
  /** Vannes créées en un lot au plus (comme les planches d'un lot). */
  lotMax: 200,
  /** Débit au plus, en litres par heure. */
  debitLitresHeureMax: 1_000_000,
  /** Longueur au plus d'un nom (comme une cellule d'import). */
  nomCaracteres: 200,
  /** Longueur au plus du préfixe d'un lot. */
  prefixeCaracteres: 20,
} as const;

export type ResultatVanne<T> = { readonly ok: true; readonly valeur: T } | { readonly ok: false; readonly message: string };

const refus = <T>(message: string): ResultatVanne<T> => ({ ok: false, message });
const accepte = <T>(valeur: T): ResultatVanne<T> => ({ ok: true, valeur });

export interface VanneDuLot {
  readonly numeroVanne: number;
  readonly nom: string;
}

export interface SaisieVanne {
  readonly numeroVanne: number;
  readonly nom: string;
  /** Litres par heure, ou nul. */
  readonly debitLitresHeure: number | null;
}

/** Nom d'une vanne d'un lot : « V12 », ou « Vanne 12 » sans préfixe. */
export function nomDeVanne(prefixe: string, numero: number): string {
  const p = prefixe.trim();
  return p === '' ? `Vanne ${String(numero)}` : `${p}${String(numero)}`;
}

/**
 * « 60 vannes, V1 à V60 » : les `nombre` plus petits numéros libres (≥ 1, absents de
 * `numerosPris`), croissants, nommés préfixe + numéro.
 */
export function vannesDuLot(entree: { readonly nombre: number; readonly prefixe: string }, numerosPris: readonly number[]): ResultatVanne<readonly VanneDuLot[]> {
  const { nombre, prefixe } = entree;
  if (!Number.isInteger(nombre) || nombre < 1) return refus('indiquez un nombre entier de vannes, au moins 1');
  if (nombre > PLAFONDS_VANNES.lotMax) return refus(`au plus ${String(PLAFONDS_VANNES.lotMax)} vannes à la fois`);
  if (prefixe.trim().length > PLAFONDS_VANNES.prefixeCaracteres) return refus(`préfixe de ${String(PLAFONDS_VANNES.prefixeCaracteres)} caractères au plus`);
  const pris = new Set(numerosPris);
  const vannes: VanneDuLot[] = [];
  for (let n = 1; vannes.length < nombre && n <= PLAFONDS_VANNES.numeroMax; n++) {
    if (!pris.has(n)) vannes.push({ numeroVanne: n, nom: nomDeVanne(prefixe, n) });
  }
  if (vannes.length < nombre) return refus(`plus assez de numéros libres : les vannes vont de 1 à ${String(PLAFONDS_VANNES.numeroMax)}`);
  return accepte(vannes);
}

/** Une vanne seule : numéro libre de 1 à 9 999, nom non vide, débit facultatif positif. */
export function validerVanne(v: SaisieVanne, numerosPris: readonly number[]): ResultatVanne<SaisieVanne> {
  const { numeroVanne: n, debitLitresHeure: d } = v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > PLAFONDS_VANNES.numeroMax) {
    return refus(`numéro de vanne : un nombre entier de 1 à ${String(PLAFONDS_VANNES.numeroMax)}`);
  }
  if (numerosPris.includes(n)) return refus('ce numéro de vanne existe déjà : choisissez-en un autre');
  const nom = typeof v.nom === 'string' ? v.nom.trim() : '';
  if (nom === '') return refus('donnez un nom à la vanne');
  if (nom.length > PLAFONDS_VANNES.nomCaracteres) return refus(`nom de ${String(PLAFONDS_VANNES.nomCaracteres)} caractères au plus`);
  if (d !== null && (typeof d !== 'number' || !Number.isFinite(d) || d <= 0 || d > PLAFONDS_VANNES.debitLitresHeureMax)) {
    return refus(`débit : un nombre de litres par heure supérieur à 0, au plus ${String(PLAFONDS_VANNES.debitLitresHeureMax)}`);
  }
  return accepte({ numeroVanne: n, nom, debitLitresHeure: d });
}

/** Position d'une vanne sur le plan (repère de la ferme, mètres) : les deux nulles, ou deux nombres finis à 5 km au plus de l'origine. */
export function validerPositionVanne(x: unknown, y: unknown): ResultatVanne<{ readonly x: number; readonly y: number } | null> {
  const absent = (v: unknown): boolean => v === null || v === undefined;
  if (absent(x) && absent(y)) return accepte(null);
  if (absent(x) || absent(y)) return refus('position de la vanne : les deux coordonnées, ou aucune');
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return refus('position de la vanne : deux nombres attendus');
  if (x * x + y * y > DISTANCE_MAX_ORIGINE_M * DISTANCE_MAX_ORIGINE_M) return refus(`la vanne est à plus de ${String(DISTANCE_MAX_ORIGINE_M)} m du point de départ du plan`);
  return accepte({ x, y });
}

// ── Liens datés ──────────────────────────────────────────────────────────────────────────────

/** Un lien (`secteur_emplacement`) : la vanne arrose l'emplacement du jour `du` au jour `au` compris (`au` nul : toujours). */
export interface LienVanne {
  readonly id: string;
  readonly secteurId: string;
  readonly emplacementId: string;
  readonly du: string;
  readonly au: string | null;
}

export const lienActifLe = (l: LienVanne, jour: string): boolean => l.du <= jour && (l.au === null || l.au >= jour);

/** Emplacements arrosés par la vanne le jour donné, dans l'ordre des liens, sans doublon. */
export function emplacementsArroses(liens: readonly LienVanne[], secteurId: string, jour: string): string[] {
  const vus = new Set<string>();
  for (const l of liens) if (l.secteurId === secteurId && lienActifLe(l, jour)) vus.add(l.emplacementId);
  return [...vus];
}

export interface ChangementLiens {
  /** Liens qui gardent leur passé : leur fin devient la veille du jour. */
  readonly fermer: readonly { readonly id: string; readonly au: string }[];
  /** Liens sans passé (commencés le jour même ou après) : supprimés en douceur. */
  readonly supprimer: readonly string[];
  /** Emplacements qui reçoivent un lien neuf, du jour, sans fin. */
  readonly creer: readonly string[];
}

const AUCUN_CHANGEMENT: ChangementLiens = { fermer: [], supprimer: [], creer: [] };

/** Veille d'une date valide, ou nulle (date invalide, ou premier jour du calendrier). */
function veilleDe(jour: string): string | null {
  if (!estDateValide(jour)) return null;
  try {
    return ajouterJours(jour, -1);
  } catch {
    return null;
  }
}

/**
 * Ce qu'il faut écrire pour que, à partir de `jour`, la vanne arrose exactement `voulus`, en
 * gardant l'historique : un lien retiré qui a un passé est fermé la veille, celui qui n'en a pas
 * est supprimé ; un emplacement voulu sans lien actif ce jour-là en reçoit un neuf.
 */
export function changerLiens(liens: readonly LienVanne[], secteurId: string, voulus: readonly string[], jour: string): ChangementLiens {
  const veille = veilleDe(jour);
  if (veille === null) return AUCUN_CHANGEMENT;
  const voulu = new Set(voulus);
  const fermer: { id: string; au: string }[] = [];
  const supprimer: string[] = [];
  const couverts = new Set<string>();
  for (const l of liens) {
    if (l.secteurId !== secteurId) continue;
    // Déjà fini avant le jour : c'est l'historique, jamais touché.
    if (l.au !== null && l.au < jour) continue;
    if (voulu.has(l.emplacementId)) {
      if (l.du <= jour) couverts.add(l.emplacementId);
      continue;
    }
    if (l.du < jour) fermer.push({ id: l.id, au: veille });
    else supprimer.push(l.id);
  }
  const creer = [...new Set(voulus)].filter((e) => !couverts.has(e));
  return { fermer, supprimer, creer };
}

// ── Dernière irrigation ──────────────────────────────────────────────────────────────────────

/** Une irrigation en vigueur (ni annulée, ni remplacée par une correction). */
export interface Irrigation {
  readonly id: string;
  readonly secteurId: string;
  readonly date: string;
  readonly horodatage: string;
  readonly dureeMinutes: number;
}

/** a est-elle plus récente que b (date, puis horodatage, puis id) ? */
function plusRecente(a: Irrigation, b: Irrigation): boolean {
  if (a.date !== b.date) return a.date > b.date;
  const ta = Date.parse(a.horodatage);
  const tb = Date.parse(b.horodatage);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb;
  if (a.horodatage !== b.horodatage) return a.horodatage > b.horodatage;
  return a.id > b.id;
}

/**
 * Dernière irrigation de chaque emplacement : la plus récente des irrigations dont la vanne
 * l'arrosait le jour même de l'irrigation (changer le réseau ne réécrit pas le passé).
 */
export function dernieresIrrigations(irrigations: readonly Irrigation[], liens: readonly LienVanne[]): Map<string, Irrigation> {
  const parVanne = new Map<string, LienVanne[]>();
  for (const l of liens) {
    const liste = parVanne.get(l.secteurId);
    if (liste === undefined) parVanne.set(l.secteurId, [l]);
    else liste.push(l);
  }
  const dernieres = new Map<string, Irrigation>();
  for (const i of irrigations) {
    for (const l of parVanne.get(i.secteurId) ?? []) {
      if (!lienActifLe(l, i.date)) continue;
      const actuelle = dernieres.get(l.emplacementId);
      if (actuelle === undefined || plusRecente(i, actuelle)) dernieres.set(l.emplacementId, i);
    }
  }
  return dernieres;
}

/** La plus récente irrigation de la vanne, ou nulle. */
export function derniereIrrigationDe(irrigations: readonly Irrigation[], secteurId: string): Irrigation | null {
  let meilleure: Irrigation | null = null;
  for (const i of irrigations) if (i.secteurId === secteurId && (meilleure === null || plusRecente(i, meilleure))) meilleure = i;
  return meilleure;
}

export type ClasseIrrigation = 'aujourdhui' | 'hier' | 'ancienne' | 'jamais';

/** Date de la dernière irrigation, comparée au jour du téléphone ; une date à venir compte comme aujourd'hui. */
export function classeIrrigation(date: string | null, aujourdhui: string): ClasseIrrigation {
  if (date === null) return 'jamais';
  if (date >= aujourdhui) return 'aujourdhui';
  if (date === veilleDe(aujourdhui)) return 'hier';
  return 'ancienne';
}

/**
 * Instantané de la journée (T13d) : la dernière journée dessinée, gardée sur le téléphone
 * (localStorage, une clé par utilisateur), pour l'afficher tout de suite au lancement suivant
 * pendant que la base est relue. Contrat : ./test/contrat.ts, section T13d.
 *
 * - Lecture synchrone, au premier rendu. Jamais montré s'il est d'un autre jour, d'une autre
 *   ferme, d'un autre utilisateur, d'une autre version de format, ou illisible : tout est vérifié,
 *   champ par champ ; au moindre doute, il est ignoré.
 * - Ne contient que ce que l'écran dessine au lancement : les cartes visibles (textes prêts à
 *   afficher), les compteurs, les saisies visibles de l'historique. Ni les récoltes en cours
 *   (le dialogue « Noter une récolte » attend la journée relue), ni notes, ni paramètres.
 * - Stockage indisponible ou plein : rien n'est lu ni gardé, l'écran marche comme avant.
 * - Effacé à la déconnexion (connexion/deconnexion.ts, ./cle-instantane.ts).
 */
import { lireSession } from '../../connexion/session.ts';
import { cleInstantane } from './cle-instantane.ts';
import type { CarteVue, SaisieVue, TypeSaisie } from './vues.ts';

/** Format de l'instantané ; un autre numéro est ignoré. */
export const VERSION_INSTANTANE = 1;

export type StockageInstantane = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Ce que l'écran dessine d'une journée. */
export interface VueJournee {
  /** Semaine ISO. */
  readonly semaine: number;
  /** Cartes dessinées (en retard d'abord, puis la semaine), au plus TACHES_PAR_GROUPE par groupe. */
  readonly taches: readonly CarteVue[];
  /** Nombre de tâches en retard, de la semaine (au-delà des cartes dessinées). */
  readonly retard: number;
  readonly cetteSemaine: number;
  /** Nombre de récoltes en cours (la liste attend la journée relue). */
  readonly recoltes: number;
  /** Charge de la semaine, en minutes. */
  readonly charge: number;
  /** Saisies dessinées de l'historique, et leur nombre total. */
  readonly historique: readonly SaisieVue[];
  readonly saisies: number;
}

export interface Instantane extends VueJournee {
  readonly version: number;
  readonly utilisateurId: string;
  readonly fermeId: string;
  /** 'AAAA-MM-JJ'. */
  readonly jour: string;
}

/** localStorage, ou null s'il est refusé (navigation privée stricte). */
export function stockageParDefaut(): StockageInstantane | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ── Vérification ─────────────────────────────────────────────────────────────────────────────

type Objet = Readonly<Record<string, unknown>>;

const estObjet = (x: unknown): x is Objet => typeof x === 'object' && x !== null && !Array.isArray(x);
const estTexte = (x: unknown): x is string => typeof x === 'string';
const estTexteOuNul = (x: unknown): x is string | null => x === null || typeof x === 'string';
const estEntier = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const estBooleen = (x: unknown): x is boolean => typeof x === 'boolean';
const TYPES: readonly TypeSaisie[] = ['realise', 'recolte', 'intervention'];

function carte(x: unknown): CarteVue | null {
  if (!estObjet(x)) return null;
  const { cle, retard, joursRetard, surtitre, titre, detail, codes, minutes, bande, travail, peser, action } = x;
  if (!estTexte(cle) || cle === '' || !estBooleen(retard) || !estEntier(joursRetard) || !estTexte(surtitre) || !estTexte(titre)) return null;
  if (!estTexte(detail) || !estTexteOuNul(codes) || !(minutes === null || estEntier(minutes)) || !estTexte(bande) || !/^[a-z0-9-]+$/.test(bande)) return null;
  if (!estBooleen(travail) || !estBooleen(peser) || !estTexte(action)) return null;
  return { cle, retard, joursRetard, surtitre, titre, detail, codes, minutes, bande, travail, peser, action };
}

function saisie(x: unknown): SaisieVue | null {
  if (!estObjet(x)) return null;
  const { id, type, quoi, culture, quand, nom, retiree } = x;
  if (!estTexte(id) || id === '' || !(TYPES as readonly unknown[]).includes(type) || !estTexte(quoi) || !estTexte(culture)) return null;
  if (!estTexte(quand) || !estTexte(nom) || !estBooleen(retiree)) return null;
  return { id, type: type as TypeSaisie, quoi, culture, quand, nom, retiree };
}

function liste<T>(x: unknown, lire: (e: unknown) => T | null): T[] | null {
  if (!Array.isArray(x)) return null;
  const l: T[] = [];
  for (const e of x as readonly unknown[]) {
    const v = lire(e);
    if (v === null) return null;
    l.push(v);
  }
  return l;
}

/**
 * Instantané de cet utilisateur, s'il vaut pour cette ferme et ce jour ; sinon null (absent,
 * illisible, autre version, autre jour, autre ferme, autre utilisateur, stockage refusé).
 * T13l : miroir de `garderInstantane`, il n'est rendu que si la session rangée est celle de cet
 * utilisateur (un autre compte connecté entre temps dans un autre onglet ne le voit pas).
 */
export function lireInstantane(stockage: StockageInstantane, attendu: { readonly utilisateurId: string; readonly fermeId: string; readonly jour: string }): Instantane | null {
  if (lireSession(stockage)?.utilisateurId !== attendu.utilisateurId) return null;
  let lu: unknown;
  try {
    const brut = stockage.getItem(cleInstantane(attendu.utilisateurId));
    if (brut === null) return null;
    lu = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!estObjet(lu)) return null;
  const { version, utilisateurId, fermeId, jour, semaine, retard, cetteSemaine, recoltes, charge, saisies } = lu;
  if (version !== VERSION_INSTANTANE || utilisateurId !== attendu.utilisateurId || fermeId !== attendu.fermeId || jour !== attendu.jour) return null;
  if (!estEntier(semaine) || !estEntier(retard) || !estEntier(cetteSemaine) || !estEntier(recoltes) || !estEntier(charge) || !estEntier(saisies)) return null;
  const taches = liste(lu.taches, carte);
  const historique = liste(lu.historique, saisie);
  if (taches === null || historique === null) return null;
  return { version, utilisateurId, fermeId, jour, semaine, taches, retard, cetteSemaine, recoltes, charge, historique, saisies };
}

/**
 * Garde l'instantané, seulement si la session rangée dans `stockage` est celle de cet
 * utilisateur ; stockage plein ou refusé : rien (l'écran marche sans).
 */
export function garderInstantane(stockage: StockageInstantane, ids: { readonly utilisateurId: string; readonly fermeId: string; readonly jour: string }, vue: VueJournee): void {
  // Session disparue ou autre compte (déconnexion dans un autre onglet) : plus rien de ce compte
  // n'est écrit, même par une réécriture différée.
  if (lireSession(stockage)?.utilisateurId !== ids.utilisateurId) return;
  const instantane: Instantane = { version: VERSION_INSTANTANE, ...ids, ...vue };
  try {
    stockage.setItem(cleInstantane(ids.utilisateurId), JSON.stringify(instantane));
  } catch {
    // Plein (QuotaExceededError) ou refusé : le prochain lancement relira la base, comme avant
    // T13d. L'ancien instantané, devenu périmé, est retiré s'il peut l'être.
    try {
      stockage.removeItem(cleInstantane(ids.utilisateurId));
    } catch {
      // Refusé : rien de plus à faire.
    }
  }
}

// ── T13k : « Fait » tapés avant la base, pas encore écrits ────────────────────────────────────

/**
 * T13k : nombre de « Fait » tapés sur l'instantané avant l'ouverture de la base et pas encore
 * écrits, noté DANS l'enregistrement de l'instantané (même clé : la déconnexion l'efface avec lui).
 * Rien que le nombre : ni culture ni tâche. Si l'appli est fermée avant la base, le lancement
 * suivant le lit et dit que ces « Fait » n'ont pas été enregistrés (jamais perdus en silence).
 * Session d'un autre compte, instantané absent ou illisible, stockage refusé : rien n'est noté.
 */
export function noterFaitsEnAttente(stockage: StockageInstantane, utilisateurId: string, nombre: number): void {
  if (lireSession(stockage)?.utilisateurId !== utilisateurId) return;
  try {
    const brut = stockage.getItem(cleInstantane(utilisateurId));
    if (brut === null) return;
    const lu: unknown = JSON.parse(brut);
    if (!estObjet(lu) || lu.utilisateurId !== utilisateurId) return;
    const note: Record<string, unknown> = { ...lu, faitsEnAttente: nombre };
    if (nombre <= 0) delete note.faitsEnAttente;
    stockage.setItem(cleInstantane(utilisateurId), JSON.stringify(note));
  } catch {
    // Illisible, plein ou refusé : rien de noté (l'écran le dit tant qu'il est ouvert).
  }
}

/** T13k : nombre de « Fait » d'avant la base restés sans écriture (0 si aucun ou illisible). */
export function lireFaitsEnAttente(stockage: StockageInstantane, utilisateurId: string): number {
  if (lireSession(stockage)?.utilisateurId !== utilisateurId) return 0;
  try {
    const brut = stockage.getItem(cleInstantane(utilisateurId));
    if (brut === null) return 0;
    const lu: unknown = JSON.parse(brut);
    if (!estObjet(lu) || lu.utilisateurId !== utilisateurId) return 0;
    return estEntier(lu.faitsEnAttente) ? lu.faitsEnAttente : 0;
  } catch {
    return 0;
  }
}

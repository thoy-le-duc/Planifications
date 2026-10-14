/**
 * Instantané du début du plan (T11g) : les premières lignes du dernier plan dessiné, gardées sur
 * le téléphone (localStorage, une clé par utilisateur), pour l'afficher tout de suite au
 * lancement suivant, en lecture seule, pendant que la base s'ouvre. Symétrique de l'instantané
 * d'Aujourd'hui (../aujourdhui/instantane.ts, T13d, T13l). Contrat : ./instantane.test.ts.
 *
 * - Lecture synchrone, au premier rendu. Jamais montré s'il est d'une autre ferme, d'un autre
 *   utilisateur (ni quand la session rangée est celle d'un autre compte), d'une autre version de
 *   format, ou illisible : tout est vérifié, champ par champ ; au moindre doute, il est ignoré.
 * - Ne contient que ce que la vue 2D dessine : saison, semaines, lignes du début (zones,
 *   planches, barres, conflits). Ni bâtiments, ni contours, ni placements (vue 3D, qui attend la
 *   base).
 * - Stockage indisponible ou plein : rien n'est lu ni gardé, l'écran marche comme avant.
 * - Effacé à la déconnexion (connexion/deconnexion.ts, ./cle-instantane.ts).
 */
import { lireSession } from '../../connexion/session.ts';
import { FAMILLES, type CleFamille } from '../../ui/jetons.ts';
import { NOMS_CONFLITS, type BarrePlan, type ConflitPlan, type LignePlan, type Plan, type SaisonPlan, type SemainePlan, type SorteConflit } from './calculs.ts';
import { cleInstantanePlan } from './cle-instantane.ts';

/** Format de l'instantané ; un autre numéro est ignoré. */
export const VERSION_INSTANTANE_PLAN = 1;

/** Lignes gardées : de quoi remplir la vue d'un grand téléphone, marge comprise. */
export const LIGNES_INSTANTANE = 40;

export type StockageInstantane = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Le début du plan dessiné (PlanLu de ./cache.ts sans `complet`). */
export interface VuePlan {
  readonly plan: Plan;
  /** Nombre de lignes du plan complet (hauteur réservée). */
  readonly totalLignes: number;
}

export interface InstantanePlan extends VuePlan {
  readonly version: number;
  readonly utilisateurId: string;
  readonly fermeId: string;
}

/**
 * Clé de la dernière ferme montrée à cet utilisateur (T13g) : la même que `cleMontree` de
 * donnees/ferme-memorisee.ts (vérifié par ./avant-base.test.tsx), recopiée ici car l'écran
 * n'importe rien de src/donnees (calculs.test.ts) ; l'importer depuis App coûterait au démarrage.
 */
export const cleFermeMontree = (utilisateurId: string): string => `planif.ferme-montree.${utilisateurId}`;

/** T13g : dernière ferme montrée à cet utilisateur sur ce téléphone ; null si aucune ou stockage refusé. */
export function lireFermeMontree(stockage: Pick<Storage, 'getItem'>, utilisateurId: string): string | null {
  try {
    const valeur = stockage.getItem(cleFermeMontree(utilisateurId));
    return valeur === null || valeur === '' ? null : valeur;
  } catch {
    return null;
  }
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
const estId = (x: unknown): x is string => typeof x === 'string' && x !== '';
const estTexteOuNul = (x: unknown): x is string | null => x === null || typeof x === 'string';
const estIdOuNul = (x: unknown): x is string | null => x === null || estId(x);
const estEntier = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const estPositif = (x: unknown): x is number => estEntier(x) && x >= 0;
const estNombre = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const estBooleen = (x: unknown): x is boolean => typeof x === 'boolean';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const estDate = (x: unknown): x is string => typeof x === 'string' && DATE.test(x);

const estCleFamille = (x: unknown): x is CleFamille => typeof x === 'string' && Object.hasOwn(FAMILLES, x);
const estSorteConflit = (x: unknown): x is SorteConflit => typeof x === 'string' && Object.hasOwn(NOMS_CONFLITS, x);

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

function saison(x: unknown): SaisonPlan | null {
  if (!estObjet(x)) return null;
  const { id, nom, debut, fin } = x;
  if (!estId(id) || !estTexte(nom) || !estDate(debut) || !estDate(fin)) return null;
  return { id, nom, debut, fin };
}

function semaine(x: unknown): SemainePlan | null {
  if (!estObjet(x)) return null;
  const { annee, semaine: numero, libelle, lundi } = x;
  if (!estPositif(annee) || !estPositif(numero) || !estTexte(libelle) || !estDate(lundi)) return null;
  return { annee, semaine: numero, libelle, lundi };
}

function barre(x: unknown): BarrePlan | null {
  if (!estObjet(x)) return null;
  const { occupationId, serieId, plantationId, libelle, famille, cleFamille, etat, du, au, debutJour, finJour, enConflit } = x;
  if (!estId(occupationId) || !estIdOuNul(serieId) || !estIdOuNul(plantationId) || !estTexte(libelle) || !estTexteOuNul(famille)) return null;
  if (!(cleFamille === null || estCleFamille(cleFamille)) || (etat !== 'reel' && etat !== 'prevu')) return null;
  if (!estDate(du) || !(au === null || estDate(au)) || !estEntier(debutJour) || !estEntier(finJour) || !estBooleen(enConflit)) return null;
  return { occupationId, serieId, plantationId, libelle, famille, cleFamille, etat, du, au, debutJour, finJour, enConflit };
}

function conflit(x: unknown): ConflitPlan | null {
  if (!estObjet(x)) return null;
  const { sorte, nom, du, au } = x;
  const occupations = liste(x.occupations, (o) => (estId(o) ? o : null));
  if (!estSorteConflit(sorte) || !estTexte(nom) || occupations === null || !estDate(du) || !(au === null || estDate(au))) return null;
  return { sorte, nom, occupations, du, au };
}

function ligne(x: unknown): LignePlan | null {
  if (!estObjet(x)) return null;
  const { sorte, id } = x;
  if (!estId(id)) return null;
  if (sorte === 'zone' || sorte === 'chapelle') {
    return estTexte(x.nom) ? { sorte, id, nom: x.nom } : null;
  }
  if (sorte !== 'emplacement') return null;
  const { code, zoneId, chapelleId, longueurM, largeurM } = x;
  if (!estTexte(code) || !estId(zoneId) || !estIdOuNul(chapelleId) || !estNombre(longueurM) || !(largeurM === null || estNombre(largeurM))) return null;
  const barres = liste(x.barres, barre);
  const conflits = liste(x.conflits, conflit);
  if (barres === null || conflits === null) return null;
  return { sorte, id, code, zoneId, chapelleId, longueurM, largeurM, barres, conflits };
}

function plan(x: unknown): Plan | null {
  if (!estObjet(x)) return null;
  const s = saison(x.saison);
  const semaines = liste(x.semaines, semaine);
  const lignes = liste(x.lignes, ligne);
  const { semaineCourante } = x;
  if (s === null || semaines === null || lignes === null || !(semaineCourante === null || estPositif(semaineCourante))) return null;
  return { saison: s, semaines, semaineCourante, lignes };
}

/** Ce que la vue 2D dessine d'une ligne (sans contour ni placement, propres à la 3D). */
function ligne2d(l: LignePlan): LignePlan {
  if (l.sorte !== 'emplacement') return { sorte: l.sorte, id: l.id, nom: l.nom };
  const { sorte, id, code, zoneId, chapelleId, longueurM, largeurM, barres, conflits } = l;
  return { sorte, id, code, zoneId, chapelleId, longueurM, largeurM, barres, conflits };
}

/**
 * Le début d'un plan dessiné, réduit à ce que l'instantané garde : les LIGNES_INSTANTANE
 * premières lignes, sans bâtiments ; `totalLignes` : la hauteur du plan complet.
 */
export function debutPourInstantane(p: Plan, totalLignes: number): VuePlan {
  return {
    plan: { saison: p.saison, semaines: p.semaines, semaineCourante: p.semaineCourante, lignes: p.lignes.slice(0, LIGNES_INSTANTANE).map(ligne2d) },
    totalLignes: Math.max(totalLignes, p.lignes.length),
  };
}

/**
 * Instantané de cet utilisateur, s'il vaut pour cette ferme ; sinon null (absent, illisible,
 * autre version, autre ferme, autre utilisateur, session rangée d'un autre compte, stockage
 * refusé). Ne lève jamais.
 */
export function lireInstantanePlan(stockage: StockageInstantane, attendu: { readonly utilisateurId: string; readonly fermeId: string }): InstantanePlan | null {
  let lu: unknown;
  try {
    if (lireSession(stockage)?.utilisateurId !== attendu.utilisateurId) return null;
    const brut = stockage.getItem(cleInstantanePlan(attendu.utilisateurId));
    if (brut === null) return null;
    lu = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!estObjet(lu)) return null;
  const { version, utilisateurId, fermeId, totalLignes } = lu;
  if (version !== VERSION_INSTANTANE_PLAN || utilisateurId !== attendu.utilisateurId || fermeId !== attendu.fermeId || !estPositif(totalLignes)) return null;
  const p = plan(lu.plan);
  if (p === null) return null;
  return { version, utilisateurId, fermeId, plan: p, totalLignes: Math.max(totalLignes, p.lignes.length) };
}

/**
 * Garde l'instantané, seulement si la session rangée dans `stockage` est celle de cet
 * utilisateur ; stockage plein ou refusé : rien (l'écran marche sans), l'ancien est retiré.
 */
export function garderInstantanePlan(stockage: StockageInstantane, ids: { readonly utilisateurId: string; readonly fermeId: string }, vue: VuePlan): void {
  try {
    // Session disparue ou autre compte (déconnexion dans un autre onglet) : plus rien de ce
    // compte n'est écrit, même par une écriture différée.
    if (lireSession(stockage)?.utilisateurId !== ids.utilisateurId) return;
  } catch {
    return;
  }
  const instantane: InstantanePlan = { version: VERSION_INSTANTANE_PLAN, ...ids, plan: vue.plan, totalLignes: vue.totalLignes };
  try {
    stockage.setItem(cleInstantanePlan(ids.utilisateurId), JSON.stringify(instantane));
  } catch {
    // Plein (QuotaExceededError) ou refusé : l'ancien instantané, devenu périmé, est retiré.
    try {
      stockage.removeItem(cleInstantanePlan(ids.utilisateurId));
    } catch {
      // Refusé : rien de plus à faire.
    }
  }
}

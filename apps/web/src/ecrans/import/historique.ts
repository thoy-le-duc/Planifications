/**
 * Imports récents de la ferme (T14b) : de quoi les montrer et les annuler, même après avoir
 * fermé l'écran. Rangés dans le navigateur (localStorage), par ferme, le plus récent d'abord ;
 * relus avec une garde (une entrée illisible est écartée, rien ne lève).
 *
 * Annuler un import : chaque ligne qu'il a créée reçoit `supprime_le` (suppression douce, jamais
 * de DELETE), en lots comme l'import (@planif/sync/import), dans l'ordre qui libère ce qui sert :
 * assolements, occupations, séries… puis zones (enfants d'abord) et saisons.
 */
import { ECRITURES_MAX_PAR_LOT } from '@planif/core';
import type { OrdreEcriture, PorteDonnees } from '@planif/sync';
import { ORDRE_ANNULATION } from './constantes.ts';

export interface ImportPasse {
  readonly id: string;
  readonly fichier: string;
  readonly type: string;
  readonly lignes: number;
  /** Instant ISO de l'import. */
  readonly le: string;
  readonly etat: 'actif' | 'annule';
  /** Lignes créées, par table, dans l'ordre de création. */
  readonly creees: Readonly<Record<string, readonly string[]>>;
}

/** Imports gardés par ferme, au plus. */
const IMPORTS_MAX = 30;

const cle = (fermeId: string): string => `planif:import:historique:${fermeId}`;

function stockage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

const estTexte = (v: unknown): v is string => typeof v === 'string';

function relire(v: unknown): ImportPasse | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!estTexte(o.id) || !estTexte(o.fichier) || !estTexte(o.type) || !estTexte(o.le) || typeof o.lignes !== 'number') return null;
  if (o.etat !== 'actif' && o.etat !== 'annule') return null;
  if (typeof o.creees !== 'object' || o.creees === null || Array.isArray(o.creees)) return null;
  const creees: Record<string, string[]> = {};
  for (const [table, ids] of Object.entries(o.creees as Record<string, unknown>)) {
    if (!(ORDRE_ANNULATION as readonly string[]).includes(table) || !Array.isArray(ids) || !ids.every(estTexte)) return null;
    creees[table] = ids;
  }
  return { id: o.id, fichier: o.fichier, type: o.type, lignes: o.lignes, le: o.le, etat: o.etat, creees };
}

export function importsDeLaFerme(fermeId: string): ImportPasse[] {
  try {
    const texte = stockage()?.getItem(cle(fermeId)) ?? null;
    if (texte === null) return [];
    const liste: unknown = JSON.parse(texte);
    return Array.isArray(liste) ? liste.map(relire).filter((x): x is ImportPasse => x !== null) : [];
  } catch {
    return [];
  }
}

function ranger(fermeId: string, liste: readonly ImportPasse[]): void {
  try {
    stockage()?.setItem(cle(fermeId), JSON.stringify(liste.slice(0, IMPORTS_MAX)));
  } catch {
    // Navigateur plein ou stockage refusé : l'import reste écrit, seul l'historique manque.
  }
}

export function noterImport(fermeId: string, i: ImportPasse): void {
  ranger(fermeId, [i, ...importsDeLaFerme(fermeId).filter((x) => x.id !== i.id)]);
}

function marquerAnnule(fermeId: string, id: string): void {
  ranger(
    fermeId,
    importsDeLaFerme(fermeId).map((x) => (x.id === id ? { ...x, etat: 'annule' as const } : x)),
  );
}

/** Suppression douce d'une ligne (jamais de DELETE) : rien ne change si elle l'est déjà. */
function suppressionDouce(table: (typeof ORDRE_ANNULATION)[number], id: string, instant: string): OrdreEcriture {
  return { sql: `UPDATE ${table} SET supprime_le = ?, modifie_le = ? WHERE id = ? AND supprime_le IS NULL`, parametres: [instant, instant, id] };
}

/**
 * Annule l'import `i` : toutes ses lignes reçoivent supprime_le, en lots d'au plus
 * ECRITURES_MAX_PAR_LOT ordres (une ligne chacun, quelques centaines d'octets : loin des 5 Mio).
 */
export async function annulerImport(porte: PorteDonnees, fermeId: string, i: ImportPasse, instant: string): Promise<void> {
  const ordres = ORDRE_ANNULATION.flatMap((table) => {
    const ids = i.creees[table] ?? [];
    // Zones : enfants avant parentes (créées parentes d'abord).
    const dans = table === 'zone' ? [...ids].reverse() : ids;
    return dans.map((id) => suppressionDouce(table, id, instant));
  });
  for (let debut = 0; debut < ordres.length; debut += ECRITURES_MAX_PAR_LOT) {
    await porte.ecrireEnsemble(ordres.slice(debut, debut + ECRITURES_MAX_PAR_LOT));
  }
  marquerAnnule(fermeId, i.id);
}

/**
 * Imports récents de la ferme (T14b) : de quoi les montrer et les annuler, même après avoir
 * fermé l'écran. Rangés dans le navigateur (localStorage), par ferme, le plus récent d'abord ;
 * relus avec une garde (une entrée illisible est écartée, rien ne lève).
 *
 * Annuler un import (relecture B2) :
 *   - d'abord, sur la base locale, aucune ligne de l'import ne doit servir à une ligne active qui
 *     n'en vient pas (série posée sur une planche importée…) : sinon refus en clair, rien retiré ;
 *   - puis lot par lot, dans l'ordre inverse de l'import, chaque lot dans l'ordre inverse de ses
 *     écritures (une occupation avant sa série, une sous-zone avant sa zone) : suppression douce
 *     (`supprime_le`, jamais de DELETE), limitée aux lignes de la ferme ;
 *   - un lot refusé ne bloque que lui-même : les autres sont annulés, l'import reste annulable et
 *     « Annuler » à nouveau reprend les lots qui restent.
 */
import { ECRITURES_MAX_PAR_LOT } from '@planif/core';
import type { OrdreEcriture, PorteDonnees } from '@planif/sync';
import { ORDRE_ANNULATION } from './constantes.ts';

type TableImport = (typeof ORDRE_ANNULATION)[number];

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
  /** Lignes créées par chaque lot d'envoi, « table:id » (absent : import d'avant la relecture). */
  readonly lots?: readonly (readonly string[])[];
  /** Lots écrits (les premiers `ecrits` de `lots`) ; moins que `lots.length` : import interrompu. */
  readonly ecrits?: number;
  /** Lots déjà annulés (indices dans `lots`). */
  readonly lotsAnnules?: readonly number[];
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
const estTable = (t: string): t is TableImport => (ORDRE_ANNULATION as readonly string[]).includes(t);
const entierPositif = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function relire(v: unknown): ImportPasse | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!estTexte(o.id) || !estTexte(o.fichier) || !estTexte(o.type) || !estTexte(o.le) || typeof o.lignes !== 'number') return null;
  if (o.etat !== 'actif' && o.etat !== 'annule') return null;
  if (typeof o.creees !== 'object' || o.creees === null || Array.isArray(o.creees)) return null;
  const creees: Record<string, string[]> = {};
  for (const [table, ids] of Object.entries(o.creees as Record<string, unknown>)) {
    if (!estTable(table) || !Array.isArray(ids) || !ids.every(estTexte)) return null;
    creees[table] = ids;
  }
  const passe: ImportPasse = { id: o.id, fichier: o.fichier, type: o.type, lignes: o.lignes, le: o.le, etat: o.etat, creees };
  if (o.lots === undefined) return passe;
  if (!Array.isArray(o.lots) || !o.lots.every((l) => Array.isArray(l) && l.every(estTexte))) return null;
  const lots = o.lots;
  const ecrits = entierPositif(o.ecrits) ? Math.min(o.ecrits, lots.length) : lots.length;
  const annules = Array.isArray(o.lotsAnnules) ? o.lotsAnnules.filter((x): x is number => entierPositif(x) && x < lots.length) : [];
  return { ...passe, lots, ecrits, lotsAnnules: annules };
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

function ranger(fermeId: string, liste: readonly ImportPasse[]): boolean {
  try {
    const s = stockage();
    if (s === null) return false;
    s.setItem(cle(fermeId), JSON.stringify(liste.slice(0, IMPORTS_MAX)));
    return true;
  } catch {
    // Navigateur plein ou stockage refusé : l'import reste écrit, seul l'historique manque.
    return false;
  }
}

/** Note (ou remplace) l'import ; faux si le navigateur refuse de le ranger. */
export function noterImport(fermeId: string, i: ImportPasse): boolean {
  return ranger(fermeId, [i, ...importsDeLaFerme(fermeId).filter((x) => x.id !== i.id)]);
}

function mettreAJour(fermeId: string, id: string, f: (i: ImportPasse) => ImportPasse): ImportPasse | null {
  let resultat: ImportPasse | null = null;
  ranger(
    fermeId,
    importsDeLaFerme(fermeId).map((x) => {
      if (x.id !== id) return x;
      const nouveau = f(x);
      resultat = nouveau;
      return nouveau;
    }),
  );
  return resultat;
}

/** Note les lots écrits d'un import en cours (interrompu : moins que tous). */
export function noterLotsEcrits(fermeId: string, id: string, ecrits: number): void {
  mettreAJour(fermeId, id, (x) => ({ ...x, ecrits }));
}

/** Import arrêté en route : « k envois sur N » ; null s'il est allé au bout. */
export function interruption(i: ImportPasse): { readonly ecrits: number; readonly envois: number } | null {
  const envois = i.lots?.length ?? 0;
  const ecrits = i.ecrits ?? envois;
  return ecrits < envois ? { ecrits, envois } : null;
}

/** Lots de l'import, « table:id » (import d'avant la relecture : ses lignes en lots de 500). */
function lotsDe(i: ImportPasse): (readonly string[])[] {
  if (i.lots !== undefined) return [...i.lots];
  const tout = [...ORDRE_ANNULATION].reverse().flatMap((t) => (i.creees[t] ?? []).map((id) => `${t}:${id}`));
  const lots: string[][] = [];
  for (let d = 0; d < tout.length; d += ECRITURES_MAX_PAR_LOT) lots.push(tout.slice(d, d + ECRITURES_MAX_PAR_LOT));
  return lots;
}

interface LigneImport {
  readonly table: TableImport;
  readonly id: string;
}

function ligneDe(cleLigne: string): LigneImport | null {
  const i = cleLigne.indexOf(':');
  const table = cleLigne.slice(0, i);
  return i > 0 && estTable(table) ? { table, id: cleLigne.slice(i + 1) } : null;
}

const lignesDe = (lot: readonly string[]): LigneImport[] => lot.map(ligneDe).filter((x): x is LigneImport => x !== null);

/** Suppression douce d'une ligne de la ferme (jamais de DELETE, jamais une autre ferme). */
function suppressionDouce(l: LigneImport, fermeId: string, instant: string): OrdreEcriture {
  return { sql: `UPDATE ${l.table} SET supprime_le = ?, modifie_le = ? WHERE id = ? AND ferme_id = ? AND supprime_le IS NULL`, parametres: [instant, instant, l.id, fermeId] };
}

// ── Ce qui sert encore ─────────────────────────────────────────────────────────────────────────

/** Ce qui se rapporte à une ligne de chaque table : table, colonne, lignes actives seulement, ce que c'est. */
const USAGES: Readonly<Record<TableImport, readonly (readonly [string, string, boolean, string])[]>> = {
  zone: [
    ['zone', 'zone_parente_id', true, 'une sous-zone'],
    ['emplacement', 'zone_id', true, 'un emplacement'],
    ['assolement', 'zone_id', true, 'un assolement'],
  ],
  emplacement: [
    ['occupation', 'emplacement_id', true, 'une culture posée dessus'],
    ['assolement', 'emplacement_id', true, 'un assolement'],
    ['secteur_emplacement', 'emplacement_id', true, 'un secteur d’irrigation'],
  ],
  famille: [
    ['espece', 'famille_id', true, 'une culture'],
    ['assolement', 'famille_id', true, 'un assolement'],
  ],
  espece: [
    ['serie', 'espece_id', true, 'une série'],
    ['itineraire', 'espece_id', true, 'un itinéraire'],
    ['variete', 'espece_id', true, 'une variété'],
    ['assolement', 'espece_id', true, 'un assolement'],
    ['plantation', 'espece_id', true, 'une plantation'],
    ['article_stock', 'espece_id', true, 'un article du stock'],
  ],
  variete: [
    ['serie', 'variete_id', true, 'une série'],
    ['itineraire', 'variete_id', true, 'un itinéraire'],
    ['plantation', 'variete_id', true, 'une plantation'],
    ['article_stock', 'variete_id', true, 'un article du stock'],
  ],
  itineraire: [['serie', 'itineraire_id', true, 'une série']],
  saison: [
    ['serie', 'saison_id', true, 'une série'],
    ['assolement', 'saison_id', true, 'un assolement'],
  ],
  serie: [
    ['occupation', 'serie_id', true, 'une occupation'],
    ['evenement', 'serie_id', false, 'une saisie du journal'],
  ],
  occupation: [],
  assolement: [],
};

/** Comment nommer une ligne de l'import dans le refus : article, colonne du nom. */
const LIBELLE: Readonly<Record<TableImport, readonly [string, string | null]>> = {
  zone: ['la zone', 'nom'],
  emplacement: ['l’emplacement', 'code'],
  famille: ['la famille', 'nom'],
  espece: ['la culture', 'nom'],
  variete: ['la variété', 'nom'],
  itineraire: ['l’itinéraire', 'nom'],
  saison: ['la saison', 'nom'],
  serie: ['une série importée', null],
  occupation: ['une occupation', null],
  assolement: ['un assolement', null],
};

/** Identifiants par requête (SQLite : 999 paramètres au plus). */
const PAQUET = 400;

/** La première ligne de l'import qui sert à une ligne active qui n'en vient pas, dite en clair ; null sinon. */
async function premierUsage(porte: PorteDonnees, fermeId: string, lignes: readonly LigneImport[]): Promise<string | null> {
  const delImport = new Set(lignes.map((l) => `${l.table}:${l.id}`));
  const parTable = new Map<TableImport, string[]>();
  for (const l of lignes) {
    const ids = parTable.get(l.table) ?? [];
    ids.push(l.id);
    parTable.set(l.table, ids);
  }
  for (const [table, ids] of parTable) {
    for (const [autre, colonne, actives, quoi] of USAGES[table]) {
      for (let d = 0; d < ids.length; d += PAQUET) {
        const paquet = ids.slice(d, d + PAQUET);
        const r = await porte.lire<{ id: string; ref: string }>(
          `SELECT id, ${colonne} AS ref FROM ${autre} WHERE ferme_id = ? AND ${colonne} IN (${paquet.map(() => '?').join(', ')})${actives ? ' AND supprime_le IS NULL' : ''}`,
          [fermeId, ...paquet],
        );
        const usage = r.find((x) => !delImport.has(`${autre}:${x.id}`));
        if (usage === undefined) continue;
        const [article, colonneNom] = LIBELLE[table];
        let nom = '';
        if (colonneNom !== null) {
          const l = await porte.lire<{ nom: unknown }>(`SELECT ${colonneNom} AS nom FROM ${table} WHERE id = ?`, [usage.ref]);
          const valeur = l[0]?.nom;
          nom = typeof valeur === 'string' ? ` « ${valeur} »` : '';
        }
        return `Annulation refusée : ${article}${nom} sert encore (${quoi}, saisie ou importée depuis). Rien n’a été retiré : retirez d’abord ce qui s’en sert.`;
      }
    }
  }
  return null;
}

export type ResultatAnnulation =
  | { readonly sorte: 'annule'; readonly passe: ImportPasse }
  | { readonly sorte: 'refuse'; readonly message: string }
  | { readonly sorte: 'incomplet'; readonly lotsRefuses: number; readonly passe: ImportPasse };

/** Annule l'import `i` (voir l'en-tête du fichier). */
export async function annulerImport(porte: PorteDonnees, fermeId: string, i: ImportPasse, instant: string): Promise<ResultatAnnulation> {
  const lots = lotsDe(i);
  const ecrits = Math.min(i.ecrits ?? lots.length, lots.length);
  const dejaAnnules = new Set(i.lotsAnnules ?? []);
  const aAnnuler = lots.map((_, k) => k).filter((k) => k < ecrits && !dejaAnnules.has(k));
  const usage = await premierUsage(porte, fermeId, aAnnuler.flatMap((k) => lignesDe(lots[k] ?? [])));
  if (usage !== null) return { sorte: 'refuse', message: usage };

  const annules = new Set(dejaAnnules);
  let refuses = 0;
  for (const k of [...aAnnuler].reverse()) {
    const ordres = lignesDe(lots[k] ?? [])
      .reverse()
      .map((l) => suppressionDouce(l, fermeId, instant));
    try {
      for (let d = 0; d < ordres.length; d += ECRITURES_MAX_PAR_LOT) await porte.ecrireEnsemble(ordres.slice(d, d + ECRITURES_MAX_PAR_LOT));
      annules.add(k);
      mettreAJour(fermeId, i.id, (x) => ({ ...x, lotsAnnules: [...annules] }));
    } catch (e) {
      console.error(`Annulation du lot ${String(k + 1)} refusée`, e);
      refuses++;
    }
  }
  const fini = aAnnuler.every((k) => annules.has(k));
  const etat = fini ? ('annule' as const) : ('actif' as const);
  const passe = mettreAJour(fermeId, i.id, (x) => ({ ...x, etat, lotsAnnules: [...annules] })) ?? { ...i, etat, lotsAnnules: [...annules] };
  return fini ? { sorte: 'annule', passe } : { sorte: 'incomplet', lotsRefuses: refuses, passe };
}

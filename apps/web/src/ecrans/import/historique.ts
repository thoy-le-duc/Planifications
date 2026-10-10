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
 *
 * Refus du serveur (T14e) : la vérification « sert encore » ne voit que le téléphone. Le serveur
 * peut refuser un lot d'annulation (tout le lot : un refus PATCH par ligne dans refus_synchro) et
 * garder les lignes, qui reviennent actives par la synchro. `suivreRefus` le note sur l'import :
 * ces lots ne sont plus annulés (`lotsRefuses`), l'import redevient actif, et la raison du
 * serveur est gardée en clair (`refusAnnulation`) pour la ligne de l'import dans l'historique.
 * « Annuler cet import » réécrit alors vraiment les suppressions douces de ces lots ; une fois
 * l'annulation finie, ces refus sont « vus » (`refusVus`) et ne comptent plus. Seuls comptent les
 * refus PATCH qui visent une ligne d'un lot annulé par ce téléphone (pas d'horloge serveur).
 */
import { ECRITURES_MAX_PAR_LOT } from '@planif/core';
import type { OrdreEcriture, PorteDonnees, RefusSynchro } from '@planif/sync';
import { enFrancais, ORDRE_ANNULATION } from './constantes.ts';

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
  /** T14e : lots dont le serveur a refusé l'annulation (lignes revenues), à annuler de nouveau. */
  readonly lotsRefuses?: readonly number[];
  /** T14e : le refus d'annulation du serveur, en clair, et les refus (ids) qu'il résume. */
  readonly refusAnnulation?: RefusAnnulation;
  /** T14e : refus d'annulation suivis d'une nouvelle annulation réussie : ils ne comptent plus. */
  readonly refusVus?: readonly string[];
}

export interface RefusAnnulation {
  readonly ids: readonly string[];
  readonly texte: string;
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
  const indices = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => entierPositif(x) && x < lots.length) : []);
  const r: ImportPasse = { ...passe, lots, ecrits, lotsAnnules: indices(o.lotsAnnules) };
  const refuses = indices(o.lotsRefuses);
  const vus = Array.isArray(o.refusVus) ? o.refusVus.filter(estTexte) : [];
  const refusAnnulation = relireRefus(o.refusAnnulation);
  return {
    ...r,
    ...(refuses.length > 0 ? { lotsRefuses: refuses } : {}),
    ...(vus.length > 0 ? { refusVus: vus } : {}),
    ...(refusAnnulation !== null ? { refusAnnulation } : {}),
  };
}

function relireRefus(v: unknown): RefusAnnulation | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return estTexte(o.texte) && Array.isArray(o.ids) ? { texte: o.texte, ids: o.ids.filter(estTexte) } : null;
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

type Modifiable<T> = { -readonly [K in keyof T]: T[K] };

/** L'import avec ces lots refusés, ce refus en clair et ces refus vus (vides : champs retirés). */
function avecSuivi(x: ImportPasse, lotsRefuses: readonly number[], refusAnnulation: RefusAnnulation | null, refusVus: readonly string[]): ImportPasse {
  const r: Modifiable<ImportPasse> = { ...x };
  delete r.lotsRefuses;
  delete r.refusAnnulation;
  delete r.refusVus;
  if (lotsRefuses.length > 0) r.lotsRefuses = [...lotsRefuses];
  if (refusAnnulation !== null) r.refusAnnulation = refusAnnulation;
  if (refusVus.length > 0) r.refusVus = [...refusVus];
  return r;
}

/**
 * Annule l'import `i` (voir l'en-tête du fichier). `refus` : les refus du serveur
 * (porte.surveillerRefus) ; null tant que la liste n'est pas lue (rien n'est alors purgé).
 */
export async function annulerImport(porte: PorteDonnees, fermeId: string, i: ImportPasse, instant: string, refus: readonly RefusSynchro[] | null = null): Promise<ResultatAnnulation> {
  const lots = lotsDe(i);
  const liste = refus ?? [];
  // T14e : un lot dont le serveur a refusé l'annulation est réécrit, même s'il est noté annulé
  // (ses lignes sont revenues : le sauter laisserait l'import en place).
  const refusIci = refusDAnnulation(i, liste);
  const aRefaire = lotsVises(i, refusIci);
  const dejaAnnules = new Set((i.lotsAnnules ?? []).filter((k) => !aRefaire.has(k)));
  // Tous les lots, même ceux qu'on ne sait pas écrits (l'appli a pu s'arrêter juste après une
  // écriture, avant de la noter) : une suppression qui vise une ligne jamais écrite ne touche rien.
  const aAnnuler = lots.map((_, k) => k).filter((k) => !dejaAnnules.has(k));
  const usage = await premierUsage(porte, fermeId, aAnnuler.flatMap((k) => lignesDe(lots[k] ?? [])));
  if (usage !== null) return { sorte: 'refuse', message: usage };

  // Relecture B1 : tout refus PATCH déjà là qui vise une ligne de l'import (une modification
  // refusée avant, ou le refus d'une annulation précédente) n'est pas un refus de CETTE
  // annulation : noté vu dès maintenant. Les vus qui ne sont plus dans la liste sont purgés.
  const lot = lotParLigne(i);
  const anterieurs = liste.filter((r) => r.operation === 'PATCH' && lot.has(`${r.nomTable}:${r.ligneId}`)).map((r) => r.id);
  const presents = refus === null ? null : new Set(refus.map((r) => r.id));
  const vusDe = (x: ImportPasse): string[] => [...new Set([...(x.refusVus ?? []).filter((id) => presents === null || presents.has(id)), ...anterieurs])];
  // Lots notés refusés par le serveur pendant cette annulation (suivreRefus) : jamais remis annulés.
  const refusesAuDepart = new Set([...(i.lotsRefuses ?? []), ...aRefaire]);
  const refusesDepuis = (x: ImportPasse): Set<number> => new Set((x.lotsRefuses ?? []).filter((k) => !refusesAuDepart.has(k)));
  const idsAuDepart = new Set(i.refusAnnulation?.ids ?? []);

  const annules = new Set(dejaAnnules);
  const suivre = (x: ImportPasse, fin: boolean): ImportPasse => {
    const depuis = refusesDepuis(x);
    const lotsAnnules = [...annules].filter((k) => !depuis.has(k));
    const lotsRefuses = (x.lotsRefuses ?? []).filter((k) => depuis.has(k) || !annules.has(k));
    const fini = fin && aAnnuler.every((k) => annules.has(k)) && depuis.size === 0;
    const etat = fin ? (fini ? ('annule' as const) : ('actif' as const)) : x.etat;
    const vus = vusDe(x);
    // Annulation finie : le refus montré est suivi (ses ids connus au départ seulement).
    const montre = x.refusAnnulation ?? null;
    const nouveauRefus = montre?.ids.some((id) => !idsAuDepart.has(id)) === true ? montre : null;
    if (fini) for (const id of idsAuDepart) if (!vus.includes(id)) vus.push(id);
    return avecSuivi({ ...x, etat, lotsAnnules }, lotsRefuses, fini ? nouveauRefus : (x.refusAnnulation ?? null), vus);
  };
  mettreAJour(fermeId, i.id, (x) => suivre(x, false));
  let refuses = 0;
  for (const k of [...aAnnuler].reverse()) {
    const ordres = lignesDe(lots[k] ?? [])
      .reverse()
      .map((l) => suppressionDouce(l, fermeId, instant));
    try {
      for (let d = 0; d < ordres.length; d += ECRITURES_MAX_PAR_LOT) await porte.ecrireEnsemble(ordres.slice(d, d + ECRITURES_MAX_PAR_LOT));
      annules.add(k);
      mettreAJour(fermeId, i.id, (x) => suivre(x, false));
    } catch (e) {
      console.error(`Annulation du lot ${String(k + 1)} refusée`, e);
      refuses++;
    }
  }
  const passe = mettreAJour(fermeId, i.id, (x) => suivre(x, true)) ?? suivre(i, true);
  const refusesParLeServeur = (passe.lotsRefuses ?? []).filter((k) => !refusesAuDepart.has(k)).length;
  return passe.etat === 'annule' ? { sorte: 'annule', passe } : { sorte: 'incomplet', lotsRefuses: refuses + refusesParLeServeur, passe };
}

// ── Refus du serveur (T14e) ────────────────────────────────────────────────────────────────────

/** Attente maximale d'une lecture des refus avant d'annuler (ms) ; au-delà : null. */
const ATTENTE_REFUS_MS = 2_000;

/**
 * Les refus tels qu'ils sont en base à l'instant (une lecture de porte.surveillerRefus, puis
 * arrêt) : l'annulation part de la liste à jour, pas d'une liste en retard d'un changement.
 * null si la lecture n'arrive pas à temps.
 */
export function lireRefus(porte: PorteDonnees): Promise<readonly RefusSynchro[] | null> {
  return new Promise((resolve) => {
    let fini = false;
    let arreter: (() => void) | null = null;
    const finir = (r: readonly RefusSynchro[] | null): void => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      resolve(r);
      queueMicrotask(() => arreter?.());
    };
    const minuterie = setTimeout(() => {
      finir(null);
    }, ATTENTE_REFUS_MS);
    // Arrêt en microtâche (finir) : `arreter` est déjà affecté, même si le rappel vient tout de suite.
    arreter = porte.surveillerRefus(finir);
  });
}

/** Lot (indice) de chaque ligne de l'import, « table:id ». */
function lotParLigne(i: ImportPasse): Map<string, number> {
  const m = new Map<string, number>();
  lotsDe(i).forEach((lot, k) => {
    for (const l of lot) m.set(l, k);
  });
  return m;
}

/**
 * Refus d'annulation de l'import : refus PATCH (une suppression douce) qui visent une ligne d'un
 * lot que ce téléphone a annulé (ou dont l'annulation est déjà notée refusée), pas encore suivis
 * d'une nouvelle annulation. Un import jamais annulé n'en a pas ; une ligne hors de l'import non plus.
 */
export function refusDAnnulation(i: ImportPasse, refus: readonly RefusSynchro[]): RefusSynchro[] {
  const concernes = new Set([...(i.lotsAnnules ?? []), ...(i.lotsRefuses ?? [])]);
  if (concernes.size === 0) return [];
  const vus = new Set(i.refusVus ?? []);
  const lot = lotParLigne(i);
  return refus.filter((r) => {
    if (r.operation !== 'PATCH' || vus.has(r.id)) return false;
    const k = lot.get(`${r.nomTable}:${r.ligneId}`);
    return k !== undefined && concernes.has(k);
  });
}

function lotsVises(i: ImportPasse, refus: readonly RefusSynchro[]): Set<number> {
  const lot = lotParLigne(i);
  const r = new Set<number>();
  for (const x of refus) {
    const k = lot.get(`${x.nomTable}:${x.ligneId}`);
    if (k !== undefined) r.add(k);
  }
  return r;
}

/** Début générique des messages du serveur (apps/api/src/sync/messages.ts) : la raison vient après. */
const DEBUT_MESSAGE_SERVEUR = /^Saisie non enregistrée, données invalides : /;
/** Ligne d'un lot refusé seulement parce qu'une autre l'est (apps/api/src/sync/upload.ts). */
const AUTRE_PARTIE = 'une autre partie de cette saisie est refusée';

/** Le refus en clair : quelle ligne (comme le maraîcher la connaît), pourquoi, quoi faire. Jamais de code ni d'identifiant. */
async function texteDuRefus(porte: PorteDonnees, fermeId: string, refus: readonly RefusSynchro[]): Promise<string> {
  const fautif = refus.find((r) => !r.message.includes(AUTRE_PARTIE)) ?? refus[0];
  if (fautif === undefined) return '';
  let quoi = '';
  if (estTable(fautif.nomTable)) {
    const [article, colonneNom] = LIBELLE[fautif.nomTable];
    let nom = '';
    if (colonneNom !== null) {
      const l = await porte.lire<{ nom: unknown }>(`SELECT ${colonneNom} AS nom FROM ${fautif.nomTable} WHERE id = ? AND ferme_id = ?`, [fautif.ligneId, fermeId]);
      const valeur = l[0]?.nom;
      nom = typeof valeur === 'string' && valeur.trim() !== '' ? ` « ${valeur.trim()} »` : '';
    }
    quoi = ` pour ${article}${nom}`;
  }
  const raison = fautif.message.replace(DEBUT_MESSAGE_SERVEUR, '').trim().replace(/([^.!?…])$/, '$1.');
  const revenues = refus.length === 1 ? 'La ligne est revenue' : `${enFrancais(refus.length)} lignes de cet import sont revenues`;
  return `Annulation refusée par le serveur${quoi} : ${raison} ${revenues} ; réglez cela, puis touchez « Annuler cet import » à nouveau.`;
}

/**
 * Note sur chaque import les refus d'annulation reçus du serveur : leurs lots ne sont plus
 * annulés, l'import redevient actif, le refus est gardé en clair. Rend l'historique à jour, ou
 * null si rien n'a changé.
 */
export async function suivreRefus(porte: PorteDonnees, fermeId: string, refus: readonly RefusSynchro[]): Promise<ImportPasse[] | null> {
  if (refus.length === 0) return null;
  let change = false;
  for (const i of importsDeLaFerme(fermeId)) {
    const ici = refusDAnnulation(i, refus);
    const connus = new Set(i.refusAnnulation?.ids ?? []);
    if (ici.length === 0 || ici.every((r) => connus.has(r.id))) continue;
    const texte = await texteDuRefus(porte, fermeId, ici);
    const lots = lotsVises(i, ici);
    mettreAJour(fermeId, i.id, (x) =>
      avecSuivi(
        { ...x, etat: 'actif', lotsAnnules: (x.lotsAnnules ?? []).filter((k) => !lots.has(k)) },
        [...new Set([...(x.lotsRefuses ?? []), ...lots])],
        { ids: ici.map((r) => r.id), texte },
        x.refusVus ?? [],
      ),
    );
    change = true;
  }
  return change ? importsDeLaFerme(fermeId) : null;
}

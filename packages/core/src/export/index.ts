/**
 * Export complet de la ferme (T15, principe 5) : fichiers de l'archive (ferme.json, CSV,
 * LISEZMOI.txt), nom de l'archive, ZIP. Tout est pur : ni base, ni réseau, ni horloge.
 * La lecture de la base locale est dans `exporterFerme` (@planif/sync).
 *
 * Contrat détaillé : ./test/contrat.ts.
 */
import { TABLES_EXPORTEES, type DescriptionTable, type TypeExport } from './tables.ts';

export { TABLES_EXPORTEES, type DescriptionColonne, type DescriptionTable, type TypeExport } from './tables.ts';
export { creerZip, type FichierZip, type OptionsZip } from './zip.ts';

export type ValeurLocale = string | number | null;
export type LigneLocale = Readonly<Record<string, ValeurLocale>>;

export interface EntreeExport {
  readonly fermeId: string;
  /** Instant ISO de l'export, recopié dans ferme.json (`genere_le`). */
  readonly genereLe: string;
  /** Lignes de chaque table, telles que la base locale les rend ; tables absentes = vides. */
  readonly tables: Readonly<Record<string, readonly LigneLocale[] | undefined>>;
}

export interface FichierExport {
  /** Chemin dans l'archive : 'ferme.json', 'LISEZMOI.txt', 'zone.csv', 'bibliotheque/famille.csv'… */
  readonly chemin: string;
  /** Texte du fichier (BOM compris pour les CSV). */
  readonly contenu: string;
}

export interface ExportPrepare {
  readonly fichiers: FichierExport[];
  /** Nombre de lignes de données de chaque CSV, par chemin sans « .csv » ('zone', 'bibliotheque/famille'). */
  readonly lignes: Readonly<Record<string, number>>;
}

const BOM = '﻿';
const FIN = '\r\n';
const A_PROTEGER = /[;"\r\n]/;

// ── Valeurs ──────────────────────────────────────────────────────────────────────────────────

/** Champ CSV : virgule décimale, oui/non, texte protégé selon RFC 4180 si besoin. */
function champCsv(type: TypeExport, v: ValeurLocale | undefined): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (type === 'booleen') s = v === 1 ? 'oui' : 'non';
  else if (typeof v === 'number') {
    s = String(v);
    if (type === 'entier' || type === 'reel') s = s.replace('.', ',');
  } else s = v;
  return A_PROTEGER.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Valeur de ferme.json : nombres tels quels (point décimal), booléens, JSON décodé. */
function valeurJson(type: TypeExport, v: ValeurLocale | undefined): unknown {
  if (v === null || v === undefined) return null;
  if (type === 'booleen') return v === 1;
  if (type === 'json' && typeof v === 'string') {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v;
    }
  }
  return v;
}

// ── Filtrage par ferme ───────────────────────────────────────────────────────────────────────

interface Repartition {
  readonly ferme: readonly LigneLocale[];
  readonly bibliotheque: readonly LigneLocale[];
}

function repartir(nom: string, d: DescriptionTable, lignes: readonly LigneLocale[], fermeId: string, membres: ReadonlySet<unknown>): Repartition {
  if (nom === 'ferme') return { ferme: lignes.filter((l) => l.id === fermeId), bibliotheque: [] };
  if (nom === 'utilisateur') return { ferme: lignes.filter((l) => membres.has(l.id)), bibliotheque: [] };
  const ferme: LigneLocale[] = [];
  const bibliotheque: LigneLocale[] = [];
  for (const l of lignes) {
    if (l.ferme_id === fermeId) ferme.push(l);
    else if (d.bibliotheque && l.ferme_id === null) bibliotheque.push(l);
  }
  return { ferme, bibliotheque };
}

// ── Fichiers ─────────────────────────────────────────────────────────────────────────────────

/** Une table en CSV et en lignes JSON, en une seule passe sur les lignes. */
function convertir(d: DescriptionTable, lignes: readonly LigneLocale[]): { csv: string; json: Record<string, unknown>[] } {
  const colonnes = Object.entries(d.colonnes);
  const noms = colonnes.map(([c]) => c);
  const types = colonnes.map(([, c]) => c.type);
  const morceaux: string[] = new Array<string>(lignes.length + 1);
  morceaux[0] = BOM + noms.join(';') + FIN;
  const json: Record<string, unknown>[] = new Array<Record<string, unknown>>(lignes.length);
  const champs: string[] = new Array<string>(noms.length);
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i] ?? {};
    const objet: Record<string, unknown> = {};
    for (let k = 0; k < noms.length; k++) {
      const nom = noms[k] ?? '';
      const type = types[k] ?? 'texte';
      const v = l[nom];
      champs[k] = champCsv(type, v);
      objet[nom] = valeurJson(type, v);
    }
    morceaux[i + 1] = champs.join(';') + FIN;
    json[i] = objet;
  }
  return { csv: morceaux.join(''), json };
}

function lisezmoi(fermeId: string, genereLe: string): string {
  const l: string[] = [
    'Export complet de votre ferme — Planifications',
    '',
    `Ferme : ${fermeId}`,
    `Généré le : ${genereLe} (UTC)`,
    '',
    'Cette archive contient toutes les données de votre ferme, telles qu’elles sont sur le téléphone.',
    'Elles vous appartiennent : vous pouvez les ouvrir, les copier et les garder sans condition.',
    '',
    'Contenu :',
    '- ferme.json : toutes les données en un seul fichier JSON (UTF-8), pour un autre logiciel.',
    '  Les nombres y ont un point décimal, les oui/non y sont true/false, les colonnes JSON y sont décodées.',
    '- un fichier CSV par table (zone.csv, serie.csv, evenement.csv…), à ouvrir dans Excel ou LibreOffice.',
    '- dossier bibliotheque/ : la bibliothèque de référence commune (familles, espèces, variétés,',
    '  itinéraires, produits phyto) utilisée par votre ferme. Ce n’est pas une saisie de la ferme ;',
    '  les fiches créées ou adaptées par la ferme sont, elles, dans les CSV principaux.',
    '',
    'Conventions des CSV :',
    '- encodage UTF-8 avec BOM, séparateur point-virgule (;), une ligne d’en-tête avec le nom des colonnes ;',
    '- nombres avec la virgule décimale (12,5), sans séparateur de milliers ;',
    '- dates au format AAAA-MM-JJ ; dates et heures au format ISO 8601 en UTC (2026-09-29T06:30:00.000Z) ;',
    '- oui / non pour les cases à cocher ; champ vide quand la valeur est absente ;',
    '- un texte contenant un point-virgule, un guillemet ou un retour à la ligne est entre guillemets,',
    '  ses guillemets doublés ;',
    '- les colonnes JSON (détails, paramètres) sont gardées en texte JSON.',
    '',
    'Lignes supprimées : une ligne supprimée dans l’appli reste dans l’export, avec sa date de',
    'suppression dans la colonne supprime_le. Pour ne garder que les lignes actives, filtrez les',
    'lignes dont supprime_le est vide.',
    '',
    'Les identifiants (colonne id et colonnes en _id) relient les tables entre elles.',
    '',
    'Description de chaque fichier CSV et de chaque colonne :',
  ];
  const bloc = (chemin: string, d: DescriptionTable, remarque: string | null) => {
    l.push('', `## ${chemin}`, d.description);
    if (remarque !== null) l.push(remarque);
    for (const [col, c] of Object.entries(d.colonnes)) l.push(`- ${col} : ${c.description}`);
  };
  const biblio: [string, DescriptionTable][] = [];
  for (const [nom, d] of Object.entries(TABLES_EXPORTEES)) {
    bloc(`${nom}.csv`, d, d.bibliotheque ? 'Fiches propres à la ferme ; la référence commune est dans bibliotheque/.' : null);
    if (d.bibliotheque) biblio.push([nom, d]);
  }
  for (const [nom, d] of biblio) bloc(`bibliotheque/${nom}.csv`, d, 'Bibliothèque de référence commune (ferme_id vide).');
  return l.join(FIN) + FIN;
}

/** Fichiers de l'archive et nombre de lignes par CSV. */
export function preparerExport(entree: EntreeExport): ExportPrepare {
  const { fermeId, genereLe } = entree;
  const membres = new Set<unknown>();
  for (const m of entree.tables.membre ?? []) if (m.ferme_id === fermeId) membres.add(m.utilisateur_id);

  const csv: FichierExport[] = [];
  const csvBiblio: FichierExport[] = [];
  const lignes: Record<string, number> = {};
  const tables: Record<string, Record<string, unknown>[]> = {};
  const bibliotheque: Record<string, Record<string, unknown>[]> = {};

  for (const [nom, d] of Object.entries(TABLES_EXPORTEES)) {
    const r = repartir(nom, d, entree.tables[nom] ?? [], fermeId, membres);
    const ferme = convertir(d, r.ferme);
    csv.push({ chemin: `${nom}.csv`, contenu: ferme.csv });
    tables[nom] = ferme.json;
    lignes[nom] = r.ferme.length;
    if (d.bibliotheque) {
      const ref = convertir(d, r.bibliotheque);
      csvBiblio.push({ chemin: `bibliotheque/${nom}.csv`, contenu: ref.csv });
      bibliotheque[nom] = ref.json;
      lignes[`bibliotheque/${nom}`] = r.bibliotheque.length;
    }
  }

  const json = JSON.stringify({ format: 'planifications-export', version: 1, ferme_id: fermeId, genere_le: genereLe, tables, bibliotheque });
  return {
    fichiers: [{ chemin: 'ferme.json', contenu: json }, { chemin: 'LISEZMOI.txt', contenu: lisezmoi(fermeId, genereLe) }, ...csv, ...csvBiblio],
    lignes,
  };
}

/** Fichiers de l'archive : ferme.json, LISEZMOI.txt, un CSV par table, bibliotheque/. */
export function construireExport(entree: EntreeExport): FichierExport[] {
  return preparerExport(entree).fichiers;
}

/** 'planifications-<nom de la ferme sans accents>-<AAAA-MM-JJ>.zip'. */
export function nomArchive(nomFerme: string | null, jour: string): string {
  const nom = (nomFerme ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `planifications-${nom === '' ? 'ferme' : nom}-${jour}.zip`;
}

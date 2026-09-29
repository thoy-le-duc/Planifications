/**
 * T07 — schéma local de mesure, en deux variantes PowerSync.
 *
 * - `json` : tables par défaut de PowerSync. Chaque ligne est stockée en JSON dans une table
 *   interne `ps_data__<table>` ; PowerSync crée une vue `<table>` qui extrait les colonnes, et des
 *   index sur ces extractions.
 * - `raw` : « raw tables » de PowerSync (`Schema.withRawTables`, SDK web ≥ 1.35). Vraies tables
 *   SQLite créées par nous (`CREATE TABLE ... STRICT`), avec nos index ; les écritures locales
 *   rejoignent la file d'envoi grâce aux déclencheurs générés par
 *   `powersync_create_raw_table_crud_trigger`, comme le recommande la documentation.
 *
 * Mêmes noms de tables et de colonnes dans les deux variantes : les requêtes mesurées sont identiques.
 */
import { column, Schema, Table, type RawTableType } from '@powersync/web';

/** Le SDK n'exporte pas `RawTable` (marqué interne) : c'est `RawTableType` plus le nom de la table. */
type RawTable = RawTableType & { name: string };

export type Variante = 'json' | 'raw';

/** Colonnes de chaque table, hors `id`, avec leur type SQLite. */
const TABLES = {
  famille: { nom: 'TEXT' },
  zone: { nom: 'TEXT' },
  emplacement: { zone_id: 'TEXT', code: 'TEXT', longueur_m: 'REAL' },
  saison: { nom: 'TEXT', debut: 'TEXT', fin: 'TEXT' },
  serie: { saison_id: 'TEXT', famille_id: 'TEXT', espece: 'TEXT' },
  occupation: { emplacement_id: 'TEXT', serie_id: 'TEXT', du: 'TEXT', au: 'TEXT' },
  evenement: { type: 'TEXT', date: 'TEXT', serie_id: 'TEXT', emplacement_id: 'TEXT' },
} as const satisfies Record<string, Record<string, 'TEXT' | 'REAL'>>;

export type NomTable = keyof typeof TABLES;
export const NOMS_TABLES = Object.keys(TABLES) as NomTable[];

export function colonnes(table: NomTable): string[] {
  return Object.keys(TABLES[table]);
}

/** Index utiles aux jointures de la vue 2D et aux bornes de dates du semainier. */
const INDEX: Partial<Record<NomTable, Record<string, string[]>>> = {
  emplacement: { zone: ['zone_id'] },
  serie: { saison: ['saison_id'], famille: ['famille_id'] },
  occupation: { serie: ['serie_id'], emplacement: ['emplacement_id'], du: ['du'], au: ['au'] },
  evenement: { date: ['date'], serie: ['serie_id'], emplacement: ['emplacement_id'] },
};

function tableJson(nom: NomTable): Table {
  const definition = TABLES[nom];
  const cols: Record<string, (typeof column)[keyof typeof column]> = {};
  for (const [col, type] of Object.entries(definition)) cols[col] = type === 'REAL' ? column.real : column.text;
  return new Table(cols, { indexes: INDEX[nom] ?? {} });
}

export function creerSchema(variante: Variante): Schema {
  if (variante === 'json') {
    const tables: Record<string, Table> = {};
    for (const nom of NOMS_TABLES) tables[nom] = tableJson(nom);
    return new Schema(tables);
  }
  const schema = new Schema({});
  const brutes: Record<string, { schema: Record<string, never> }> = {};
  for (const nom of NOMS_TABLES) brutes[nom] = { schema: {} };
  schema.withRawTables(brutes);
  return schema;
}

/** DDL des raw tables et de leurs index (idempotent). */
export function ddlRaw(): string[] {
  const ordres: string[] = [];
  for (const nom of NOMS_TABLES) {
    const cols = Object.entries(TABLES[nom]).map(([col, type]) => `${col} ${type}`);
    ordres.push(`CREATE TABLE IF NOT EXISTS ${nom} (id TEXT NOT NULL PRIMARY KEY, ${cols.join(', ')}) STRICT`);
    for (const [suffixe, colsIndex] of Object.entries(INDEX[nom] ?? {})) {
      ordres.push(`CREATE INDEX IF NOT EXISTS ${nom}_${suffixe} ON ${nom} (${colsIndex.join(', ')})`);
    }
  }
  return ordres;
}

/** Description JSON d'une raw table, à passer à `powersync_create_raw_table_crud_trigger`. */
export function descriptionRaw(nom: NomTable): string {
  const table: RawTable = { name: nom, schema: {} };
  return JSON.stringify(Schema.rawTableToJson(table));
}

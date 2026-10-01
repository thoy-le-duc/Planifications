/**
 * T13b — double de test de la base locale du téléphone, FIDÈLE au stockage de PowerSync :
 * un vrai SQLite en mémoire (`node:sqlite`) bâti depuis `SCHEMA_LOCAL`, index compris.
 *
 * Le double de @planif/sync (packages/sync/src/test/base-memoire.ts) crée des tables simples,
 * sans index : il ne dit rien de la vitesse ni du plan des requêtes. Ici, comme le fait le cœur
 * de PowerSync (powersync-sqlite-core) pour une table « JSON » :
 *   - chaque table est une table interne `ps_data__<table>(id TEXT PRIMARY KEY NOT NULL, data TEXT)`,
 *     la ligne rangée en JSON dans `data` ;
 *   - une vue `<table>` en extrait les colonnes : `CAST(json_extract(data, '$.<col>') as <TYPE>)` ;
 *   - chaque index déclaré dans le schéma devient un index d'expression
 *     `ps_data__<table>__<nom>` sur ces mêmes extractions (l'optimiseur de SQLite s'en sert à
 *     travers la vue) ;
 *   - les écritures passent par la vue (déclencheurs INSTEAD OF, comme ceux de PowerSync).
 *
 * Même API que le double de @planif/sync (`BaseLocale` : getAll, execute, writeTransaction,
 * onChange), plus `plan()` (EXPLAIN QUERY PLAN) et `lireDirect()` pour les assertions.
 * Outil de test : jamais importé par l'appli.
 */
import type { SQLInputValue } from 'node:sqlite';
import type { BaseLocale } from '@planif/sync';

/** Chargé à l'exécution, comme base-memoire.ts (Vite refuse un module de Node importé statiquement sous happy-dom). */
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/** Ce que le double lit du schéma : `SCHEMA_LOCAL.toJSON()`. */
export interface SchemaJson {
  readonly tables: readonly {
    readonly name: string;
    readonly columns: readonly { readonly name: string; readonly type: string }[];
    readonly indexes: readonly { readonly name: string; readonly columns: readonly { readonly name: string; readonly ascending: boolean; readonly type: string }[] }[];
  }[];
}

export interface BasePowerSync extends BaseLocale {
  /**
   * Lignes de EXPLAIN QUERY PLAN, dans l'ordre, chacune précédée de ses parents :
   * « MATERIALIZE montee › SETUP › SEARCH ps_data__evenement USING INDEX … ».
   */
  plan(sql: string, parametres?: readonly unknown[]): string[];
  lireDirect<T>(sql: string, parametres?: readonly unknown[]): T[];
  /** Exécute un ordre hors transaction (chargement des jeux, lignes reçues par la synchro). */
  recevoir(sql: string, parametres?: readonly unknown[]): void;
  /** Exécute plusieurs ordres SQL bruts (BEGIN/COMMIT d'un chargement en masse). */
  exec(sql: string): void;
  fermer(): void;
}

const ECRITURE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?(\w+)["`]?/i;

function valeurSql(v: unknown, position: number): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return v;
  throw new TypeError(`paramètre ${String(position + 1)} : ${typeof v} non stockable tel quel dans SQLite`);
}

const valeurs = (parametres: readonly unknown[] | undefined): SQLInputValue[] => (parametres ?? []).map(valeurSql);

const q = (nom: string): string => `"${nom.replaceAll('"', '""')}"`;
const extraction = (colonne: string, type: string): string => `CAST(json_extract(data, '$.${colonne}') as ${type})`;

/** Ordres de création d'une table « JSON » de PowerSync : table interne, vue, index, déclencheurs. */
export function ddlPowerSync(schema: SchemaJson): string[] {
  const ordres: string[] = [];
  for (const t of schema.tables) {
    const interne = `ps_data__${t.name}`;
    const cols = t.columns.filter((c) => c.name !== 'id');
    ordres.push(`CREATE TABLE ${q(interne)} (id TEXT PRIMARY KEY NOT NULL, data TEXT)`);
    ordres.push(
      `CREATE VIEW ${q(t.name)} (id${cols.map((c) => `, ${q(c.name)}`).join('')}) AS SELECT id${cols.map((c) => `, ${extraction(c.name, c.type)}`).join('')} FROM ${q(interne)}`,
    );
    for (const index of t.indexes) {
      const expr = index.columns.map((c) => `${extraction(c.name, c.type)}${c.ascending ? '' : ' DESC'}`).join(', ');
      ordres.push(`CREATE INDEX ${q(`${interne}__${index.name}`)} ON ${q(interne)} (${expr})`);
    }
    const objet = (prefixe: string) => `json_object(${cols.map((c) => `'${c.name}', ${prefixe}.${q(c.name)}`).join(', ')})`;
    ordres.push(`CREATE TRIGGER ${q(`ps_view_insert_${t.name}`)} INSTEAD OF INSERT ON ${q(t.name)} BEGIN
      INSERT INTO ${q(interne)} (id, data) VALUES (NEW.id, ${objet('NEW')}); END`);
    ordres.push(`CREATE TRIGGER ${q(`ps_view_update_${t.name}`)} INSTEAD OF UPDATE ON ${q(t.name)} BEGIN
      UPDATE ${q(interne)} SET data = ${objet('NEW')} WHERE id = OLD.id; END`);
    ordres.push(`CREATE TRIGGER ${q(`ps_view_delete_${t.name}`)} INSTEAD OF DELETE ON ${q(t.name)} BEGIN
      DELETE FROM ${q(interne)} WHERE id = OLD.id; END`);
  }
  return ordres;
}

export function creerBasePowerSync(schema: SchemaJson): BasePowerSync {
  const db = new DatabaseSync(':memory:');
  for (const ordre of ddlPowerSync(schema)) db.exec(ordre);

  interface Abonne {
    onChange: (e: { changedTables: string[] }) => void | Promise<void>;
  }
  const abonnes = new Set<{ gestionnaire: Abonne; tables: readonly string[] | undefined }>();
  let file: Promise<unknown> = Promise.resolve();
  let enTransaction = false;
  let touchees = new Set<string>();

  function prevenir(tables: ReadonlySet<string>): void {
    for (const a of [...abonnes]) {
      const t = [...tables].filter((x) => a.tables === undefined || a.tables.includes(x));
      if (t.length > 0) void a.gestionnaire.onChange({ changedTables: t });
    }
  }

  function executer(sql: string, parametres?: readonly unknown[]): { rowsAffected: number } {
    const r = db.prepare(sql).run(...valeurs(parametres));
    const table = ECRITURE.exec(sql)?.[1];
    if (table !== undefined) {
      if (enTransaction) touchees.add(table);
      else prevenir(new Set([table]));
    }
    return { rowsAffected: Number(r.changes) };
  }

  const lire = <T>(sql: string, parametres?: readonly unknown[]): T[] => db.prepare(sql).all(...valeurs(parametres)) as T[];
  const tx = {
    getAll: <T>(sql: string, parametres?: readonly unknown[]) => Promise.resolve(lire<T>(sql, parametres)),
    execute: (sql: string, parametres?: readonly unknown[]) => Promise.resolve(executer(sql, parametres)),
  };

  return {
    ...tx,
    writeTransaction<R>(fn: (t: typeof tx) => Promise<R>): Promise<R> {
      const suite = file.then(async () => {
        db.exec('BEGIN');
        enTransaction = true;
        touchees = new Set();
        try {
          const r = await fn(tx);
          db.exec('COMMIT');
          enTransaction = false;
          prevenir(touchees);
          return r;
        } catch (e) {
          db.exec('ROLLBACK');
          enTransaction = false;
          throw e;
        }
      });
      file = suite.catch(() => undefined);
      return suite;
    },
    onChange(gestionnaire, options) {
      const a = { gestionnaire, tables: options?.tables };
      abonnes.add(a);
      return () => {
        abonnes.delete(a);
      };
    },
    plan(sql, parametres) {
      const lignes = lire<{ id: number; parent: number; detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, parametres);
      const parId = new Map(lignes.map((l) => [l.id, l]));
      return lignes.map((l) => {
        const chemin = [l.detail];
        for (let p = parId.get(l.parent); p !== undefined; p = parId.get(p.parent)) chemin.unshift(p.detail);
        return chemin.join(' › ');
      });
    },
    lireDirect: lire,
    recevoir(sql, parametres) {
      executer(sql, parametres);
    },
    exec(sql) {
      db.exec(sql);
    },
    fermer() {
      abonnes.clear();
      db.close();
    },
  };
}

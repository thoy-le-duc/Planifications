/**
 * Double de test de la base locale du téléphone : un vrai SQLite en mémoire (`node:sqlite`),
 * exposé avec le sous-ensemble de l'API de `PowerSyncDatabase` que `@planif/sync` a le droit
 * d'utiliser (voir `BaseLocale` dans contrat.ts) : `getAll`, `execute`, `writeTransaction`,
 * `onChange`.
 *
 * Différences assumées avec PowerSync (T07 : wa-sqlite dans le navigateur, impossible sous Node) :
 * - les tables sont de vraies tables SQLite créées depuis la description du schéma local
 *   (`SCHEMA_LOCAL.tables[].name` et `.columns[].name`), sans type ni contrainte, comme les
 *   tables JSON de PowerSync ;
 * - aucune file d'envoi (`ps_crud`) : l'envoi se teste à part, avec une file simulée ;
 * - `onChange` prévient après chaque écriture validée (hors transaction, ou au COMMIT), avec
 *   les tables touchées, repérées dans le texte de l'ordre SQL.
 *
 * Seules les valeurs que SQLite stocke sont acceptées (texte, nombre, null) : un tableau, un
 * objet, un booléen ou `undefined` lève une erreur, comme il faudrait les sérialiser en texte
 * JSON pour PowerSync.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/** Ce que le double lit du schéma local : le nom de chaque table et de ses colonnes. */
export interface DescriptionSchema {
  readonly tables: readonly { readonly name: string; readonly columns: readonly { readonly name: string }[] }[];
}

export interface EvenementChangement {
  readonly changedTables: string[];
}

export interface GestionnaireChangement {
  onChange: (evenement: EvenementChangement) => void | Promise<void>;
}

export interface OptionsChangement {
  readonly tables?: readonly string[];
}

export interface TransactionMemoire {
  getAll<T>(sql: string, parametres?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, parametres?: readonly unknown[]): Promise<{ rowsAffected: number }>;
}

export interface BaseMemoire extends TransactionMemoire {
  writeTransaction<R>(fn: (tx: TransactionMemoire) => Promise<R>): Promise<R>;
  onChange(gestionnaire: GestionnaireChangement, options?: OptionsChangement): () => void;
  /** Pour les assertions : lecture directe, synchrone, hors de la porte. */
  lireDirect<T>(sql: string, parametres?: readonly unknown[]): T[];
  /** Simule une ligne arrivée par la synchro (refus, écriture d'un autre téléphone) : prévient les abonnés. */
  recevoir(sql: string, parametres?: readonly unknown[]): void;
  /** Ordres SQL d'écriture exécutés, dans l'ordre (pour les assertions). */
  readonly ecritures: readonly string[];
  fermer(): void;
}

const ECRITURE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?(\w+)["`]?/i;

function valeurSql(v: unknown, position: number): SQLInputValue {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return v;
  throw new TypeError(
    `paramètre ${String(position + 1)} : ${typeof v} non stockable tel quel dans SQLite (sérialiser en texte JSON ou en nombre)`,
  );
}

function valeurs(parametres: readonly unknown[] | undefined): SQLInputValue[] {
  return (parametres ?? []).map(valeurSql);
}

export function creerBaseMemoire(schema: DescriptionSchema): BaseMemoire {
  const db = new DatabaseSync(':memory:');
  for (const table of schema.tables) {
    const colonnes = table.columns.map((c) => `"${c.name}"`).filter((c) => c !== '"id"');
    db.exec(`CREATE TABLE "${table.name}" (id TEXT PRIMARY KEY NOT NULL${colonnes.map((c) => `, ${c}`).join('')})`);
  }

  const abonnes = new Set<{ gestionnaire: GestionnaireChangement; tables: readonly string[] | undefined }>();
  const ecritures: string[] = [];
  let fileTransactions: Promise<unknown> = Promise.resolve();
  let enTransaction = false;
  let tablesTouchees = new Set<string>();

  function prevenir(tables: ReadonlySet<string>): void {
    if (tables.size === 0) return;
    for (const abonne of [...abonnes]) {
      const touchees = [...tables].filter((t) => abonne.tables === undefined || abonne.tables.includes(t));
      if (touchees.length > 0) void abonne.gestionnaire.onChange({ changedTables: touchees });
    }
  }

  function executerSync(sql: string, parametres?: readonly unknown[]): { rowsAffected: number } {
    const resultat = db.prepare(sql).run(...valeurs(parametres));
    const table = ECRITURE.exec(sql)?.[1];
    if (table !== undefined) {
      ecritures.push(sql.trim());
      if (enTransaction) tablesTouchees.add(table);
      else prevenir(new Set([table]));
    }
    return { rowsAffected: Number(resultat.changes) };
  }

  function lireSync<T>(sql: string, parametres?: readonly unknown[]): T[] {
    return db.prepare(sql).all(...valeurs(parametres)) as T[];
  }

  const transaction: TransactionMemoire = {
    getAll: <T>(sql: string, parametres?: readonly unknown[]) => Promise.resolve(lireSync<T>(sql, parametres)),
    execute: (sql, parametres) => Promise.resolve(executerSync(sql, parametres)),
  };

  return {
    ...transaction,
    get ecritures() {
      return ecritures;
    },
    writeTransaction<R>(fn: (tx: TransactionMemoire) => Promise<R>): Promise<R> {
      const suite = fileTransactions.then(async () => {
        db.exec('BEGIN');
        enTransaction = true;
        tablesTouchees = new Set();
        try {
          const r = await fn(transaction);
          db.exec('COMMIT');
          enTransaction = false;
          prevenir(tablesTouchees);
          return r;
        } catch (erreur) {
          db.exec('ROLLBACK');
          enTransaction = false;
          throw erreur;
        }
      });
      fileTransactions = suite.catch(() => undefined);
      return suite;
    },
    onChange(gestionnaire, options) {
      const abonne = { gestionnaire, tables: options?.tables };
      abonnes.add(abonne);
      return () => {
        abonnes.delete(abonne);
      };
    },
    lireDirect: lireSync,
    recevoir(sql, parametres) {
      executerSync(sql, parametres);
    },
    fermer() {
      abonnes.clear();
      db.close();
    },
  };
}

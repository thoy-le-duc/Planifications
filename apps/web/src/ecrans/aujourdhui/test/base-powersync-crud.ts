/**
 * T13o — variante du double fidèle PowerSync (./base-powersync.ts) AVEC la file d'envoi `ps_crud`.
 *
 * Le double de base (T13b) range chaque table comme PowerSync (table interne `ps_data__<table>`
 * en JSON, vue `<table>`, index d'expression, déclencheurs INSTEAD OF), mais ses déclencheurs
 * n'écrivent que dans `ps_data__<table>` : il n'a ni `ps_crud` ni `ps_tx`. Il sert à d'autres
 * tests (grande ferme, isolement, journal…) : on ne le modifie pas, on le complète ici.
 *
 * Comme le cœur de PowerSync (powersync-sqlite-core) pour une table JSON non locale :
 *   - `ps_crud(id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, tx_id INTEGER)` : l'id n'est
 *     jamais réutilisé, même après un DELETE ;
 *   - chaque écriture PAR LA VUE ajoute une ligne à `ps_crud`, dans la même transaction SQLite :
 *       INSERT → {"op":"PUT","type":<table>,"id":…,"data":{toutes les colonnes}}
 *       UPDATE → {"op":"PATCH","type":<table>,"id":…,"data":{colonnes changées seulement}}
 *       DELETE → {"op":"DELETE","type":<table>,"id":…}
 *   - `tx_id` : numéro de la transaction d'écriture (`ps_tx`), un par `writeTransaction` ;
 *   - une écriture DIRECTE dans `ps_data__<table>` (comme la synchro descendante) n'ajoute rien
 *     à `ps_crud`.
 *
 * Outil de test : jamais importé par l'appli.
 */
import type { BaseLocale } from '@planif/sync';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './base-powersync.ts';

export interface OperationCrud {
  readonly id: number;
  readonly txId: number | null;
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly type: string;
  readonly ligneId: string;
  readonly data: Readonly<Record<string, unknown>> | null;
}

export interface BasePowerSyncCrud extends BasePowerSync {
  /** La file d'envoi, dans l'ordre (pour les assertions). */
  crud(): OperationCrud[];
}

const q = (nom: string): string => `"${nom.replaceAll('"', '""')}"`;
const lit = (texte: string): string => `'${texte.replaceAll("'", "''")}'`;

/** Déclencheurs de vue de PowerSync, avec l'écriture dans `ps_crud`. */
function declencheurs(schema: SchemaJson): string[] {
  const ordres: string[] = [];
  for (const t of schema.tables) {
    const interne = q(`ps_data__${t.name}`);
    const vue = q(t.name);
    const type = lit(t.name);
    const cols = t.columns.filter((c) => c.name !== 'id');
    const objet = (prefixe: string) => `json_object(${cols.map((c) => `${lit(c.name)}, ${prefixe}.${q(c.name)}`).join(', ')})`;
    // Colonnes changées seulement (powersync_diff) : clés de NEW dont la valeur diffère de OLD.
    const diff = `(SELECT json_group_object(n.key, n.value) FROM json_each(${objet('NEW')}) n
      WHERE n.value IS NOT (SELECT o.value FROM json_each(${objet('OLD')}) o WHERE o.key = n.key))`;
    const crud = (op: string, id: string, data: string | null) =>
      `INSERT INTO ps_crud (tx_id, data) SELECT current_tx, json_object('op', ${lit(op)}, 'type', ${type}, 'id', ${id}${data === null ? '' : `, 'data', json(${data})`}) FROM ps_tx WHERE id = 1;`;
    for (const sorte of ['insert', 'update', 'delete']) ordres.push(`DROP TRIGGER IF EXISTS ${q(`ps_view_${sorte}_${t.name}`)}`);
    ordres.push(`CREATE TRIGGER ${q(`ps_view_insert_${t.name}`)} INSTEAD OF INSERT ON ${vue} FOR EACH ROW BEGIN
      SELECT CASE WHEN (NEW.id IS NULL) THEN RAISE (FAIL, 'id is required') END;
      INSERT INTO ${interne} (id, data) VALUES (NEW.id, ${objet('NEW')});
      ${crud('PUT', 'NEW.id', objet('NEW'))}
    END`);
    ordres.push(`CREATE TRIGGER ${q(`ps_view_update_${t.name}`)} INSTEAD OF UPDATE ON ${vue} FOR EACH ROW BEGIN
      SELECT CASE WHEN (OLD.id != NEW.id) THEN RAISE (FAIL, 'Cannot update id') END;
      UPDATE ${interne} SET data = ${objet('NEW')} WHERE id = OLD.id;
      ${crud('PATCH', 'NEW.id', diff)}
    END`);
    ordres.push(`CREATE TRIGGER ${q(`ps_view_delete_${t.name}`)} INSTEAD OF DELETE ON ${vue} FOR EACH ROW BEGIN
      DELETE FROM ${interne} WHERE id = OLD.id;
      ${crud('DELETE', 'OLD.id', null)}
    END`);
  }
  return ordres;
}

export function creerBasePowerSyncCrud(schema: SchemaJson): BasePowerSyncCrud {
  const base = creerBasePowerSync(schema);
  base.exec('CREATE TABLE ps_crud (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, tx_id INTEGER)');
  base.exec('CREATE TABLE ps_tx (id INTEGER PRIMARY KEY NOT NULL, current_tx INTEGER, next_tx INTEGER)');
  base.exec('INSERT INTO ps_tx (id, current_tx, next_tx) VALUES (1, NULL, 1)');
  for (const ordre of declencheurs(schema)) base.exec(ordre);

  const writeTransaction: BaseLocale['writeTransaction'] = (fn) =>
    base.writeTransaction(async (tx) => {
      // Une transaction d'écriture = un numéro (powersync_crud_ fait de même à la première écriture).
      await tx.execute('UPDATE ps_tx SET current_tx = next_tx, next_tx = next_tx + 1 WHERE id = 1');
      return fn(tx);
    });

  return {
    ...base,
    writeTransaction,
    crud() {
      return base
        .lireDirect<{ id: number; tx_id: number | null; data: string }>('SELECT id, tx_id, data FROM ps_crud ORDER BY id')
        .map((l) => {
          const d = JSON.parse(l.data) as { op: OperationCrud['op']; type: string; id: string; data?: Readonly<Record<string, unknown>> };
          return { id: l.id, txId: l.tx_id, op: d.op, type: d.type, ligneId: d.id, data: d.data ?? null };
        });
    },
  };
}

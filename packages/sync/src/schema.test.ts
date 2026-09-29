/**
 * Le schéma local (T10) suit le schéma Postgres de @planif/db : mêmes tables synchronisées, mêmes
 * colonnes, sauf ce qui ne doit jamais descendre sur un téléphone.
 */
import * as db from '@planif/db';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL, TABLES_LOCALES } from './schema.ts';

/** Tables de Postgres jamais synchronisées. */
const NON_SYNCHRONISEES = ['code_connexion', 'jeton_renouvellement'];
/** Colonnes jamais synchronisées (secrets d'autrui, données brutes d'un refus). */
const COLONNES_EXCLUES: Readonly<Record<string, readonly string[]>> = {
  utilisateur: ['email'],
  refus_synchro: ['donnees'],
};

const tablesPostgres = (Object.values(db) as unknown[])
  .filter((v): v is PgTable => v instanceof PgTable)
  .map((t) => getTableConfig(t));

describe('schéma local', () => {
  it('une table locale par table Postgres synchronisée', () => {
    const attendues = tablesPostgres.map((t) => t.name).filter((n) => !NON_SYNCHRONISEES.includes(n));
    expect(Object.keys(TABLES_LOCALES).sort()).toEqual(attendues.sort());
  });

  it.each(tablesPostgres.filter((t) => !NON_SYNCHRONISEES.includes(t.name)).map((t) => [t.name, t] as const))(
    '%s : mêmes colonnes que Postgres, sans les colonnes exclues',
    (nom, config) => {
      const exclues = COLONNES_EXCLUES[nom] ?? [];
      const attendues = config.columns.map((c) => c.name).filter((c) => c !== 'id' && !exclues.includes(c));
      const locale = SCHEMA_LOCAL.tables.find((t) => t.name === nom);
      expect(locale?.columns.map((c) => c.name).sort()).toEqual(attendues.sort());
    },
  );
});

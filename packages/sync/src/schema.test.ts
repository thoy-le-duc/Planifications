/**
 * Le schéma local (T10) suit le schéma Postgres de @planif/db : mêmes tables synchronisées, mêmes
 * colonnes, sauf ce qui ne doit jamais descendre sur un téléphone.
 */
import { readFileSync } from 'node:fs';
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

  it('T10e : serie.rotation_acceptee, jsonb nullable dans Postgres, descend sur le téléphone en texte JSON', () => {
    const colonne = tablesPostgres.find((t) => t.name === 'serie')?.columns.find((c) => c.name === 'rotation_acceptee');
    expect(colonne?.getSQLType()).toBe('jsonb');
    expect(colonne?.notNull).toBe(false);
    const serieLocale: Readonly<Record<string, string>> = TABLES_LOCALES.serie;
    expect(serieLocale.rotation_acceptee).toBe('texte');
  });

  it('T23 : type_intervention descend sur le téléphone (masque en entier 0 / 1, comme les autres booléens)', () => {
    const locale: Readonly<Record<string, string>> | undefined = (TABLES_LOCALES as Readonly<Record<string, Readonly<Record<string, string>>>>)
      .type_intervention;
    expect(locale).toEqual({
      ferme_id: 'texte',
      categorie: 'texte',
      libelle: 'texte',
      masque: 'entier',
      cree_le: 'texte',
      modifie_le: 'texte',
      supprime_le: 'texte',
    });
  });

  it('T23 : les règles de synchro servent les types de la ferme et la liste de départ (ferme_id nul)', () => {
    const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');
    const requetes = [...regles.matchAll(/query:\s*(SELECT[^\n]*FROM type_intervention[^\n]*)/g)].map((r) => (r[1] ?? '').trim());
    expect(requetes).toContain('SELECT * FROM type_intervention WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives)');
    expect(requetes).toContain('SELECT * FROM type_intervention WHERE ferme_id IS NULL');
    expect(requetes).toHaveLength(2);
  });
});

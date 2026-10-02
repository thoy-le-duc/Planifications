/**
 * Le schéma local (T10) suit le schéma Postgres de @planif/db : mêmes tables synchronisées, mêmes
 * colonnes, sauf ce qui ne doit jamais descendre sur un téléphone.
 */
import { readdirSync, readFileSync } from 'node:fs';
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

/** T10k : résumé de la saisie refusée, calculé par le serveur (apps/api/src/sync/resume-refus.integration.test.ts). */
const COLONNES_RESUME_SAISIE = ['saisie_type', 'saisie_culture', 'saisie_date', 'saisie_quantite', 'saisie_unite'] as const;

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

  it('T10k : le résumé de la saisie refusée (5 colonnes nullables) descend sur le téléphone, jamais les données reçues', () => {
    const postgres = tablesPostgres.find((t) => t.name === 'refus_synchro')?.columns ?? [];
    for (const nom of COLONNES_RESUME_SAISIE) {
      const c = postgres.find((x) => x.name === nom);
      expect(c, `refus_synchro.${nom} dans Postgres`).toBeDefined();
      expect(c?.notNull, `refus_synchro.${nom} nullable (un refus sans résumé reste possible)`).toBe(false);
    }
    expect(postgres.find((c) => c.name === 'saisie_quantite')?.getSQLType(), 'un nombre, pas un texte : il descend en réel').toBe('double precision');
    const locale: Readonly<Record<string, string>> = TABLES_LOCALES.refus_synchro;
    expect(Object.fromEntries(COLONNES_RESUME_SAISIE.map((c) => [c, locale[c]]))).toEqual({
      saisie_type: 'texte',
      saisie_culture: 'texte',
      saisie_date: 'texte',
      saisie_quantite: 'reel',
      saisie_unite: 'texte',
    });

    const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');
    // Requête sur une ligne, ou repliée (`>-`) sur les lignes plus indentées qui suivent.
    const requetes = [...regles.matchAll(/query:[ \t]*(?:>-?[ \t]*\n((?:[ \t]{6,}[^\n]*\n?)+)|(SELECT[^\n]*))/g)]
      .map((r) => (r[1] ?? r[2] ?? '').replace(/\s+/g, ' ').trim())
      .filter((q) => /\bFROM refus_synchro\b/.test(q));
    expect(requetes, 'un seul flux pour refus_synchro').toHaveLength(1);
    const colonnes = (/^SELECT (.*?) FROM refus_synchro/.exec(requetes[0] ?? '')?.[1] ?? '').split(',').map((c) => c.trim());
    for (const nom of COLONNES_RESUME_SAISIE) expect(colonnes, `${nom} dans le flux refus_synchro`).toContain(nom);
    expect(colonnes, 'jamais les données reçues').not.toContain('donnees');
    expect(colonnes, 'jamais toutes les colonnes').not.toContain('*');
    expect(requetes[0], 'toujours au seul auteur').toMatch(/WHERE utilisateur_id = auth\.user_id\(\)$/);
  });

  it('T10l : archive_le (instant nullable) descend sur le téléphone, archivés compris, toujours au seul auteur', () => {
    const c = (tablesPostgres.find((t) => t.name === 'refus_synchro')?.columns ?? []).find((x) => x.name === 'archive_le');
    expect(c, 'refus_synchro.archive_le dans Postgres').toBeDefined();
    expect(c?.notNull, 'nulle par défaut : un refus naît non archivé').toBe(false);
    expect(c?.getSQLType(), 'un instant avec fuseau').toBe('timestamp with time zone');
    const locale: Readonly<Record<string, string>> = TABLES_LOCALES.refus_synchro;
    expect(locale.archive_le, 'colonne locale en texte (instant ISO)').toBe('texte');

    const migrations = readdirSync(new URL('../../db/migrations/', import.meta.url)).filter((f) => /^0024_.*\.sql$/.test(f));
    expect(migrations, 'migration 0024 de packages/db').toHaveLength(1);
    const sqlMigration = readFileSync(new URL(`../../db/migrations/${migrations[0] ?? ''}`, import.meta.url), 'utf8');
    expect(sqlMigration).toMatch(/refus_synchro[\s\S]*archive_le/);

    const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');
    const requetes = [...regles.matchAll(/query:[ \t]*(?:>-?[ \t]*\n((?:[ \t]{6,}[^\n]*\n?)+)|(SELECT[^\n]*))/g)]
      .map((r) => (r[1] ?? r[2] ?? '').replace(/\s+/g, ' ').trim())
      .filter((q) => /\bFROM refus_synchro\b/.test(q));
    expect(requetes, 'un seul flux pour refus_synchro').toHaveLength(1);
    const colonnes = (/^SELECT (.*?) FROM refus_synchro/.exec(requetes[0] ?? '')?.[1] ?? '').split(',').map((x) => x.trim());
    expect(colonnes, 'archive_le dans le flux refus_synchro').toContain('archive_le');
    expect(colonnes, 'jamais les données reçues').not.toContain('donnees');
    // Les archivés descendent aussi (rien n'est perdu sur le téléphone) : aucun filtre sur archive_le.
    expect(requetes[0], 'toujours au seul auteur, archivés compris').toMatch(/WHERE utilisateur_id = auth\.user_id\(\)$/);
  });

  it('T23 : les règles de synchro servent les types de la ferme et la liste de départ (ferme_id nul)', () => {
    const regles = readFileSync(new URL('../../../powersync/sync-config.yaml', import.meta.url), 'utf8');
    const requetes = [...regles.matchAll(/query:\s*(SELECT[^\n]*FROM type_intervention[^\n]*)/g)].map((r) => (r[1] ?? '').trim());
    expect(requetes).toContain('SELECT * FROM type_intervention WHERE ferme_id IN (SELECT ferme_id FROM fermes_actives)');
    expect(requetes).toContain('SELECT * FROM type_intervention WHERE ferme_id IS NULL');
    expect(requetes).toHaveLength(2);
  });
});

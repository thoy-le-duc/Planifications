/**
 * T67 (relecture) : le garde-fou « publication ↔ flux » rejoue les migrations en lisant leur SQL.
 * Ce test prouve que cette lecture dit vrai : sur une base neuve migrée par `migrate`, la
 * publication `powersync` de PostgreSQL (pg_publication_tables) contient exactement les tables que
 * `tablesPublieesPowerSync` déduit du texte des migrations.
 *
 * DATABASE_URL : URL d'un Postgres dont l'utilisateur peut créer et supprimer des bases (comme les
 * autres tests d'intégration de @planif/db). Sans DATABASE_URL : sauté.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tablesPublieesPowerSync } from './test/publication-flux.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;
const DOSSIER_MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

function migrationsDansLOrdre(): string[] {
  const journal = JSON.parse(readFileSync(`${DOSSIER_MIGRATIONS}meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entree) => readFileSync(`${DOSSIER_MIGRATIONS}${entree.tag}.sql`, 'utf8'));
}

decrireAvecBase('T67 : la lecture des migrations dit vrai (PostgreSQL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t67_${randomUUID().replaceAll('-', '').slice(0, 16)}`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await migrate(drizzle(c), { migrationsFolder: DOSSIER_MIGRATIONS });
  });

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  });

  it('pg_publication_tables (publication powersync) = tables déduites du texte des migrations', async () => {
    const r = await c.query<{ nom: string }>(
      `SELECT tablename::text AS nom FROM pg_publication_tables WHERE pubname = 'powersync' AND schemaname = 'public' ORDER BY 1`,
    );
    const reelles = r.rows.map((ligne) => ligne.nom).sort();
    expect(reelles.length).toBeGreaterThan(0);
    expect(tablesPublieesPowerSync(migrationsDansLOrdre())).toEqual(reelles);
  });
});

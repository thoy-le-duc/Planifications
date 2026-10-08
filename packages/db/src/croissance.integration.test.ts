/**
 * Tests d'acceptation T32a — profil de croissance en base (docs/backlog/T32a-croissance-profils.md,
 * « Réglage par la ferme, stockage validé (Q32, option A) » et critère « Migration, synchro et
 * export »).
 *
 * ── Schéma attendu ──────────────────────────────────────────────────────────────────────────
 *
 *   espece.profil_croissance   jsonb, NULLABLE, SANS DÉFAUT : nul = profil par défaut de
 *                              l'espèce (les défauts vivent dans @planif/core, pas en base).
 *   CHECK : nul, ou objet jsonb (jsonb_typeof = 'object') ; un tableau, un texte, un nombre, un
 *           booléen ou le null JSON sont refusés (23514). Les bornes du profil (hauteur, durée,
 *           champs inconnus…) sont celles du cœur, rejouées par le serveur (apps/api).
 * Migration GÉNÉRÉE par drizzle-kit (Drizzle : colonne `profilCroissance` de `espece`), numérotée
 * après 0028 ; elle n'écrit aucune ligne : les fermes existantes ne changent pas.
 *
 * Exécution comme placement.integration.test.ts : DATABASE_URL (Postgres avec CREATEDB) ; sans
 * elle, sautés en local (l'échec clair en CI est porté par schema.integration.test.ts).
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const VIOLATION_CHECK = '23514';

/** Dernière migration avant T32a (0028_placement_zone_abritee_publication). */
const DERNIERE_AVANT_T32A = 28;

function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

async function codeErreur(requete: Promise<unknown>): Promise<string> {
  try {
    await requete;
  } catch (e) {
    return (e as { code?: string }).code ?? 'sans code';
  }
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T32a)');
}

const tablesDrizzle = () =>
  (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));

interface Journal {
  entries: { idx: number; tag: string }[];
}

const DOSSIER = new URL('../migrations/', import.meta.url);
const lireJournal = (): Journal => JSON.parse(readFileSync(new URL('meta/_journal.json', DOSSIER), 'utf8')) as Journal;

describe('T32a : schéma Drizzle et migration générée', () => {
  it('@planif/db déclare espece.profil_croissance, jsonb nullable sans défaut', () => {
    const colonne = tablesDrizzle()
      .find((t) => t.name === 'espece')
      ?.columns.find((c) => c.name === 'profil_croissance');
    expect(colonne, 'colonne espece.profil_croissance').toBeDefined();
    expect(colonne?.getSQLType()).toBe('jsonb');
    expect(colonne?.notNull).toBe(false);
    expect(colonne?.hasDefault).toBe(false);
  });

  it('le dernier instantané de drizzle-kit la connaît : migration générée, pas écrite à la main', () => {
    const dernier = lireJournal().entries.at(-1)?.idx ?? -1;
    expect(dernier, 'une migration après 0028').toBeGreaterThan(DERNIERE_AVANT_T32A);
    const nom = `${String(dernier).padStart(4, '0')}_snapshot.json`;
    const instantane = JSON.parse(readFileSync(new URL(`meta/${nom}`, DOSSIER), 'utf8')) as {
      tables: Record<string, { columns: Record<string, unknown> } | undefined>;
    };
    expect(Object.keys(instantane.tables['public.espece']?.columns ?? {}), `public.espece dans ${nom}`).toContain('profil_croissance');
  });

  it('les fermes existantes ne changent pas : la migration du ticket n’écrit aucune ligne', () => {
    const nouvelles = readdirSync(DOSSIER)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) > DERNIERE_AVANT_T32A)
      .map((f) => ({ f, sql: readFileSync(new URL(f, DOSSIER), 'utf8') }))
      .filter(({ sql }) => sql.includes('profil_croissance'));
    expect(nouvelles.length, 'au moins une migration T32a (0029 ou après)').toBeGreaterThan(0);
    for (const { f, sql } of nouvelles) {
      expect(sql, f).not.toMatch(/\bUPDATE\b/i);
      expect(sql, f).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(sql, f).not.toMatch(/\bINSERT\s+INTO\b/i);
      for (const ajout of sql.match(/ADD COLUMN[^;]*profil_croissance[^;]*/gi) ?? []) {
        expect(ajout, f).not.toMatch(/\bNOT NULL\b|\bDEFAULT\b/i);
      }
    }
  });
});

decrireAvecBase('T32a : profil de croissance en base (PostgreSQL)', { timeout: 60_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t32a_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const autreFerme = randomUUID();
  const famille = randomUUID();
  /** Lignes écrites AVANT la migration du ticket (base arrêtée à 0028). */
  const anciennes = { tomate: randomUUID(), voisine: randomUUID(), bibliotheque: randomUUID(), familleBiblio: randomUUID() };
  let avantMigration: Map<string, { xmin: string; ligne: Record<string, unknown> }>;
  let historiqueAvant = -1;
  let dossierPartiel = '';

  /** Copie des migrations jusqu'à 0028 comprise, pour migrer en deux temps. */
  function migrationsJusquA(idx: number): string {
    const dossier = mkdtempSync(join(tmpdir(), 't32a-migrations-'));
    mkdirSync(join(dossier, 'meta'));
    const journal = lireJournal();
    const gardees = journal.entries.filter((e) => e.idx <= idx);
    for (const e of gardees) copyFileSync(new URL(`${e.tag}.sql`, DOSSIER), join(dossier, `${e.tag}.sql`));
    writeFileSync(join(dossier, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: gardees }));
    return dossier;
  }

  async function lignesEspece(): Promise<Map<string, { xmin: string; ligne: Record<string, unknown> }>> {
    const r = await c.query<{ id: string; xmin: string; ligne: Record<string, unknown> }>(
      `SELECT id::text, xmin::text, to_jsonb(e) - 'profil_croissance' AS ligne FROM espece e ORDER BY id`,
    );
    return new Map(r.rows.map((l) => [l.id, { xmin: l.xmin, ligne: l.ligne }]));
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    // 1. La base telle qu'elle était avant T32a.
    dossierPartiel = migrationsJusquA(DERNIERE_AVANT_T32A);
    const avant = new pg.Client({ connectionString: urlDe(base) });
    await avant.connect();
    try {
      await migrate(drizzle(avant), { migrationsFolder: dossierPartiel });
    } finally {
      await avant.end();
    }
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T32a', 'Europe/Paris'), ($2, 'Ferme voisine', 'Europe/Paris')`, [ferme, autreFerme]);
    await c.query(
      `INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4), ($3, NULL, 'Solanacées', 3, 4)`,
      [famille, ferme, anciennes.familleBiblio],
    );
    await c.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES
         ($1, $2, $3, 'Tomate', 'legume', false, 'kg'),
         ($4, $5, $6, 'Tomate', 'legume', false, 'kg'),
         ($7, NULL, $6, 'Tomate', 'legume', false, 'kg')`,
      [anciennes.tomate, ferme, famille, anciennes.voisine, autreFerme, anciennes.familleBiblio, anciennes.bibliotheque],
    );
    avantMigration = await lignesEspece();
    historiqueAvant = Number((await c.query<{ n: string }>(`SELECT count(*) AS n FROM modification`)).rows[0]?.n ?? -1);
    // 2. Migration du ticket (et toutes les suivantes), comme en production.
    await db.appliquerMigrations(urlDe(base));
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
    if (dossierPartiel !== '') rmSync(dossierPartiel, { recursive: true, force: true });
  }, 60_000);

  async function espece(profil: string | null, fermeId: string | null = ferme): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte, profil_croissance)
       VALUES ($1, $2, $3, 'Tomate', 'legume', false, 'kg', $4::jsonb)`,
      [id, fermeId, fermeId === null ? anciennes.familleBiblio : famille, profil],
    );
    return id;
  }

  const PROFIL = { forme: 'erige-tuteure', hauteurMaxM: 2, duree: { en: 'jours', jours: 90 }, allure: 'en-s', finDeCycle: 'conservee', cycleAnnuel: null };

  describe('migration', () => {
    it('colonne jsonb, nullable, sans défaut', async () => {
      const r = await c.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT data_type::text, is_nullable::text, column_default::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'espece' AND column_name = 'profil_croissance'`,
      );
      expect(r.rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES', column_default: null }]);
    });

    it('espèces écrites avant la migration : profil nul, ligne identique, jamais réécrite (même version de ligne)', async () => {
      const apres = await lignesEspece();
      for (const [id, l] of avantMigration) {
        expect(apres.get(id)?.ligne, id).toEqual(l.ligne);
        expect(apres.get(id)?.xmin, `${id} : la migration n'a pas réécrit la ligne`).toBe(l.xmin);
      }
      const profils = await c.query<{ p: unknown }>(`SELECT profil_croissance AS p FROM espece WHERE id = ANY($1::uuid[])`, [[...avantMigration.keys()]]);
      expect(profils.rows.map((l) => l.p)).toEqual([null, null, null]);
    });

    it('la migration n’ajoute aucune ligne d’historique', async () => {
      const n = Number((await c.query<{ n: string }>(`SELECT count(*) AS n FROM modification`)).rows[0]?.n ?? -1);
      expect(n).toBe(historiqueAvant);
    });

    it('une espèce saisie comme avant (sans la colonne) : profil nul', async () => {
      const id = randomUUID();
      await c.query(`INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'Laitue', 'legume', false, 'piece')`, [
        id,
        ferme,
        famille,
      ]);
      const r = await c.query<{ p: unknown }>(`SELECT profil_croissance AS p FROM espece WHERE id = $1`, [id]);
      expect(r.rows).toEqual([{ p: null }]);
    });
  });

  describe('contrainte : nul ou objet jsonb', () => {
    it('objet : accepté, relu tel quel', async () => {
      const id = await espece(JSON.stringify(PROFIL));
      const r = await c.query<{ p: unknown }>(`SELECT profil_croissance AS p FROM espece WHERE id = $1`, [id]);
      expect(r.rows[0]?.p).toEqual(PROFIL);
    });

    it('nul : accepté (profil par défaut)', async () => {
      await espece(null);
    });

    it.each([['[1,2]'], ['"tomate"'], ['2'], ['true'], ['null']])('%s : refusé', async (valeur) => {
      expect(await codeErreur(espece(valeur))).toBe(VIOLATION_CHECK);
    });

    it('modifier un profil vers un tableau : refusé, la ligne garde son profil', async () => {
      const id = await espece(JSON.stringify(PROFIL));
      expect(await codeErreur(c.query(`UPDATE espece SET profil_croissance = '[]'::jsonb WHERE id = $1`, [id]))).toBe(VIOLATION_CHECK);
      const r = await c.query<{ p: unknown }>(`SELECT profil_croissance AS p FROM espece WHERE id = $1`, [id]);
      expect(r.rows[0]?.p).toEqual(PROFIL);
    });
  });

  describe('isolement entre fermes', () => {
    it('régler le profil de la tomate d’une ferme ne touche ni la tomate voisine ni celle de la bibliothèque', async () => {
      await c.query(`UPDATE espece SET profil_croissance = $2::jsonb WHERE id = $1`, [anciennes.tomate, JSON.stringify({ ...PROFIL, hauteurMaxM: 1.4 })]);
      const r = await c.query<{ id: string; p: { hauteurMaxM?: number } | null }>(
        `SELECT id::text, profil_croissance AS p FROM espece WHERE id = ANY($1::uuid[])`,
        [[anciennes.tomate, anciennes.voisine, anciennes.bibliotheque]],
      );
      const parId = new Map(r.rows.map((l) => [l.id, l.p]));
      expect(parId.get(anciennes.tomate)?.hauteurMaxM).toBe(1.4);
      expect(parId.get(anciennes.voisine)).toBeNull();
      expect(parId.get(anciennes.bibliotheque)).toBeNull();
    });
  });

  describe('synchro', () => {
    it('espece reste dans la publication « powersync » (le profil descend avec la ligne)', async () => {
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = 'espece'`,
      );
      expect(r.rows[0]?.n).toBe(1);
    });
  });
});

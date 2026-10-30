/**
 * Tests d'acceptation T88 — une serre découpée en zones : chapelles × tronçons, en base
 * (docs/backlog/T88-serre-en-grille-modele.md, règle 1 et critère « Tests de base »).
 *
 * ── Schéma attendu ──────────────────────────────────────────────────────────────────────────
 *
 *   batiment.nb_chapelles     integer, facultative ; 1 à 100.
 *   batiment.nb_troncons      integer, facultative ; 1 à 50.
 *   batiment.largeur_allee_m  numeric, facultative ; ≥ 0, au millimètre (au plus 3 décimales : refusée sinon).
 *   Grille qui tient : longueur_m − (nb_troncons − 1) × largeur_allee_m > 0 (nb_troncons et allée nuls = 1 et 0).
 *
 * Drizzle : `nbChapelles`, `nbTroncons`, `largeurAlleeM` sur la table `batiment` de @planif/db.
 * Migration GÉNÉRÉE par drizzle-kit (0048 ou après), qui ne réécrit aucune ligne existante. Violations en 23514 (CHECK).
 * Exécution comme etat-abri.integration.test.ts : DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;
const VIOLATION_CHECK = '23514';

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
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T88)');
}

describe('T88 : schéma Drizzle et migration générée', () => {
  const colonnes = () => {
    const t = (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((x) => getTableConfig(x)).find((x) => x.name === 'batiment');
    return t?.columns ?? [];
  };

  it('batiment a nb_chapelles et nb_troncons (entiers) et largeur_allee_m (numérique), tous facultatifs', () => {
    const c = (nom: string) => colonnes().find((x) => x.name === nom);
    expect(c('nb_chapelles')?.columnType).toBe('PgInteger');
    expect(c('nb_troncons')?.columnType).toBe('PgInteger');
    expect(c('largeur_allee_m')?.columnType).toBe('PgNumeric');
    for (const nom of ['nb_chapelles', 'nb_troncons', 'largeur_allee_m']) expect(c(nom)?.notNull, nom).toBe(false);
  });

  it('le dernier instantané de drizzle-kit connaît les colonnes : migration générée, pas écrite à la main', () => {
    const meta = new URL('../migrations/meta/', import.meta.url);
    const journal = JSON.parse(readFileSync(new URL('_journal.json', meta), 'utf8')) as { entries: { idx: number }[] };
    const dernier = journal.entries.at(-1)?.idx ?? -1;
    expect(dernier, 'une migration après 0047').toBeGreaterThanOrEqual(48);
    const nom = `${String(dernier).padStart(4, '0')}_snapshot.json`;
    const instantane = JSON.parse(readFileSync(new URL(nom, meta), 'utf8')) as { tables: Record<string, { columns: Record<string, unknown> } | undefined> };
    const cles = Object.keys(instantane.tables['public.batiment']?.columns ?? {});
    for (const nom2 of ['nb_chapelles', 'nb_troncons', 'largeur_allee_m']) expect(cles).toContain(nom2);
  });

  it('les migrations du ticket ne réécrivent aucune ligne existante', () => {
    const dossier = new URL('../migrations/', import.meta.url);
    const nouvelles = readdirSync(dossier).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 48);
    expect(nouvelles.length, 'au moins une migration T88 (0048 ou après)').toBeGreaterThan(0);
    for (const f of nouvelles) {
      const sql = readFileSync(new URL(f, dossier), 'utf8');
      expect(sql, f).not.toMatch(/\bUPDATE\s+"?(ferme|zone|emplacement|batiment|evenement|serie)"?\s+SET\b/i);
      expect(sql, f).not.toMatch(/\bDELETE\s+FROM\b/i);
    }
  });
});

decrireAvecBase('T88 : serre en grille en base (PostgreSQL)', { timeout: 30_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t88_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  /** Bâtiment d'avant la migration : sans les trois colonnes (insertion sans les nommer). */
  const ancien = randomUUID();

  /** Serre à légumes de la ferme : 128,8 × 57,6 m. Les colonnes de la grille, dans l'ordre : chapelles, tronçons, allée. */
  function serre(grille: readonly [unknown, unknown, unknown], longueur = 128.8, id: string = randomUUID()): Promise<unknown> {
    return c.query(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, nb_chapelles, nb_troncons, largeur_allee_m)
       VALUES ($1, $2, $3, 'serre_chapelle', $4, 57.6, 5, 0, 0, 0, $5, $6, $7)`,
      [id, ferme, `Serre ${id.slice(0, 6)}`, longueur, grille[0], grille[1], grille[2]],
    );
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    await db.appliquerMigrations(urlDe(base));
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T88', 'Europe/Paris')`, [ferme]);
    await c.query(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg)
       VALUES ($1, $2, 'Tunnel Manon', 'serre_tunnel', 40, 28.8, 4, 10, 10, 0)`,
      [ancien, ferme],
    );
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  it('migration aller : un bâtiment qui n’a pas les colonnes les a nulles (comportement de T86)', async () => {
    const r = await c.query<{ nb_chapelles: number | null; nb_troncons: number | null; largeur_allee_m: string | null }>(
      `SELECT nb_chapelles, nb_troncons, largeur_allee_m FROM batiment WHERE id = $1`,
      [ancien],
    );
    expect(r.rows[0]).toEqual({ nb_chapelles: null, nb_troncons: null, largeur_allee_m: null });
  });

  it('colonnes nulles acceptées (les trois, ou une partie)', async () => {
    await serre([null, null, null]);
    await serre([3, null, null]);
    await serre([null, 3, 4.4]);
  });

  it('serre à légumes : 6 chapelles, 3 tronçons, allée de 4,40 m → acceptée et relue telle quelle', async () => {
    const id = randomUUID();
    await serre([6, 3, 4.4], 128.8, id);
    const r = await c.query<{ nb_chapelles: number; nb_troncons: number; largeur_allee_m: string }>(`SELECT nb_chapelles, nb_troncons, largeur_allee_m FROM batiment WHERE id = $1`, [id]);
    expect(r.rows[0]).toMatchObject({ nb_chapelles: 6, nb_troncons: 3 });
    expect(Number(r.rows[0]?.largeur_allee_m)).toBe(4.4);
  });

  it('bornes comprises : 1 et 100 chapelles, 1 et 50 tronçons, allée nulle', async () => {
    await serre([1, 1, 0]);
    await serre([100, 50, 0]);
  });

  it('nb_chapelles hors bornes (0, −1, 101) : refusé', async () => {
    await serre([6, 3, 4.4]); // la forme valide passe d'abord
    for (const n of [0, -1, 101]) expect(await codeErreur(serre([n, null, null])), `nb_chapelles ${String(n)}`).toBe(VIOLATION_CHECK);
  });

  it('nb_troncons hors bornes (0, −1, 51) : refusé', async () => {
    await serre([6, 3, 4.4]); // la forme valide passe d'abord
    for (const n of [0, -1, 51]) expect(await codeErreur(serre([null, n, null])), `nb_troncons ${String(n)}`).toBe(VIOLATION_CHECK);
  });

  it('largeur d’allée négative, ou plus fine que le millimètre : refusée', async () => {
    await serre([6, 3, 4.4]); // la forme valide passe d'abord
    expect(await codeErreur(serre([6, 3, -0.001]))).toBe(VIOLATION_CHECK);
    expect(await codeErreur(serre([6, 3, 4.4005]))).toBe(VIOLATION_CHECK);
  });

  it('grille impossible : les allées mangent toute la longueur → refusé (128,8 m, 3 tronçons, allées de 64,4 m = 0)', async () => {
    await serre([6, 3, 64.39]); // 128,8 − 2 × 64,39 = 0,02 m : tient
    expect(await codeErreur(serre([6, 3, 64.4]))).toBe(VIOLATION_CHECK);
    expect(await codeErreur(serre([6, 3, 100]))).toBe(VIOLATION_CHECK);
  });

  it('grille impossible aussi en modifiant une serre existante (longueur réduite ou allée élargie)', async () => {
    const id = randomUUID();
    await serre([6, 3, 4.4], 128.8, id);
    expect(await codeErreur(c.query(`UPDATE batiment SET longueur_m = 8 WHERE id = $1`, [id]))).toBe(VIOLATION_CHECK); // 8 − 2 × 4,4 < 0
    expect(await codeErreur(c.query(`UPDATE batiment SET largeur_allee_m = 70 WHERE id = $1`, [id]))).toBe(VIOLATION_CHECK);
  });

  it('un seul tronçon : l’allée ne coupe rien, aucune grille impossible', async () => {
    await serre([3, 1, 500]);
  });

  it('allée nulle avec plusieurs tronçons : acceptée (allées de 0 m)', async () => {
    await serre([6, 3, null]);
  });
});

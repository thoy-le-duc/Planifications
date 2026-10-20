/**
 * Tests d'acceptation T54, PostgreSQL — produits fertilisants et option « zone vulnérable
 * nitrates » (docs/backlog/T54-cahier-fertilisation.md, règles 1 et 6 ; critère « migration
 * testée en intégration, rejouable ; interventions existantes intactes »).
 *
 * ── Schéma attendu ──────────────────────────────────────────────────────────────────────────
 *
 *   produit_fertilisant   id, ferme_id (NOT NULL, vers ferme : pas de bibliothèque commune),
 *                         nom (text, 1 à 200 caractères après trim), forme ('solide' | 'liquide'),
 *                         unite ('kg' | 't' | 'L' | 'm3'), teneur_n, teneur_p2o5, teneur_k2o
 *                         (nombres facultatifs, de 0 à 100 %), organique, utilisable_en_bio
 *                         (boolean NOT NULL), source (text NOT NULL, défaut '', 300 caractères au
 *                         plus), cree_le, modifie_le, supprime_le. Publiée (powersync).
 *   ferme.zone_vulnerable_nitrates   boolean NOT NULL DEFAULT false (Q44 : décochée par défaut).
 *
 * Migration GÉNÉRÉE par drizzle-kit après 0040 (seule retouche : l'ajout à la publication), sur
 * une base en service : les fermes existantes passent à false, les interventions (fertilisation
 * et amendement) ne sont pas réécrites ; rejouable : une seconde fois ne change rien.
 *
 * Exécution comme les autres tests d'intégration : DATABASE_URL (Postgres avec CREATEDB) ; sans
 * elle, sautés en local.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const VIOLATION_NOT_NULL = '23502';
/** Dernière migration avant T54 (0040_secteur_irrigation_placement). */
const DERNIERE_AVANT_T54 = 40;
const DOSSIER = new URL('../migrations/', import.meta.url);

interface Journal {
  entries: { idx: number; tag: string }[];
}
const lireJournal = (): Journal => JSON.parse(readFileSync(new URL('meta/_journal.json', DOSSIER), 'utf8')) as Journal;

function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

function migrationsJusquA(idx: number): string {
  const dossier = mkdtempSync(join(tmpdir(), 't54-migrations-'));
  mkdirSync(join(dossier, 'meta'));
  const journal = lireJournal();
  const gardees = journal.entries.filter((e) => e.idx <= idx);
  for (const e of gardees) copyFileSync(new URL(`${e.tag}.sql`, DOSSIER), join(dossier, `${e.tag}.sql`));
  writeFileSync(join(dossier, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: gardees }));
  return dossier;
}

async function codeErreur(requete: Promise<unknown>): Promise<string> {
  try {
    await requete;
  } catch (e) {
    return (e as { code?: string }).code ?? 'sans code';
  }
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T54)');
}

describe('T54 : schéma Drizzle', () => {
  const tables = () => (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));

  it('@planif/db déclare produit_fertilisant et ses colonnes', () => {
    const t = tables().find((x) => x.name === 'produit_fertilisant');
    expect(t, 'table produit_fertilisant').toBeDefined();
    const noms = t?.columns.map((c) => c.name) ?? [];
    for (const c of ['id', 'ferme_id', 'nom', 'forme', 'unite', 'teneur_n', 'teneur_p2o5', 'teneur_k2o', 'organique', 'utilisable_en_bio', 'source', 'cree_le', 'modifie_le', 'supprime_le']) {
      expect(noms, c).toContain(c);
    }
    expect(t?.columns.find((c) => c.name === 'ferme_id')?.notNull).toBe(true);
  });

  it('@planif/db déclare ferme.zone_vulnerable_nitrates, booléen non nul, faux par défaut', () => {
    const c = tables()
      .find((x) => x.name === 'ferme')
      ?.columns.find((x) => x.name === 'zone_vulnerable_nitrates');
    expect(c, 'colonne ferme.zone_vulnerable_nitrates').toBeDefined();
    expect(c?.getSQLType()).toBe('boolean');
    expect(c?.notNull).toBe(true);
    expect(c?.hasDefault).toBe(true);
  });

  it('une migration après 0040 crée la table et la publie', () => {
    const apres = lireJournal().entries.filter((e) => e.idx > DERNIERE_AVANT_T54);
    const textes = apres.map((e) => readFileSync(new URL(`${e.tag}.sql`, DOSSIER), 'utf8'));
    expect(textes.some((t) => t.includes('CREATE TABLE "produit_fertilisant"'))).toBe(true);
    expect(textes.some((t) => /ALTER PUBLICATION powersync ADD TABLE[^;]*produit_fertilisant/.test(t))).toBe(true);
  });
});

decrireAvecBase('T54 : produits fertilisants (PostgreSQL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t54_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const utilisateur = randomUUID();
  const emplacement = randomUUID();
  const intervention = randomUUID();
  let dossierPartiel = '';
  let xminIntervention = '';
  let detailAvant: unknown;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    dossierPartiel = migrationsJusquA(DERNIERE_AVANT_T54);
    const avant = new pg.Client({ connectionString: urlDe(base) });
    await avant.connect();
    try {
      await migrate(drizzle(avant), { migrationsFolder: dossierPartiel });
    } finally {
      await avant.end();
    }
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T54', 'Europe/Paris')`, [ferme]);
    await c.query(`INSERT INTO utilisateur (id, nom, email) VALUES ($1, 'Théo', $2)`, [utilisateur, `t54-${utilisateur}@exemple.test`]);
    const zone = randomUUID();
    await c.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Plein champ', 'plein_champ')`, [zone, ferme]);
    await c.query(`INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, largeur_m, actif_du) VALUES ($1, $2, $3, 'P1', 'planche', 50, 2, '2026-01-01')`, [emplacement, ferme, zone]);
    await c.query(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, detail)
       VALUES ($1, $2, 'intervention', '2026-03-10', '2026-03-10T08:00:00Z', $3, 'tap', ARRAY[$4]::uuid[],
               '{"categorie":"amendement","type":"compost","outil":null,"produit":"compost","quantite":{"valeur":2,"unite":"t"}}'::jsonb)`,
      [intervention, ferme, utilisateur, emplacement],
    );
    const r = await c.query<{ xmin: string; detail: unknown }>(`SELECT xmin::text, detail FROM evenement WHERE id = $1`, [intervention]);
    xminIntervention = r.rows[0]?.xmin ?? '';
    detailAvant = r.rows[0]?.detail;
    await db.appliquerMigrations(urlDe(base));
  }, 180_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
    if (dossierPartiel !== '') rmSync(dossierPartiel, { recursive: true, force: true });
  }, 60_000);

  const inserer = (autres: Record<string, unknown> = {}) => {
    const l: Record<string, unknown> = { id: randomUUID(), ferme_id: ferme, nom: 'Compost de déchets verts', forme: 'solide', unite: 't', teneur_n: 1, teneur_p2o5: null, teneur_k2o: null, organique: true, utilisable_en_bio: true, ...autres };
    const cols = Object.keys(l);
    return c.query(`INSERT INTO produit_fertilisant (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${String(i + 1)}`).join(', ')})`, Object.values(l));
  };

  describe('migration des fermes en service', () => {
    it('ferme existante : zone vulnérable décochée', async () => {
      const r = await c.query<{ z: boolean }>(`SELECT zone_vulnerable_nitrates AS z FROM ferme WHERE id = $1`, [ferme]);
      expect(r.rows[0]?.z).toBe(false);
    });

    it('intervention existante (amendement) : jamais réécrite, détail identique', async () => {
      const r = await c.query<{ xmin: string; detail: unknown }>(`SELECT xmin::text, detail FROM evenement WHERE id = $1`, [intervention]);
      expect(r.rows[0]?.xmin).toBe(xminIntervention);
      expect(r.rows[0]?.detail).toEqual(detailAvant);
    });

    it('produit_fertilisant est dans la publication powersync', async () => {
      const r = await c.query(`SELECT 1 FROM pg_publication_tables WHERE pubname = 'powersync' AND tablename = 'produit_fertilisant'`);
      expect(r.rowCount).toBe(1);
    });

    it('rejouable : les migrations une seconde fois ne changent rien', async () => {
      await inserer();
      const avant = (await c.query(`SELECT id, xmin::text FROM produit_fertilisant ORDER BY id`)).rows;
      const fermes = (await c.query(`SELECT id, zone_vulnerable_nitrates, xmin::text FROM ferme ORDER BY id`)).rows;
      await db.appliquerMigrations(urlDe(base));
      expect((await c.query(`SELECT id, xmin::text FROM produit_fertilisant ORDER BY id`)).rows).toEqual(avant);
      expect((await c.query(`SELECT id, zone_vulnerable_nitrates, xmin::text FROM ferme ORDER BY id`)).rows).toEqual(fermes);
      const ev = await c.query<{ xmin: string }>(`SELECT xmin::text FROM evenement WHERE id = $1`, [intervention]);
      expect(ev.rows[0]?.xmin).toBe(xminIntervention);
    });
  });

  describe('contraintes', () => {
    it('produit complet, teneurs facultatives : accepté ; source vide par défaut', async () => {
      const id = randomUUID();
      await inserer({ id, teneur_n: null });
      const r = await c.query<{ source: string }>(`SELECT source FROM produit_fertilisant WHERE id = $1`, [id]);
      expect(r.rows[0]?.source).toBe('');
    });

    it('sans ferme : refusé (pas de bibliothèque commune)', async () => {
      expect(await codeErreur(inserer({ ferme_id: null }))).toBe(VIOLATION_NOT_NULL);
    });

    it.each([
      ['nom vide', { nom: '   ' }],
      ['nom trop long', { nom: 'x'.repeat(201) }],
      ['forme inconnue', { forme: 'gazeuse' }],
      ['unité inconnue', { unite: 'brouette' }],
      ['teneur négative', { teneur_n: -0.1 }],
      ['teneur au-delà de 100 %', { teneur_p2o5: 100.5 }],
      ['source trop longue', { source: 'x'.repeat(301) }],
    ])('%s : refusé', async (_nom, autres) => {
      expect(await codeErreur(inserer(autres))).toBe(VIOLATION_CHECK);
    });
  });
});

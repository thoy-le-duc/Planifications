/**
 * Tests d'acceptation T56, PostgreSQL — recettes de fertirrigation (docs/backlog/T56-fertirrigation.md,
 * règles 1 et 2 ; critère « migration testée en intégration »).
 *
 * ── Schéma attendu ──────────────────────────────────────────────────────────────────────────
 *
 *   recette_fertirrigation   id, ferme_id (NOT NULL, vers ferme : pas de bibliothèque commune),
 *                            nom (text, 1 à 200 caractères après trim), taux_injection (nombre
 *                            facultatif, de plus de 0 à 100 %), engrais (jsonb NOT NULL, un
 *                            tableau), ec_cible (0 à 20, facultative), ph_cible (0 à 14,
 *                            facultatif), cree_le, modifie_le, supprime_le. Publiée (powersync).
 *   modification.nom_table   accepte 'RecetteFertirrigation'.
 *
 * Le détail d'une irrigation (recette, volume, EC, pH, doses) vit dans `evenement.detail` (jsonb) :
 * aucune colonne de plus. Migration GÉNÉRÉE par drizzle-kit après 0041 (seule retouche : l'ajout
 * à la publication), sur une base en service : les irrigations existantes ne sont pas réécrites ;
 * rejouable.
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
/** Dernière migration avant T56 (0041_fertilisation). */
const DERNIERE_AVANT_T56 = 41;
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
  const dossier = mkdtempSync(join(tmpdir(), 't56-migrations-'));
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
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T56)');
}

describe('T56 : schéma Drizzle', () => {
  const tables = () => (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));

  it('@planif/db déclare recette_fertirrigation et ses colonnes', () => {
    const t = tables().find((x) => x.name === 'recette_fertirrigation');
    expect(t, 'table recette_fertirrigation').toBeDefined();
    const noms = t?.columns.map((c) => c.name) ?? [];
    for (const c of ['id', 'ferme_id', 'nom', 'taux_injection', 'engrais', 'ec_cible', 'ph_cible', 'cree_le', 'modifie_le', 'supprime_le']) {
      expect(noms, c).toContain(c);
    }
    expect(t?.columns.find((c) => c.name === 'ferme_id')?.notNull).toBe(true);
    expect(t?.columns.find((c) => c.name === 'engrais')?.getSQLType()).toBe('jsonb');
  });

  it('une migration après 0041 crée la table et la publie', () => {
    const apres = lireJournal().entries.filter((e) => e.idx > DERNIERE_AVANT_T56);
    const textes = apres.map((e) => readFileSync(new URL(`${e.tag}.sql`, DOSSIER), 'utf8'));
    expect(textes.some((t) => t.includes('CREATE TABLE "recette_fertirrigation"'))).toBe(true);
    expect(textes.some((t) => /ALTER PUBLICATION powersync ADD TABLE[^;]*recette_fertirrigation/.test(t))).toBe(true);
  });
});

decrireAvecBase('T56 : recettes de fertirrigation (PostgreSQL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t56_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const utilisateur = randomUUID();
  const vanne = randomUUID();
  const irrigation = randomUUID();
  let dossierPartiel = '';
  let xminIrrigation = '';
  let detailAvant: unknown;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    dossierPartiel = migrationsJusquA(DERNIERE_AVANT_T56);
    const avant = new pg.Client({ connectionString: urlDe(base) });
    await avant.connect();
    try {
      await migrate(drizzle(avant), { migrationsFolder: dossierPartiel });
    } finally {
      await avant.end();
    }
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T56', 'Europe/Paris')`, [ferme]);
    await c.query(`INSERT INTO utilisateur (id, nom, email) VALUES ($1, 'Théo', $2)`, [utilisateur, `t56-${utilisateur}@exemple.test`]);
    await c.query(`INSERT INTO secteur_irrigation (id, ferme_id, numero_vanne, nom, debit_litres_heure) VALUES ($1, $2, 12, 'V12', 6000)`, [vanne, ferme]);
    await c.query(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, detail)
       VALUES ($1, $2, 'irrigation', '2026-06-10', '2026-06-10T07:00:00Z', $3, 'tap', ARRAY[]::uuid[], $4::jsonb)`,
      [irrigation, ferme, utilisateur, JSON.stringify({ secteurIrrigationId: vanne, dureeMinutes: 20 })],
    );
    const r = await c.query<{ xmin: string; detail: unknown }>(`SELECT xmin::text, detail FROM evenement WHERE id = $1`, [irrigation]);
    xminIrrigation = r.rows[0]?.xmin ?? '';
    detailAvant = r.rows[0]?.detail;
    await db.appliquerMigrations(urlDe(base));
  }, 180_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
    if (dossierPartiel !== '') rmSync(dossierPartiel, { recursive: true, force: true });
  }, 60_000);

  const ENGRAIS = JSON.stringify([{ produitFertilisantId: randomUUID(), quantite: { valeur: 10, unite: 'kg' } }]);
  const inserer = (autres: Record<string, unknown> = {}) => {
    const l: Record<string, unknown> = { id: randomUUID(), ferme_id: ferme, nom: 'Fraise floraison', taux_injection: 1, engrais: ENGRAIS, ec_cible: 1.8, ph_cible: 5.8, ...autres };
    const cols = Object.keys(l);
    return c.query(`INSERT INTO recette_fertirrigation (${cols.join(', ')}) VALUES (${cols.map((col, i) => (col === 'engrais' ? `$${String(i + 1)}::jsonb` : `$${String(i + 1)}`)).join(', ')})`, Object.values(l));
  };

  describe('migration des fermes en service', () => {
    it('irrigation existante : jamais réécrite, détail identique', async () => {
      const r = await c.query<{ xmin: string; detail: unknown }>(`SELECT xmin::text, detail FROM evenement WHERE id = $1`, [irrigation]);
      expect(r.rows[0]?.xmin).toBe(xminIrrigation);
      expect(r.rows[0]?.detail).toEqual(detailAvant);
    });

    it('recette_fertirrigation est dans la publication powersync', async () => {
      const r = await c.query(`SELECT 1 FROM pg_publication_tables WHERE pubname = 'powersync' AND tablename = 'recette_fertirrigation'`);
      expect(r.rowCount).toBe(1);
    });

    it('l’historique accepte RecetteFertirrigation', async () => {
      const id = randomUUID();
      await inserer({ id });
      await c.query(
        `INSERT INTO modification (id, ferme_id, nom_table, ligne_id, auteur_id, horodatage, operation, avant, apres)
         VALUES ($1, $2, 'RecetteFertirrigation', $3, $4, now(), 'creation', NULL, '{}'::jsonb)`,
        [randomUUID(), ferme, id, utilisateur],
      );
    });

    it('irrigation qui porte une recette (détail jsonb) : acceptée telle quelle', async () => {
      const detail = { secteurIrrigationId: vanne, dureeMinutes: 20, recetteFertirrigationId: randomUUID(), volumeM3: 2, engrais: [{ produitFertilisantId: randomUUID(), produit: 'Nitrate de calcium', quantite: { valeur: 0.2, unite: 'kg' } }] };
      await c.query(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, detail)
         VALUES ($1, $2, 'irrigation', '2026-06-11', '2026-06-11T07:00:00Z', $3, 'tap', ARRAY[]::uuid[], $4::jsonb)`,
        [randomUUID(), ferme, utilisateur, JSON.stringify(detail)],
      );
    });

    it('rejouable : les migrations une seconde fois ne changent rien', async () => {
      await inserer();
      const avant = (await c.query(`SELECT id, xmin::text FROM recette_fertirrigation ORDER BY id`)).rows;
      await db.appliquerMigrations(urlDe(base));
      expect((await c.query(`SELECT id, xmin::text FROM recette_fertirrigation ORDER BY id`)).rows).toEqual(avant);
      const ev = await c.query<{ xmin: string }>(`SELECT xmin::text FROM evenement WHERE id = $1`, [irrigation]);
      expect(ev.rows[0]?.xmin).toBe(xminIrrigation);
    });
  });

  describe('contraintes', () => {
    it('recette par m³ (sans taux), EC et pH facultatifs : acceptée', async () => {
      await inserer({ taux_injection: null, ec_cible: null, ph_cible: null });
    });

    it('sans ferme : refusée (pas de bibliothèque commune) ; sans engrais : refusée', async () => {
      expect(await codeErreur(inserer({ ferme_id: null }))).toBe(VIOLATION_NOT_NULL);
      expect(await codeErreur(inserer({ engrais: null }))).toBe(VIOLATION_NOT_NULL);
    });

    it.each([
      ['nom vide', { nom: '   ' }],
      ['nom trop long', { nom: 'x'.repeat(201) }],
      ['taux nul', { taux_injection: 0 }],
      ['taux au-delà de 100 %', { taux_injection: 100.5 }],
      ['engrais qui n’est pas un tableau', { engrais: '{"a":1}' }],
      ['EC négative', { ec_cible: -0.1 }],
      ['EC au-delà de 20', { ec_cible: 20.5 }],
      ['pH au-delà de 14', { ph_cible: 14.5 }],
    ])('%s : refusée', async (_nom, autres) => {
      expect(await codeErreur(inserer(autres))).toBe(VIOLATION_CHECK);
    });
  });
});

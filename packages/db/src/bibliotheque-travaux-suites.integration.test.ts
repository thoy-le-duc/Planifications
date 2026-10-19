/**
 * Tests d'acceptation T42b, PostgreSQL — la migration `0035_bibliotheque_travaux_suites` sur une
 * base déjà en service (docs/backlog/T42b-travaux-suites.md) :
 *
 *   - base migrée jusqu'à 0034 (travaux prévus de T42), une ferme a ses lignes et une copie d'un
 *     itinéraire de la bibliothèque (« Adapter pour ma ferme ») ;
 *   - toutes les migrations ensuite : la bibliothèque est exactement la conversion du JSON, mêmes
 *     identifiants ; seuls les 11 itinéraires corrigés sont réécrits (les autres lignes de la
 *     bibliothèque gardent leur version de ligne) ; aucune ligne de ferme touchée, copie comprise ;
 *   - rejouable : les migrations à nouveau, puis le SQL de 0035 deux fois, ne réécrivent rien.
 *
 * Exécution comme bibliotheque-suites.integration.test.ts : DATABASE_URL (Postgres avec
 * CREATEDB) ; sans elle, sautés en local.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validerItineraire } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const MIGRATION_SUITES = '0035_bibliotheque_travaux_suites';
const MIGRATION_TRAVAUX = '0034_bibliotheque_travaux';
const DOSSIER = new URL('../migrations/', import.meta.url);
const FERME_TEST = '0192f0c1-4242-7000-8000-000000000001';
const TOMATE = 'Tomate sous tunnel ou plein champ, plant maison franc';
const ID_TOMATE = db.idBibliotheque('itineraire', `tomate:${TOMATE}`);

interface Journal {
  entries: { idx: number; tag: string }[];
}

function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

/** Copie des migrations jusqu'à `idx` comprise, pour migrer en deux temps. */
function migrationsJusquA(idx: number): string {
  const dossier = mkdtempSync(join(tmpdir(), 't42b-migrations-'));
  mkdirSync(join(dossier, 'meta'));
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', DOSSIER), 'utf8')) as Journal;
  const gardees = journal.entries.filter((e) => e.idx <= idx);
  for (const e of gardees) copyFileSync(new URL(`${e.tag}.sql`, DOSSIER), join(dossier, `${e.tag}.sql`));
  writeFileSync(join(dossier, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: gardees }));
  return dossier;
}

const instructions = (sql: string): string[] =>
  sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/^\s*--.*$/gm, '').trim() !== '');

type Ligne = Record<string, unknown>;
type Instantane = Map<string, { xmin: string; ligne: Ligne }>;

decrireAvecBase('T42b : travaux corrigés, migration 0035 (PostgreSQL)', { timeout: 60_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t42b_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  let dossierPartiel = '';
  const ferme = randomUUID();
  const deLaFerme = { famille: randomUUID(), espece: randomUUID(), itineraire: randomUUID(), copie: randomUUID() };
  let fermeAvant: Instantane;
  let bibliothequeAvant: Instantane;

  async function lignes(ou: 'ferme_id IS NULL' | 'ferme_id = $1'): Promise<Instantane> {
    const r = await c.query<{ cle: string; xmin: string; ligne: Ligne }>(
      `SELECT 'famille:' || id AS cle, xmin::text, to_jsonb(t) AS ligne FROM famille t WHERE ${ou}
       UNION ALL SELECT 'espece:' || id, xmin::text, to_jsonb(t) FROM espece t WHERE ${ou}
       UNION ALL SELECT 'itineraire:' || id, xmin::text, to_jsonb(t) FROM itineraire t WHERE ${ou}`,
      ou === 'ferme_id = $1' ? [ferme] : [],
    );
    return new Map(r.rows.map((l) => [l.cle, { xmin: l.xmin, ligne: l.ligne }]));
  }
  const bibliotheque = (): Promise<Instantane> => lignes('ferme_id IS NULL');
  const fermeLignes = (): Promise<Instantane> => lignes('ferme_id = $1');

  async function jouer(sql: string): Promise<void> {
    for (const s of instructions(sql)) await c.query(s);
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    dossierPartiel = migrationsJusquA(34);
    const avant = new pg.Client({ connectionString: urlDe(base) });
    await avant.connect();
    try {
      await migrate(drizzle(avant), { migrationsFolder: dossierPartiel });
    } finally {
      await avant.end();
    }
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    const tomate = (await c.query<{ p: unknown }>('SELECT parametres AS p FROM itineraire WHERE id = $1', [ID_TOMATE])).rows[0]?.p;
    expect(tomate, 'la tomate de la bibliothèque après 0034').toBeDefined();
    expect(tomate, 'après 0034 : travaux prévus de T42').toHaveProperty('travauxPrevus');
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T42b', 'Europe/Paris')`, [ferme]);
    await c.query(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 3, 4)`, [deLaFerme.famille, ferme]);
    await c.query(`INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'tomate', 'legume', false, 'kg')`, [
      deLaFerme.espece,
      ferme,
      deLaFerme.famille,
    ]);
    // Un itinéraire de la ferme sous le même nom, et une copie « Adapter pour ma ferme » sur l'espèce de la bibliothèque.
    await c.query(
      `INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres) VALUES ($1, $2, $3, $4, 'plant_maison', $5), ($6, $2, $7, $4, 'plant_maison', $5)`,
      [deLaFerme.itineraire, ferme, deLaFerme.espece, TOMATE, JSON.stringify(tomate), deLaFerme.copie, db.idBibliotheque('espece', 'tomate')],
    );
    fermeAvant = await fermeLignes();
    bibliothequeAvant = await bibliotheque();
    await db.appliquerMigrations(urlDe(base));
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
    rmSync(dossierPartiel, { recursive: true, force: true });
  }, 60_000);

  it('la bibliothèque : exactement la conversion du JSON, mêmes identifiants', async () => {
    const attendu = db.convertirBibliotheque(db.lireBibliothequeDepart());
    const apres = await bibliotheque();
    expect(attendu.itineraires).toHaveLength(46);
    for (const i of attendu.itineraires) {
      expect(bibliothequeAvant.has(`itineraire:${i.id}`), `${i.nom} : même identifiant qu’avant`).toBe(true);
      expect(apres.get(`itineraire:${i.id}`)?.ligne, i.nom).toMatchObject({ nom: i.nom, mode: i.mode, parametres: i.parametres, supprime_le: null, ferme_id: null });
    }
  });

  it('seuls les itinéraires changés par 0035 sont réécrits, les autres gardent leur version de ligne', async () => {
    const etats = db.lireEtatsBibliotheque();
    const e34 = etats.find((e) => e.migration === MIGRATION_TRAVAUX)?.lignes;
    const e35 = etats.find((e) => e.migration === MIGRATION_SUITES)?.lignes;
    if (e34 === undefined || e35 === undefined) throw new Error('états 0034 ou 0035 absents');
    const changes = new Set(db.changementsBibliotheque(e34, e35).map((ch) => `${ch.table}:${ch.id}`));
    expect(changes.size).toBe(11);
    const apres = await bibliotheque();
    for (const [cle, l] of bibliothequeAvant) {
      if (changes.has(cle)) expect(apres.get(cle)?.xmin, `${cle} réécrite`).not.toBe(l.xmin);
      else expect(apres.get(cle), `${cle} intacte`).toEqual(l);
    }
  });

  it('chaque itinéraire lu en base passe validerItineraire, sans perte', async () => {
    for (const [cle, { ligne }] of await bibliotheque()) {
      if (!cle.startsWith('itineraire:')) continue;
      const r = validerItineraire({ ...ligne, ferme_id: FERME_TEST });
      expect(r.ok ? null : r.erreur, String(ligne.nom)).toBeNull();
      if (r.ok) expect(r.valeur.parametres).toEqual(ligne.parametres);
    }
  });

  it('ni famille ni espèce de la bibliothèque réécrite', async () => {
    const apres = await bibliotheque();
    for (const [cle, l] of bibliothequeAvant) if (!cle.startsWith('itineraire:')) expect(apres.get(cle), cle).toEqual(l);
    expect([...apres.keys()].sort()).toEqual([...bibliothequeAvant.keys()].sort());
  });

  it('aucune ligne de ferme touchée, ni l’itinéraire du même nom, ni la copie faite par la ferme', async () => {
    expect(await fermeLignes()).toEqual(fermeAvant);
  });

  it('rejouable : les migrations à nouveau, puis le SQL de 0035 deux fois, ne réécrivent rien', async () => {
    const bib = await bibliotheque();
    await db.appliquerMigrations(urlDe(base));
    const sql = readFileSync(new URL(`${MIGRATION_SUITES}.sql`, DOSSIER), 'utf8');
    await jouer(sql);
    await jouer(sql);
    expect(await bibliotheque()).toEqual(bib);
    expect(await fermeLignes()).toEqual(fermeAvant);
  });
});

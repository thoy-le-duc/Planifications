/**
 * Tests d'acceptation T42, PostgreSQL — la migration `0034_bibliotheque_travaux` sur une base déjà
 * en service (docs/backlog/T42-bibliotheque-travaux.md) :
 *
 *   - base migrée jusqu'à 0033 (la bibliothèque de T41 et T41b), une ferme a ses lignes et une
 *     copie d'un itinéraire de la bibliothèque (« Adapter pour ma ferme ») ;
 *   - toutes les migrations ensuite : les 46 itinéraires de la bibliothèque portent leurs travaux
 *     prévus et les nouveaux écartements (exactement la conversion du JSON), mêmes identifiants ;
 *     ni famille ni espèce réécrite ; aucune ligne de ferme touchée, copie comprise ;
 *   - rejouable : les migrations à nouveau, puis le SQL de 0034 deux fois, ne réécrivent rien.
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
  const dossier = mkdtempSync(join(tmpdir(), 't42-migrations-'));
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

decrireAvecBase('T42 : travaux prévus et écartements, migration 0034 (PostgreSQL)', { timeout: 60_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t42_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
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
    dossierPartiel = migrationsJusquA(33);
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
    expect(tomate, 'la tomate de la bibliothèque après 0033').toBeDefined();
    expect(tomate, 'avant 0034 : aucun travail prévu').not.toHaveProperty('travauxPrevus');
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T42', 'Europe/Paris')`, [ferme]);
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

  it('les 46 itinéraires de la bibliothèque : exactement la conversion du JSON (travaux, écartements), mêmes identifiants', async () => {
    const attendu = db.convertirBibliotheque(db.lireBibliothequeDepart());
    const apres = await bibliotheque();
    expect(attendu.itineraires).toHaveLength(46);
    for (const i of attendu.itineraires) {
      expect(bibliothequeAvant.has(`itineraire:${i.id}`), `${i.nom} : même identifiant qu’avant`).toBe(true);
      const l = apres.get(`itineraire:${i.id}`)?.ligne;
      expect(l, i.nom).toMatchObject({ nom: i.nom, mode: i.mode, parametres: i.parametres, supprime_le: null, ferme_id: null });
      expect((l?.parametres as { travauxPrevus?: unknown[] } | undefined)?.travauxPrevus?.length ?? 0, `travaux de ${i.nom}`).toBeGreaterThanOrEqual(3);
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

  it('rejouable : les migrations à nouveau, puis le SQL de 0034 deux fois, ne réécrivent rien', async () => {
    const bib = await bibliotheque();
    await db.appliquerMigrations(urlDe(base));
    const sql = readFileSync(new URL(`${MIGRATION_TRAVAUX}.sql`, DOSSIER), 'utf8');
    await jouer(sql);
    await jouer(sql);
    expect(await bibliotheque()).toEqual(bib);
    expect(await fermeLignes()).toEqual(fermeAvant);
  });
});

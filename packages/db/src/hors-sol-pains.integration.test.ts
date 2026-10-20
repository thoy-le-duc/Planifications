/**
 * Tests d'acceptation T51, PostgreSQL — gouttières en pains (docs/backlog/T51-hors-sol-pains.md,
 * règles 1 et 4).
 *
 * ── Schéma attendu ──────────────────────────────────────────────────────────────────────────
 *
 *   emplacement.nombre_pains   integer, nullable, sans défaut : le nombre de contenants (pains,
 *                              sacs, pots) d'une gouttière.
 *   CHECK : gouttière ⇔ nombre_pains renseigné, > 0 ; nombre_places (l'ancien « nombre de
 *           places ») devient facultatif, nul hors d'une gouttière, > 0 sinon : il reste en base,
 *           en lecture seule, sans servir au calcul.
 *
 * Migration GÉNÉRÉE par drizzle-kit après 0036 (seule retouche : les mises à jour de données
 * avant les CHECK), sur une base en service :
 *   - gouttière existante : nombre_pains = longueur arrondie (au moins 1), nombre_places gardé ;
 *   - planche et rang : nombre_pains nul, rien d'autre ne change (ligne jamais réécrite) ;
 *   - occupation d'une gouttière : sa place se compte désormais en pains, ramenée à la même part
 *     de la gouttière : max(1, min(pains, arrondi(places × pains ÷ anciennes places)))
 *     (60 places sur 120, gouttière de 30 m → 15 pains) ; une occupation de planche n'est pas
 *     réécrite ;
 *   - rejouable : appliquer les migrations une seconde fois ne change rien.
 *
 * Bibliothèque (T41b) : une migration de bibliothèque après celle du schéma ajoute la famille
 * « Rosacées », l'espèce « fraise » et l'itinéraire « Fraise hors-sol en gouttière » (plant
 * acheté, abri hors-sol, densité en contenants, 12 trous par pain), mêmes identifiants (md5 du
 * nom) partout ; aucune ligne de ferme touchée.
 *
 * Exécution comme les autres tests d'intégration : DATABASE_URL (Postgres avec CREATEDB) ; sans
 * elle, sautés en local.
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validerItineraire } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const VIOLATION_CHECK = '23514';
/** Dernière migration avant T51 (0036_bibliotheque_ecart_entre_rangs). */
const DERNIERE_AVANT_T51 = 36;
const DOSSIER = new URL('../migrations/', import.meta.url);
const NOM_FRAISE = 'Fraise hors-sol en gouttière';
const ID_FRAISE = db.idBibliotheque('itineraire', `fraise:${NOM_FRAISE}`);

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
  const dossier = mkdtempSync(join(tmpdir(), 't51-migrations-'));
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
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T51)');
}

describe('T51 : schéma Drizzle', () => {
  it('@planif/db déclare emplacement.nombre_pains, entier nullable sans défaut', () => {
    const tables = (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));
    const colonne = tables.find((t) => t.name === 'emplacement')?.columns.find((c) => c.name === 'nombre_pains');
    expect(colonne, 'colonne emplacement.nombre_pains').toBeDefined();
    expect(colonne?.getSQLType()).toBe('integer');
    expect(colonne?.notNull).toBe(false);
    expect(colonne?.hasDefault).toBe(false);
  });

  it('une migration après 0036 ajoute la colonne, une autre (de bibliothèque) la fraise hors-sol', () => {
    const apres = lireJournal().entries.filter((e) => e.idx > DERNIERE_AVANT_T51);
    const textes = apres.map((e) => readFileSync(new URL(`${e.tag}.sql`, DOSSIER), 'utf8'));
    expect(textes.some((t) => t.includes('ADD COLUMN "nombre_pains" integer'))).toBe(true);
    expect(textes.some((t) => t.includes(ID_FRAISE))).toBe(true);
  });

  it('la bibliothèque du dépôt porte l’itinéraire « Fraise hors-sol en gouttière », 12 trous par pain, validé par le cœur', () => {
    const lignes = db.convertirBibliotheque(db.lireBibliothequeDepart());
    const it = lignes.itineraires.find((i) => i.id === ID_FRAISE);
    expect(it, NOM_FRAISE).toBeDefined();
    expect(it?.mode).toBe('plant_achete');
    expect(it?.parametres.typeAbri).toBe('hors_sol');
    expect(it?.parametres.densite).toEqual({ facon: 'contenants', trousParContenant: 12 });
    const espece = lignes.especes.find((e) => e.id === it?.espece_id);
    expect(espece?.nom).toBe('fraise');
    expect(lignes.familles.find((f) => f.id === espece?.famille_id)?.nom).toBe('Rosacées');
    const v = validerItineraire({ ...it, ferme_id: '0192f0c1-4343-7000-8000-000000000051', parametres: JSON.stringify(it?.parametres) });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    const source = db.lireBibliothequeDepart().itineraires.find((i) => i.nom === NOM_FRAISE);
    expect(source?.sources.length ?? 0).toBeGreaterThan(0);
    for (const s of source?.sources ?? []) expect(`${s.titre} ${s.url}`).not.toMatch(/masterclass|jardinier-maraicher|jardinier maraicher/i);
  });
});

decrireAvecBase('T51 : gouttières en pains (PostgreSQL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t51_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const zone = randomUUID();
  const ids = { g30: randomUUID(), g12: randomUUID(), gCourte: randomUUID(), planche: randomUUID() };
  const occ = { g30: randomUUID(), g12plein: randomUUID(), planche: randomUUID() };
  let dossierPartiel = '';
  let xminPlanche = '';
  let xminOccPlanche = '';

  const emplacementLu = async (id: string) =>
    (
      await c.query<{ nombre_pains: number | null; nombre_places: number | null; xmin: string }>(
        `SELECT nombre_pains, nombre_places, xmin::text FROM emplacement WHERE id = $1`,
        [id],
      )
    ).rows[0];
  const placesDe = async (id: string) => (await c.query<{ n: number | null; xmin: string }>(`SELECT nombre_places AS n, xmin::text FROM occupation WHERE id = $1`, [id])).rows[0];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    dossierPartiel = migrationsJusquA(DERNIERE_AVANT_T51);
    const avant = new pg.Client({ connectionString: urlDe(base) });
    await avant.connect();
    try {
      await migrate(drizzle(avant), { migrationsFolder: dossierPartiel });
    } finally {
      await avant.end();
    }
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T51', 'Europe/Paris')`, [ferme]);
    await c.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Serre fraises', 'hors_sol')`, [zone, ferme]);
    await c.query(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, nombre_places, actif_du) VALUES
         ($1, $5, $6, 'G1', 'gouttiere', 30, 120, '2025-01-01'),
         ($2, $5, $6, 'G2', 'gouttiere', 12.4, 144, '2025-01-01'),
         ($3, $5, $6, 'G3', 'gouttiere', 0.4, 4, '2025-01-01'),
         ($4, $5, $6, 'P1', 'planche', 20, NULL, '2025-01-01')`,
      [ids.g30, ids.g12, ids.gCourte, ids.planche, ferme, zone],
    );
    // Une plantation occupe la moitié de G1, une autre tout G2 ; une troisième, une planche.
    const plantation = randomUUID();
    const famille = randomUUID();
    const espece = randomUUID();
    await c.query(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Rosacées', 3, 4)`, [famille, ferme]);
    await c.query(`INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'Fraise', 'petit_fruit', true, 'kg')`, [
      espece,
      ferme,
      famille,
    ]);
    await c.query(`INSERT INTO plantation (id, ferme_id, espece_id, date_plantation, nombre_plants) VALUES ($1, $2, $3, '2025-08-20', 300)`, [plantation, ferme, espece]);
    await c.query(
      `INSERT INTO occupation (id, ferme_id, emplacement_id, plantation_id, longueur_m, nombre_places, prevu_du, prevu_au) VALUES
         ($1, $4, $5, $8, NULL, 60, '2025-08-20', '9999-12-31'),
         ($2, $4, $6, $8, NULL, 144, '2025-08-20', '9999-12-31'),
         ($3, $4, $7, $8, 20, NULL, '2025-08-20', '9999-12-31')`,
      [occ.g30, occ.g12plein, occ.planche, ferme, ids.g30, ids.g12, ids.planche, plantation],
    );
    xminPlanche = (await c.query<{ xmin: string }>(`SELECT xmin::text FROM emplacement WHERE id = $1`, [ids.planche])).rows[0]?.xmin ?? '';
    xminOccPlanche = (await placesDe(occ.planche))?.xmin ?? '';
    await db.appliquerMigrations(urlDe(base));
  }, 180_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
    if (dossierPartiel !== '') rmSync(dossierPartiel, { recursive: true, force: true });
  }, 60_000);

  describe('migration des fermes en service', () => {
    it('gouttière existante : nombre de pains = longueur arrondie, l’ancien nombre de places gardé', async () => {
      expect(await emplacementLu(ids.g30)).toMatchObject({ nombre_pains: 30, nombre_places: 120 });
      expect(await emplacementLu(ids.g12)).toMatchObject({ nombre_pains: 12, nombre_places: 144 });
    });

    it('gouttière de moins d’un mètre : 1 pain', async () => {
      expect(await emplacementLu(ids.gCourte)).toMatchObject({ nombre_pains: 1, nombre_places: 4 });
    });

    it('planche : aucun pain, ligne jamais réécrite', async () => {
      const p = await emplacementLu(ids.planche);
      expect(p).toMatchObject({ nombre_pains: null, nombre_places: null });
      expect(p?.xmin).toBe(xminPlanche);
    });

    it('occupation d’une gouttière : la même part, comptée en pains (60 places sur 120 → 15 pains sur 30 ; pleine → pleine)', async () => {
      expect((await placesDe(occ.g30))?.n).toBe(15);
      expect((await placesDe(occ.g12plein))?.n).toBe(12);
    });

    it('occupation d’une planche : jamais réécrite', async () => {
      const o = await placesDe(occ.planche);
      expect(o?.n).toBeNull();
      expect(o?.xmin).toBe(xminOccPlanche);
    });

    it('rejouable : les migrations une seconde fois ne changent rien', async () => {
      const avant = (await c.query(`SELECT id, nombre_pains, nombre_places, xmin::text FROM emplacement ORDER BY id`)).rows;
      const occAvant = (await c.query(`SELECT id, nombre_places, xmin::text FROM occupation ORDER BY id`)).rows;
      await db.appliquerMigrations(urlDe(base));
      expect((await c.query(`SELECT id, nombre_pains, nombre_places, xmin::text FROM emplacement ORDER BY id`)).rows).toEqual(avant);
      expect((await c.query(`SELECT id, nombre_places, xmin::text FROM occupation ORDER BY id`)).rows).toEqual(occAvant);
    });
  });

  describe('contraintes', () => {
    const inserer = (sorte: string, pains: number | null, places: number | null) =>
      c.query(`INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, nombre_pains, nombre_places, actif_du) VALUES ($1, $2, $3, $4, $5, 30, $6, $7, '2026-01-01')`, [
        randomUUID(),
        ferme,
        zone,
        `X${randomUUID().slice(0, 6)}`,
        sorte,
        pains,
        places,
      ]);

    it('gouttière avec ses pains, sans ancien nombre de places : acceptée', async () => {
      await inserer('gouttiere', 30, null);
    });

    it('gouttière sans pains : refusée', async () => {
      expect(await codeErreur(inserer('gouttiere', null, 120))).toBe(VIOLATION_CHECK);
    });

    it.each([0, -3])('gouttière à %i pain : refusée', async (n) => {
      expect(await codeErreur(inserer('gouttiere', n, null))).toBe(VIOLATION_CHECK);
    });

    it('planche avec des pains ou des places : refusée', async () => {
      expect(await codeErreur(inserer('planche', 30, null))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(inserer('planche', null, 30))).toBe(VIOLATION_CHECK);
    });
  });

  describe('bibliothèque', () => {
    it('l’itinéraire « Fraise hors-sol en gouttière » est en base, à ferme_id nul, tel que la conversion du JSON', async () => {
      const attendu = db.convertirBibliotheque(db.lireBibliothequeDepart()).itineraires.find((i) => i.id === ID_FRAISE);
      const r = await c.query<{ nom: string; ferme_id: string | null; parametres: unknown }>(`SELECT nom, ferme_id, parametres FROM itineraire WHERE id = $1`, [ID_FRAISE]);
      expect(r.rows).toEqual([{ nom: NOM_FRAISE, ferme_id: null, parametres: attendu?.parametres }]);
    });

    it('aucune ligne de la ferme n’a reçu la bibliothèque', async () => {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM itineraire WHERE ferme_id = $1`, [ferme]);
      expect(r.rows[0]?.n).toBe(0);
    });
  });
});

/**
 * Tests d'acceptation T61 — chemins, points du plan, lieux de rangement et outils en base
 * (docs/backlog/T61-chemins-outils.md, règles 1 à 3 ; critère « migration testée en intégration »).
 *
 * ── Schéma attendu (noms en français, cohérents avec docs/modele-donnees.md) ────────────────
 *
 * Toutes les tables : id uuid PK ; ferme_id uuid NOT NULL → ferme ; cree_le, modifie_le
 * timestamptz NOT NULL ; supprime_le timestamptz nullable (suppression douce). Migration GÉNÉRÉE
 * par drizzle-kit (+ ajout à la publication « powersync », comme 0039). Violations en 23514
 * (CHECK), 23503 (clé étrangère), 23505 (unicité), 23502 (non nul).
 *
 *   batiment.type   CHECK étendu : serre_tunnel, serre_chapelle, hangar, local, chambre_froide,
 *                   magasin, autre (une ligne existante ne change pas).
 *   chemin          nom text nullable (1 à 80 caractères s'il est donné) ; points jsonb NOT NULL :
 *                   tableau de 2 à 200 objets {x, y} numériques à 5 000 m au plus de l'origine,
 *                   texte jsonb de 16 384 caractères au plus ; largeur_m numeric NOT NULL, > 0 et ≤ 20.
 *   point_plan      nom text NOT NULL (1 à 80 caractères, non blanc) ; sorte text NOT NULL, CHECK
 *                   point_eau | repere ; x_m, y_m numeric NOT NULL, x² + y² ≤ 25 000 000.
 *   lieu_rangement  batiment_id uuid nullable, point_plan_id uuid nullable : EXACTEMENT un des deux
 *                   (CHECK) ; l'élément doit être de la MÊME ferme (clé étrangère composée) ; un seul
 *                   lieu non supprimé par bâtiment et par point (index uniques partiels). Le nom du
 *                   lieu est celui de son bâtiment ou de son point (pas de colonne nom).
 *   place_rangement lieu_rangement_id uuid NOT NULL (même ferme) ; nom text NOT NULL (1 à 60
 *                   caractères, non blanc) ; unique dans son lieu parmi les non supprimées, sans
 *                   tenir compte des majuscules ni des espaces autour.
 *   outil           nom text NOT NULL (1 à 80 caractères, non blanc), unique dans la ferme parmi les
 *                   non supprimés, sans tenir compte des majuscules ni des espaces autour ;
 *                   lieu_rangement_id uuid NOT NULL (même ferme) ; place_rangement_id uuid nullable :
 *                   une place DU MÊME lieu (clé étrangère composée (place, lieu)).
 *
 * Publication « powersync » : les cinq tables. Rien n'est réécrit dans les tables existantes.
 *
 * Exécution comme placement.integration.test.ts : DATABASE_URL (Postgres avec CREATEDB) ; sans
 * elle, sautés en local (l'échec clair en CI est porté par schema.integration.test.ts).
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
const VIOLATION_CLE_ETRANGERE = '23503';
const VIOLATION_NON_NUL = '23502';
const VIOLATION_UNICITE = '23505';

const TABLES_T61 = ['chemin', 'point_plan', 'lieu_rangement', 'place_rangement', 'outil'] as const;
const HORODATAGES = ['cree_le', 'ferme_id', 'id', 'modifie_le', 'supprime_le'];
const COLONNES = {
  chemin: [...HORODATAGES, 'largeur_m', 'nom', 'points'].sort(),
  point_plan: [...HORODATAGES, 'nom', 'sorte', 'x_m', 'y_m'].sort(),
  lieu_rangement: [...HORODATAGES, 'batiment_id', 'point_plan_id'].sort(),
  place_rangement: [...HORODATAGES, 'lieu_rangement_id', 'nom'].sort(),
  outil: [...HORODATAGES, 'lieu_rangement_id', 'nom', 'place_rangement_id'].sort(),
} as const;

function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

/** Code SQLSTATE de l'erreur levée par la requête ; échoue si la requête passe. */
async function codeErreur(requete: Promise<unknown>): Promise<string> {
  try {
    await requete;
  } catch (e) {
    return (e as { code?: string }).code ?? 'sans code';
  }
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T61)');
}

const tablesDrizzle = () =>
  (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));

describe('T61 : schéma Drizzle et migration générée', () => {
  it('@planif/db déclare les cinq tables, avec leurs colonnes', () => {
    const tables = tablesDrizzle();
    for (const t of TABLES_T61) {
      expect(tables.find((x) => x.name === t)?.columns.map((c) => c.name).sort(), t).toEqual(COLONNES[t]);
    }
  });

  it('@planif/db accepte local et chambre_froide comme types de bâtiment', () => {
    expect([...db.TYPES_BATIMENT]).toEqual(expect.arrayContaining(['hangar', 'local', 'chambre_froide', 'magasin']));
  });

  it('le dernier instantané de drizzle-kit les connaît : migration générée, pas écrite à la main', () => {
    const meta = new URL('../migrations/meta/', import.meta.url);
    const journal = JSON.parse(readFileSync(new URL('_journal.json', meta), 'utf8')) as { entries: { idx: number }[] };
    const dernier = journal.entries.at(-1)?.idx ?? -1;
    const nom = `${String(dernier).padStart(4, '0')}_snapshot.json`;
    const instantane = JSON.parse(readFileSync(new URL(nom, meta), 'utf8')) as { tables: Record<string, { columns: Record<string, unknown> } | undefined> };
    for (const t of TABLES_T61) {
      expect(Object.keys(instantane.tables[`public.${t}`]?.columns ?? {}).sort(), `public.${t} dans ${nom}`).toEqual(COLONNES[t]);
    }
  });

  it('les migrations du ticket ne réécrivent aucune ligne existante et publient les cinq tables', () => {
    const dossier = new URL('../migrations/', import.meta.url);
    const nouvelles = readdirSync(dossier)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 44)
      .map((f) => ({ f, sql: readFileSync(new URL(f, dossier), 'utf8') }));
    expect(nouvelles.length, 'au moins une migration T61 (0044 ou après)').toBeGreaterThan(0);
    const tout = nouvelles.map((n) => n.sql).join('\n');
    for (const t of TABLES_T61) {
      expect(tout, t).toMatch(new RegExp(`CREATE TABLE "${t}"`));
      expect(tout, `${t} dans la publication`).toMatch(new RegExp(`ALTER PUBLICATION powersync ADD TABLE[^;]*\\b${t}\\b`));
    }
    for (const { f, sql } of nouvelles) {
      expect(sql, f).not.toMatch(/\bUPDATE\s+"?(ferme|zone|emplacement|batiment|evenement|serie)"?\s+SET\b/i);
      expect(sql, f).not.toMatch(/\bDELETE\s+FROM\b/i);
    }
  });
});

decrireAvecBase('T61 : chemins, rangement et outils en base (PostgreSQL)', { timeout: 30_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t61_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const autreFerme = randomUUID();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    await db.appliquerMigrations(urlDe(base));
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T61', 'Europe/Paris'), ($2, 'Ferme voisine', 'Europe/Paris')`, [ferme, autreFerme]);
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  const SENTIER = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 25.5 },
  ];

  async function chemin(o: { ferme_id?: string; nom?: unknown; points?: unknown; largeur_m?: unknown } = {}): Promise<string> {
    const id = randomUUID();
    const points = o.points === undefined ? SENTIER : o.points;
    await c.query(`INSERT INTO chemin (id, ferme_id, nom, points, largeur_m) VALUES ($1, $2, $3, $4::jsonb, $5)`, [
      id,
      o.ferme_id ?? ferme,
      o.nom === undefined ? 'Allée centrale' : o.nom,
      points === null ? null : JSON.stringify(points),
      o.largeur_m === undefined ? 2.5 : o.largeur_m,
    ]);
    return id;
  }

  async function point(o: { ferme_id?: string; nom?: unknown; sorte?: unknown; x_m?: unknown; y_m?: unknown } = {}): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO point_plan (id, ferme_id, nom, sorte, x_m, y_m) VALUES ($1, $2, $3, $4, $5, $6)`, [
      id,
      o.ferme_id ?? ferme,
      o.nom === undefined ? `Point ${id.slice(0, 6)}` : o.nom,
      o.sorte ?? 'point_eau',
      'x_m' in o ? o.x_m : 12.5,
      'y_m' in o ? o.y_m : -40,
    ]);
    return id;
  }

  async function batiment(o: { ferme_id?: string; type?: string; nom?: string } = {}): Promise<string> {
    const id = randomUUID();
    await c.query(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg)
       VALUES ($1, $2, $3, $4, 20, 12, 6, -10, 15, 0)`,
      [id, o.ferme_id ?? ferme, o.nom ?? `Hangar ${id.slice(0, 6)}`, o.type ?? 'hangar'],
    );
    return id;
  }

  async function lieu(o: { ferme_id?: string; batiment_id?: string | null; point_plan_id?: string | null } = {}): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO lieu_rangement (id, ferme_id, batiment_id, point_plan_id) VALUES ($1, $2, $3, $4)`, [id, o.ferme_id ?? ferme, o.batiment_id ?? null, o.point_plan_id ?? null]);
    return id;
  }

  async function lieuDeBatiment(f: string = ferme): Promise<string> {
    return lieu({ ferme_id: f, batiment_id: await batiment({ ferme_id: f }) });
  }

  async function place(o: { ferme_id?: string; lieu_rangement_id: string; nom?: unknown }): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO place_rangement (id, ferme_id, lieu_rangement_id, nom) VALUES ($1, $2, $3, $4)`, [id, o.ferme_id ?? ferme, o.lieu_rangement_id, o.nom === undefined ? `place ${id.slice(0, 6)}` : o.nom]);
    return id;
  }

  async function outil(o: { ferme_id?: string; nom?: unknown; lieu_rangement_id: string | null; place_rangement_id?: string | null }): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO outil (id, ferme_id, nom, lieu_rangement_id, place_rangement_id) VALUES ($1, $2, $3, $4, $5)`, [
      id,
      o.ferme_id ?? ferme,
      o.nom === undefined ? `Outil ${id.slice(0, 6)}` : o.nom,
      o.lieu_rangement_id,
      o.place_rangement_id ?? null,
    ]);
    return id;
  }

  describe('colonnes', () => {
    it('les cinq tables : colonnes, types et nullabilité', async () => {
      const r = await c.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
        `SELECT table_name::text, column_name::text, data_type::text, is_nullable::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name, column_name`,
        [[...TABLES_T61]],
      );
      const lu = Object.fromEntries(r.rows.map((l) => [`${l.table_name}.${l.column_name}`, `${l.data_type}${l.is_nullable === 'YES' ? '?' : ''}`]));
      expect(lu).toMatchObject({
        'chemin.points': 'jsonb',
        'chemin.largeur_m': 'numeric',
        'chemin.nom': 'text?',
        'chemin.supprime_le': 'timestamp with time zone?',
        'point_plan.nom': 'text',
        'point_plan.sorte': 'text',
        'point_plan.x_m': 'numeric',
        'point_plan.y_m': 'numeric',
        'lieu_rangement.batiment_id': 'uuid?',
        'lieu_rangement.point_plan_id': 'uuid?',
        'place_rangement.lieu_rangement_id': 'uuid',
        'place_rangement.nom': 'text',
        'outil.nom': 'text',
        'outil.lieu_rangement_id': 'uuid',
        'outil.place_rangement_id': 'uuid?',
      });
      for (const t of TABLES_T61) {
        const noms = r.rows.filter((l) => l.table_name === t).map((l) => l.column_name).sort();
        expect(noms, t).toEqual(COLONNES[t]);
      }
    });

    it('les cinq tables sont dans la publication « powersync » (elles descendent sur les téléphones)', async () => {
      const r = await c.query<{ tablename: string }>(`SELECT tablename::text FROM pg_publication_tables WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename`, [[...TABLES_T61]]);
      expect(r.rows.map((l) => l.tablename)).toEqual([...TABLES_T61].sort());
    });

    it('chaque table a un index sur ferme_id (filtre par ferme des règles de synchro)', async () => {
      for (const t of TABLES_T61) {
        const r = await c.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`, [t]);
        expect(r.rows.some((l) => /\(ferme_id\b/.test(l.indexdef)), `${t} : ${r.rows.map((l) => l.indexdef).join(' | ')}`).toBe(true);
      }
    });
  });

  describe('batiment : hangar, local, chambre froide, magasin', () => {
    it.each(['hangar', 'local', 'chambre_froide', 'magasin'])('type %s : accepté', async (type) => {
      await batiment({ type });
    });

    it('type inconnu : toujours refusé', async () => {
      expect(await codeErreur(batiment({ type: 'garage' }))).toBe(VIOLATION_CHECK);
    });
  });

  describe('chemin', () => {
    it('chemin de trois points, 2,5 m de large : accepté, relu tel quel', async () => {
      const id = await chemin({ largeur_m: 2.5 });
      const r = await c.query<{ points: unknown; largeur_m: string; supprime_le: unknown }>(`SELECT points, largeur_m, supprime_le FROM chemin WHERE id = $1`, [id]);
      expect(r.rows[0]?.points).toEqual(SENTIER);
      expect(Number(r.rows[0]?.largeur_m)).toBe(2.5);
      expect(r.rows[0]?.supprime_le).toBeNull();
    });

    it('sans nom : accepté (le nom est facultatif) ; nom vide ou de plus de 80 caractères : refusé', async () => {
      await chemin({ nom: null });
      expect(await codeErreur(chemin({ nom: '' }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(chemin({ nom: 'x'.repeat(81) }))).toBe(VIOLATION_CHECK);
      await chemin({ nom: 'x'.repeat(80) });
    });

    it('largeur : 20 m pile acceptée ; 0, négative, 20,5 refusées ; absente refusée', async () => {
      await chemin({ largeur_m: 20 });
      for (const l of [0, -1, 20.5]) expect(await codeErreur(chemin({ largeur_m: l })), String(l)).toBe(VIOLATION_CHECK);
      expect(await codeErreur(chemin({ largeur_m: null }))).toBe(VIOLATION_NON_NUL);
    });

    it('points : 2 et 200 acceptés ; 1, 0, 201 refusés ; absents refusés', async () => {
      const ligne = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
      await chemin({ points: ligne(2) });
      await chemin({ points: ligne(200) });
      for (const n of [0, 1, 201]) expect(await codeErreur(chemin({ points: ligne(n) })), String(n)).toBe(VIOLATION_CHECK);
      expect(await codeErreur(chemin({ points: null }))).toBe(VIOLATION_NON_NUL);
    });

    it('points mal formés (pas un tableau, point sans y, texte au lieu d’un nombre, objet) : refusés', async () => {
      for (const p of [{ x: 0, y: 0 }, 'a', [{ x: 0, y: 0 }, { x: 1 }], [{ x: 0, y: 0 }, { x: '1', y: 2 }], [{ x: 0, y: 0 }, 3], [[0, 0], [1, 1]]]) {
        expect(await codeErreur(chemin({ points: p })), JSON.stringify(p)).toBe(VIOLATION_CHECK);
      }
    });

    it('à 5 km pile : accepté ; plus loin : refusé', async () => {
      await chemin({ points: [{ x: 0, y: 0 }, { x: 3000, y: 4000 }] });
      expect(await codeErreur(chemin({ points: [{ x: 0, y: 0 }, { x: 3000, y: 4001 }] }))).toBe(VIOLATION_CHECK);
    });

    it('texte JSON de plus de 16 384 caractères : refusé (taille bornée)', async () => {
      const long = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0, note: 'x'.repeat(100) }));
      expect(await codeErreur(chemin({ points: long }))).toBe(VIOLATION_CHECK);
    });

    it('ferme inexistante : refusée (clé étrangère)', async () => {
      expect(await codeErreur(chemin({ ferme_id: randomUUID() }))).toBe(VIOLATION_CLE_ETRANGERE);
    });
  });

  describe('point_plan', () => {
    it.each(['point_eau', 'repere'])('sorte %s : acceptée', async (sorte) => {
      await point({ sorte });
    });

    it('sorte inconnue, nom vide ou blanc, nom de plus de 80 caractères : refusés', async () => {
      expect(await codeErreur(point({ sorte: 'puits' }))).toBe(VIOLATION_CHECK);
      for (const nom of ['', '   ', 'x'.repeat(81)]) expect(await codeErreur(point({ nom })), nom).toBe(VIOLATION_CHECK);
      expect(await codeErreur(point({ nom: null }))).toBe(VIOLATION_NON_NUL);
    });

    it('à 5 km pile (3 000, 4 000) : accepté ; (3 000, 4 001) : refusé ; coordonnée absente : refusée', async () => {
      await point({ x_m: 3000, y_m: -4000 });
      expect(await codeErreur(point({ x_m: 3000, y_m: 4001 }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(point({ x_m: null }))).toBe(VIOLATION_NON_NUL);
      expect(await codeErreur(point({ y_m: null }))).toBe(VIOLATION_NON_NUL);
    });
  });

  describe('lieu_rangement : un bâtiment ou un point du plan', () => {
    it('lieu d’un bâtiment, lieu d’un point d’eau : acceptés', async () => {
      await lieu({ batiment_id: await batiment() });
      await lieu({ point_plan_id: await point() });
    });

    it('ni l’un ni l’autre, ou les deux : refusé (CHECK)', async () => {
      expect(await codeErreur(lieu())).toBe(VIOLATION_CHECK);
      expect(await codeErreur(lieu({ batiment_id: await batiment(), point_plan_id: await point() }))).toBe(VIOLATION_CHECK);
    });

    it('bâtiment ou point d’une autre ferme : refusé (clé étrangère composée)', async () => {
      const batimentVoisin = await batiment({ ferme_id: autreFerme });
      expect(await codeErreur(lieu({ batiment_id: batimentVoisin }))).toBe(VIOLATION_CLE_ETRANGERE);
      const pointVoisin = await point({ ferme_id: autreFerme });
      expect(await codeErreur(lieu({ point_plan_id: pointVoisin }))).toBe(VIOLATION_CLE_ETRANGERE);
    });

    it('un seul lieu non supprimé par bâtiment et par point ; un lieu supprimé libère l’élément', async () => {
      const b = await batiment();
      const premier = await lieu({ batiment_id: b });
      expect(await codeErreur(lieu({ batiment_id: b }))).toBe(VIOLATION_UNICITE);
      const p = await point();
      await lieu({ point_plan_id: p });
      expect(await codeErreur(lieu({ point_plan_id: p }))).toBe(VIOLATION_UNICITE);
      await c.query(`UPDATE lieu_rangement SET supprime_le = now() WHERE id = $1`, [premier]);
      await lieu({ batiment_id: b });
    });
  });

  describe('place_rangement : emplacements nommés dans un lieu', () => {
    it('« mur nord » dans le hangar : accepté ; la même place dans un autre lieu : permise', async () => {
      const hangar = await lieuDeBatiment();
      const local = await lieuDeBatiment();
      await place({ lieu_rangement_id: hangar, nom: 'mur nord' });
      await place({ lieu_rangement_id: local, nom: 'mur nord' });
    });

    it('même nom dans le même lieu (casse et espaces ignorés) : refusé ; supprimée, le nom est libre', async () => {
      const hangar = await lieuDeBatiment();
      const premiere = await place({ lieu_rangement_id: hangar, nom: 'mur nord' });
      expect(await codeErreur(place({ lieu_rangement_id: hangar, nom: ' Mur Nord ' }))).toBe(VIOLATION_UNICITE);
      await c.query(`UPDATE place_rangement SET supprime_le = now() WHERE id = $1`, [premiere]);
      await place({ lieu_rangement_id: hangar, nom: 'mur nord' });
    });

    it('nom vide, blanc, de plus de 60 caractères : refusé ; 60 caractères : accepté', async () => {
      const hangar = await lieuDeBatiment();
      for (const nom of ['', '  ', 'x'.repeat(61)]) expect(await codeErreur(place({ lieu_rangement_id: hangar, nom })), nom).toBe(VIOLATION_CHECK);
      await place({ lieu_rangement_id: hangar, nom: 'x'.repeat(60) });
    });

    it('lieu d’une autre ferme ou inexistant : refusé', async () => {
      const voisin = await lieuDeBatiment(autreFerme);
      expect(await codeErreur(place({ lieu_rangement_id: voisin }))).toBe(VIOLATION_CLE_ETRANGERE);
      expect(await codeErreur(place({ lieu_rangement_id: randomUUID() }))).toBe(VIOLATION_CLE_ETRANGERE);
    });
  });

  describe('outil : chacun a un lieu de rangement', () => {
    it('Grelinette au hangar, mur nord : acceptée ; une bêche au hangar sans place : acceptée', async () => {
      const hangar = await lieuDeBatiment();
      const murNord = await place({ lieu_rangement_id: hangar, nom: 'mur nord' });
      await outil({ nom: 'Grelinette', lieu_rangement_id: hangar, place_rangement_id: murNord });
      await outil({ nom: 'Bêche', lieu_rangement_id: hangar });
    });

    it('sans lieu de rangement : refusé (non nul)', async () => {
      expect(await codeErreur(outil({ lieu_rangement_id: null }))).toBe(VIOLATION_NON_NUL);
    });

    it('place d’un autre lieu : refusée (la place doit être celle du lieu de l’outil)', async () => {
      const hangar = await lieuDeBatiment();
      const local = await lieuDeBatiment();
      const placeDuLocal = await place({ lieu_rangement_id: local, nom: 'étagère' });
      expect(await codeErreur(outil({ lieu_rangement_id: hangar, place_rangement_id: placeDuLocal }))).toBe(VIOLATION_CLE_ETRANGERE);
    });

    it('lieu ou place d’une autre ferme : refusés', async () => {
      const voisin = await lieuDeBatiment(autreFerme);
      expect(await codeErreur(outil({ lieu_rangement_id: voisin }))).toBe(VIOLATION_CLE_ETRANGERE);
      const mien = await lieuDeBatiment();
      const placeVoisine = await place({ ferme_id: autreFerme, lieu_rangement_id: voisin, nom: 'mur nord' });
      expect(await codeErreur(outil({ lieu_rangement_id: mien, place_rangement_id: placeVoisine }))).toBe(VIOLATION_CLE_ETRANGERE);
    });

    it('nom unique dans la ferme (casse, espaces ignorés) ; deux fermes peuvent avoir leur grelinette ; un outil supprimé libère le nom', async () => {
      const hangar = await lieuDeBatiment();
      const premier = await outil({ nom: 'Fourche-bêche', lieu_rangement_id: hangar });
      expect(await codeErreur(outil({ nom: ' fourche-bêche ', lieu_rangement_id: hangar }))).toBe(VIOLATION_UNICITE);
      const hangarVoisin = await lieuDeBatiment(autreFerme);
      await outil({ ferme_id: autreFerme, nom: 'Fourche-bêche', lieu_rangement_id: hangarVoisin });
      await c.query(`UPDATE outil SET supprime_le = now() WHERE id = $1`, [premier]);
      await outil({ nom: 'Fourche-bêche', lieu_rangement_id: hangar });
    });

    it('nom vide, blanc ou de plus de 80 caractères : refusé', async () => {
      const hangar = await lieuDeBatiment();
      for (const nom of ['', '   ', 'x'.repeat(81)]) expect(await codeErreur(outil({ nom, lieu_rangement_id: hangar })), nom).toBe(VIOLATION_CHECK);
      expect(await codeErreur(outil({ nom: null, lieu_rangement_id: hangar }))).toBe(VIOLATION_NON_NUL);
    });
  });

  describe('fermes existantes', () => {
    it('une ferme sans rien de ce ticket garde ses lignes et ses tables vides', async () => {
      const f = randomUUID();
      await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ancienne', 'Europe/Paris')`, [f]);
      for (const t of TABLES_T61) {
        const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE ferme_id = $1`, [f]);
        expect(r.rows[0]?.n, t).toBe(0);
      }
    });
  });
});

/**
 * Tests d'acceptation T28a — placement réel en base (docs/backlog/T28a-placement-modele.md,
 * critère 5 ; Q31 de docs/questions.md).
 *
 * ── Schéma attendu ──────────────────────────────────────────────────────────────────────────
 *
 * Nouvelles colonnes, toutes NULLABLES et sans défaut : les fermes existantes ne changent pas.
 *   ferme.origine_plan      jsonb   {latitude, longitude} : origine du repère local, distincte
 *                                   de `position` (météo)
 *   zone.contour            jsonb   [{x, y}, …] en mètres locaux ; nul = pas placée, ou abritée
 *   emplacement.placement_x_m, placement_y_m, orientation_deg   numeric (repère de sa zone)
 *
 * Nouvelle table `batiment` (Drizzle : `batiment`, exportée par @planif/db ; migration GÉNÉRÉE
 * par drizzle-kit, plus une migration SQL personnalisée si un déclencheur est nécessaire) :
 *   id uuid PK ; ferme_id uuid NOT NULL → ferme ; nom text NOT NULL ;
 *   type text NOT NULL, CHECK parmi serre_tunnel, serre_chapelle, hangar, magasin, autre ;
 *   longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg numeric NOT NULL ;
 *   zone_id uuid nullable → zone de la MÊME ferme ; cree_le, modifie_le, supprime_le.
 *
 * Contraintes qui rejouent validerPlacement (@planif/core) — refus en 23514 (CHECK ou
 * déclencheur en check_violation), sauf mention :
 *   - batiment : dimensions > 0 et ≤ 500 / 200 / 30 m ; orientation dans [0, 360[ ;
 *     centre à 5 000 m au plus de l'origine (x² + y² ≤ 25 000 000) ;
 *   - batiment.zone_id d'une autre ferme : refusé (23503 par clé étrangère composée, ou 23514) ;
 *   - au plus un bâtiment NON SUPPRIMÉ par zone : index unique partiel (23505) ;
 *   - zone abritée sans contour : un bâtiment non supprimé ne peut viser une zone qui a un
 *     contour, et une zone abritée ne peut pas recevoir de contour (déclencheurs, 23514) ;
 *   - emplacement : tout ou rien des trois colonnes ; orientation dans [0, 360[ ;
 *     x² + y² ≤ 25 000 000 ;
 *   - zone.contour : tableau jsonb de 3 à 200 éléments, chacun un objet dont x et y sont des
 *     nombres, à 5 000 m au plus de l'origine ; texte jsonb de 16 384 caractères au plus
 *     (taille bornée). Les règles géométriques (auto-intersection, aire, sens) restent au
 *     serveur, qui appelle validerContour (T28s).
 * Index : batiment(ferme_id) ; index unique partiel batiment(zone_id) WHERE supprime_le IS NULL.
 * Publication « powersync » : batiment y entre. Historique : modification.nom_table accepte
 * 'Batiment'.
 *
 * Exécution comme type-intervention.integration.test.ts : DATABASE_URL (Postgres avec
 * CREATEDB) ; sans elle, sautés en local (l'échec clair en CI est porté par
 * schema.integration.test.ts).
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

const COLONNES_BATIMENT = [
  'centre_x_m',
  'centre_y_m',
  'cree_le',
  'ferme_id',
  'hauteur_m',
  'id',
  'largeur_m',
  'longueur_m',
  'modifie_le',
  'nom',
  'orientation_deg',
  'supprime_le',
  'type',
  'zone_id',
];

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
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T28a)');
}

const tablesDrizzle = () =>
  (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));

describe('T28a : schéma Drizzle et migration générée', () => {
  it('@planif/db déclare la table batiment et les nouvelles colonnes', () => {
    const tables = tablesDrizzle();
    const colonnes = (nom: string) => tables.find((t) => t.name === nom)?.columns.map((c) => c.name) ?? [];
    expect(colonnes('batiment').sort()).toEqual(COLONNES_BATIMENT);
    expect(colonnes('ferme')).toContain('origine_plan');
    expect(colonnes('ferme'), 'la position météo reste').toContain('position');
    expect(colonnes('zone')).toContain('contour');
    expect(colonnes('emplacement')).toEqual(expect.arrayContaining(['placement_x_m', 'placement_y_m', 'orientation_deg']));
  });

  it('le dernier instantané de drizzle-kit les connaît : migration générée, pas écrite à la main', () => {
    const meta = new URL('../migrations/meta/', import.meta.url);
    const journal = JSON.parse(readFileSync(new URL('_journal.json', meta), 'utf8')) as { entries: { idx: number }[] };
    const dernier = journal.entries.at(-1)?.idx ?? -1;
    const nom = `${String(dernier).padStart(4, '0')}_snapshot.json`;
    const instantane = JSON.parse(readFileSync(new URL(nom, meta), 'utf8')) as { tables: Record<string, { columns: Record<string, unknown> } | undefined> };
    expect(Object.keys(instantane.tables['public.batiment']?.columns ?? {}).sort(), `public.batiment dans ${nom}`).toEqual(COLONNES_BATIMENT);
    expect(Object.keys(instantane.tables['public.ferme']?.columns ?? {})).toContain('origine_plan');
    expect(Object.keys(instantane.tables['public.zone']?.columns ?? {})).toContain('contour');
    expect(Object.keys(instantane.tables['public.emplacement']?.columns ?? {})).toEqual(expect.arrayContaining(['placement_x_m', 'placement_y_m', 'orientation_deg']));
  });

  it('les fermes existantes ne changent pas : les migrations du ticket ne réécrivent aucune ligne', () => {
    const dossier = new URL('../migrations/', import.meta.url);
    const nouvelles = readdirSync(dossier)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 25)
      .map((f) => ({ f, sql: readFileSync(new URL(f, dossier), 'utf8') }))
      .filter(({ sql }) => /\bbatiment\b|origine_plan|placement_x_m|\bcontour\b/.test(sql));
    expect(nouvelles.length, 'au moins une migration T28a (0025 ou après)').toBeGreaterThan(0);
    for (const { f, sql } of nouvelles) {
      expect(sql, f).not.toMatch(/\bUPDATE\s+"?(ferme|zone|emplacement)"?\s+SET\b/i);
      expect(sql, f).not.toMatch(/\bDELETE\s+FROM\s+"?(ferme|zone|emplacement)"?/i);
      // Colonnes ajoutées aux tables existantes : ni NOT NULL ni DEFAULT (rien à remplir).
      for (const ajout of sql.match(/ALTER TABLE "?(ferme|zone|emplacement)"? ADD COLUMN[^;]*/gi) ?? []) {
        expect(ajout, f).not.toMatch(/\bNOT NULL\b|\bDEFAULT\b/i);
      }
    }
  });
});

decrireAvecBase('T28a : placement en base (PostgreSQL)', { timeout: 30_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t28a_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const autreFerme = randomUUID();
  const utilisateur = randomUUID();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    await db.appliquerMigrations(urlDe(base));
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T28a', 'Europe/Paris'), ($2, 'Ferme voisine', 'Europe/Paris')`, [ferme, autreFerme]);
    await c.query(`INSERT INTO utilisateur (id, email, nom) VALUES ($1, $2, 'Théophane')`, [utilisateur, `t28a-${utilisateur}@ferme.fr`]);
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  async function zone(options: { ferme?: string; contour?: unknown } = {}): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO zone (id, ferme_id, nom, type_abri, contour) VALUES ($1, $2, $3, 'tunnel', $4::jsonb)`, [
      id,
      options.ferme ?? ferme,
      `Zone ${id.slice(0, 6)}`,
      options.contour === undefined || options.contour === null ? null : JSON.stringify(options.contour),
    ]);
    return id;
  }

  const BATIMENT = { nom: 'Serre M3', type: 'serre_tunnel', longueur_m: 40, largeur_m: 8, hauteur_m: 3.5, centre_x_m: 50, centre_y_m: 30, orientation_deg: 90 } as const;

  async function batiment(colonnes: Partial<Record<keyof typeof BATIMENT | 'ferme_id' | 'zone_id', unknown>> = {}): Promise<string> {
    const id = randomUUID();
    const l = { ...BATIMENT, ferme_id: ferme, zone_id: null, ...colonnes };
    await c.query(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, l.ferme_id, l.nom, l.type, l.longueur_m, l.largeur_m, l.hauteur_m, l.centre_x_m, l.centre_y_m, l.orientation_deg, l.zone_id],
    );
    return id;
  }

  async function emplacement(placement: { x: unknown; y: unknown; o: unknown }): Promise<string> {
    const id = randomUUID();
    const z = await zone();
    await c.query(
      `INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du, placement_x_m, placement_y_m, orientation_deg)
       VALUES ($1, $2, $3, $4, 'planche', 30, '2026-01-01', $5, $6, $7)`,
      [id, ferme, z, `P-${id.slice(0, 8)}`, placement.x, placement.y, placement.o],
    );
    return id;
  }

  const CARRE = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
  ];

  describe('colonnes', () => {
    it('batiment : types et nullabilité', async () => {
      const r = await c.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name::text, data_type::text, is_nullable::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'batiment' ORDER BY column_name`,
      );
      expect(Object.fromEntries(r.rows.map((l) => [l.column_name, { type: l.data_type, nul: l.is_nullable === 'YES' }]))).toEqual({
        centre_x_m: { type: 'numeric', nul: false },
        centre_y_m: { type: 'numeric', nul: false },
        cree_le: { type: 'timestamp with time zone', nul: false },
        ferme_id: { type: 'uuid', nul: false },
        hauteur_m: { type: 'numeric', nul: false },
        id: { type: 'uuid', nul: false },
        largeur_m: { type: 'numeric', nul: false },
        longueur_m: { type: 'numeric', nul: false },
        modifie_le: { type: 'timestamp with time zone', nul: false },
        nom: { type: 'text', nul: false },
        orientation_deg: { type: 'numeric', nul: false },
        supprime_le: { type: 'timestamp with time zone', nul: true },
        type: { type: 'text', nul: false },
        zone_id: { type: 'uuid', nul: true },
      });
    });

    it('nouvelles colonnes de ferme, zone, emplacement : nullables, sans défaut', async () => {
      const r = await c.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT table_name::text, column_name::text, data_type::text, is_nullable::text, column_default::text FROM information_schema.columns
         WHERE table_schema = 'public' AND (table_name, column_name) IN
           (('ferme', 'origine_plan'), ('zone', 'contour'), ('emplacement', 'placement_x_m'), ('emplacement', 'placement_y_m'), ('emplacement', 'orientation_deg'))
         ORDER BY table_name, column_name`,
      );
      expect(r.rows).toEqual([
        { table_name: 'emplacement', column_name: 'orientation_deg', data_type: 'numeric', is_nullable: 'YES', column_default: null },
        { table_name: 'emplacement', column_name: 'placement_x_m', data_type: 'numeric', is_nullable: 'YES', column_default: null },
        { table_name: 'emplacement', column_name: 'placement_y_m', data_type: 'numeric', is_nullable: 'YES', column_default: null },
        { table_name: 'ferme', column_name: 'origine_plan', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
        { table_name: 'zone', column_name: 'contour', data_type: 'jsonb', is_nullable: 'YES', column_default: null },
      ]);
    });

    it('une ferme saisie comme avant (sans placement) : nouvelles colonnes nulles, rien d’autre ne bouge', async () => {
      const f = randomUUID();
      const z = randomUUID();
      const e = randomUUID();
      await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire, position) VALUES ($1, 'Ancienne', 'Europe/Paris', '{"latitude":44,"longitude":1.5}')`, [f]);
      await c.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'T1', 'tunnel')`, [z, f]);
      await c.query(`INSERT INTO emplacement (id, ferme_id, zone_id, code, sorte, longueur_m, actif_du) VALUES ($1, $2, $3, 'T1-P1', 'planche', 30, '2026-01-01')`, [e, f, z]);
      const r = await c.query<{ origine_plan: unknown; position: unknown; contour: unknown; x: unknown; y: unknown; o: unknown }>(
        `SELECT f.origine_plan, f.position, z.contour, e.placement_x_m AS x, e.placement_y_m AS y, e.orientation_deg AS o
         FROM ferme f JOIN zone z ON z.ferme_id = f.id JOIN emplacement e ON e.zone_id = z.id WHERE f.id = $1`,
        [f],
      );
      expect(r.rows).toEqual([{ origine_plan: null, position: { latitude: 44, longitude: 1.5 }, contour: null, x: null, y: null, o: null }]);
    });

    it('origine_plan : distincte de la position météo', async () => {
      const f = randomUUID();
      await c.query(
        `INSERT INTO ferme (id, nom, fuseau_horaire, position, origine_plan) VALUES ($1, 'Placée', 'Europe/Paris', '{"latitude":44.1,"longitude":1.6}', '{"latitude":44,"longitude":1.5}')`,
        [f],
      );
      const r = await c.query<{ position: unknown; origine_plan: unknown }>(`SELECT position, origine_plan FROM ferme WHERE id = $1`, [f]);
      expect(r.rows[0]).toEqual({ position: { latitude: 44.1, longitude: 1.6 }, origine_plan: { latitude: 44, longitude: 1.5 } });
    });
  });

  describe('batiment', () => {
    it('serre de 40 × 8 m : acceptée, nombres relus exactement', async () => {
      const id = await batiment({ centre_x_m: 50.25, orientation_deg: 92.5 });
      const r = await c.query<{ centre_x_m: string; orientation_deg: string; supprime_le: unknown }>(`SELECT centre_x_m, orientation_deg, supprime_le FROM batiment WHERE id = $1`, [id]);
      expect(Number(r.rows[0]?.centre_x_m)).toBe(50.25);
      expect(Number(r.rows[0]?.orientation_deg)).toBe(92.5);
      expect(r.rows[0]?.supprime_le).toBeNull();
    });

    it.each(['serre_tunnel', 'serre_chapelle', 'hangar', 'magasin', 'autre'])('type %s : accepté', async (type) => {
      await batiment({ type });
    });

    it('type inconnu : refusé', async () => {
      expect([VIOLATION_CHECK, '22P02']).toContain(await codeErreur(batiment({ type: 'chateau' })));
    });

    it('plafonds pile (500 × 200 × 30 m), orientation 359,9, centre à 5 km pile : acceptés', async () => {
      await batiment({ longueur_m: 500, largeur_m: 200, hauteur_m: 30, orientation_deg: 359.9, centre_x_m: 3_000, centre_y_m: -4_000 });
    });

    it.each([
      ['longueur_m', 0],
      ['longueur_m', 500.5],
      ['largeur_m', -1],
      ['largeur_m', 201],
      ['hauteur_m', 0],
      ['hauteur_m', 30.5],
      ['orientation_deg', 360],
      ['orientation_deg', -0.5],
      ['centre_x_m', 6_000],
      ['centre_y_m', -5_000.5],
    ] as const)('%s = %s : refusé (CHECK)', async (colonne, valeur) => {
      expect(await codeErreur(batiment({ [colonne]: valeur }))).toBe(VIOLATION_CHECK);
    });

    it.each(['nom', 'type', 'longueur_m', 'largeur_m', 'hauteur_m', 'centre_x_m', 'centre_y_m', 'orientation_deg'] as const)(
      '%s manquant : refusé',
      async (colonne) => {
        expect(await codeErreur(batiment({ [colonne]: null }))).toBe(VIOLATION_NON_NUL);
      },
    );

    it('ferme inexistante : refusée (clé étrangère)', async () => {
      expect(await codeErreur(batiment({ ferme_id: randomUUID() }))).toBe(VIOLATION_CLE_ETRANGERE);
    });

    it('zone d’une autre ferme : refusée', async () => {
      const z = await zone({ ferme: autreFerme });
      expect([VIOLATION_CLE_ETRANGERE, VIOLATION_CHECK]).toContain(await codeErreur(batiment({ zone_id: z })));
    });

    it('au plus un bâtiment non supprimé par zone ; un bâtiment supprimé libère la zone', async () => {
      const z = await zone();
      const premier = await batiment({ zone_id: z });
      expect(await codeErreur(batiment({ zone_id: z, nom: 'Doublon' }))).toBe(VIOLATION_UNICITE);
      await c.query(`UPDATE batiment SET supprime_le = now() WHERE id = $1`, [premier]);
      await batiment({ zone_id: z, nom: 'Nouvelle serre' });
      // Plusieurs bâtiments sans zone : permis.
      await batiment({ zone_id: null, nom: 'Hangar 1', type: 'hangar' });
      await batiment({ zone_id: null, nom: 'Hangar 2', type: 'hangar' });
    });
  });

  describe('serre et zone : une zone abritée n’a pas de contour', () => {
    it('bâtiment sur une zone qui a un contour : refusé', async () => {
      const z = await zone({ contour: CARRE });
      expect(await codeErreur(batiment({ zone_id: z }))).toBe(VIOLATION_CHECK);
    });

    it('rattacher après coup un bâtiment à une zone qui a un contour : refusé', async () => {
      const z = await zone({ contour: CARRE });
      const b = await batiment();
      expect(await codeErreur(c.query(`UPDATE batiment SET zone_id = $2 WHERE id = $1`, [b, z]))).toBe(VIOLATION_CHECK);
    });

    it('donner un contour à une zone abritée : refusé', async () => {
      const z = await zone();
      await batiment({ zone_id: z });
      expect(await codeErreur(c.query(`UPDATE zone SET contour = $2::jsonb WHERE id = $1`, [z, JSON.stringify(CARRE)]))).toBe(VIOLATION_CHECK);
    });

    it('effacer le contour puis rattacher le bâtiment (ce que fera l’écran, T28b) : accepté', async () => {
      const z = await zone({ contour: CARRE });
      await c.query(`UPDATE zone SET contour = NULL WHERE id = $1`, [z]);
      await batiment({ zone_id: z });
    });

    it('bâtiment supprimé : la zone peut reprendre un contour', async () => {
      const z = await zone();
      const b = await batiment({ zone_id: z });
      await c.query(`UPDATE batiment SET supprime_le = now() WHERE id = $1`, [b]);
      await c.query(`UPDATE zone SET contour = $2::jsonb WHERE id = $1`, [z, JSON.stringify(CARRE)]);
    });
  });

  describe('zone.contour', () => {
    it('polygone de 4 sommets : accepté, relu tel quel', async () => {
      const z = await zone({ contour: CARRE });
      const r = await c.query<{ contour: unknown }>(`SELECT contour FROM zone WHERE id = $1`, [z]);
      expect(r.rows[0]?.contour).toEqual(CARRE);
    });

    it('200 sommets : accepté', async () => {
      const contour = Array.from({ length: 200 }, (_, i) => ({ x: 4_000 * Math.cos((2 * Math.PI * i) / 200), y: 4_000 * Math.sin((2 * Math.PI * i) / 200) }));
      await zone({ contour });
    });

    it.each([
      ['pas un tableau', { x: 0, y: 0 }],
      ['2 sommets', CARRE.slice(0, 2)],
      ['201 sommets', Array.from({ length: 201 }, (_, i) => ({ x: i, y: i % 2 }))],
      ['x en texte', [{ x: '0', y: 0 }, ...CARRE.slice(1)]],
      ['y manquant', [{ x: 0 }, ...CARRE.slice(1)]],
      ['sommet qui n’est pas un objet', [[0, 0], ...CARRE.slice(1)]],
      ['sommet à 6 km', [{ x: 6_000, y: 0 }, ...CARRE.slice(1)]],
      ['plus de 16 384 caractères', CARRE.map((p, i) => (i === 0 ? { ...p, note: 'a'.repeat(17_000) } : p))],
    ] as const)('%s : refusé (CHECK)', async (_cas, contour) => {
      expect(await codeErreur(zone({ contour }))).toBe(VIOLATION_CHECK);
    });
  });

  describe('emplacement', () => {
    it('placé (2 ; −0,5 ; 92,5°) ou pas placé : accepté', async () => {
      const id = await emplacement({ x: 2, y: -0.5, o: 92.5 });
      const r = await c.query<{ x: string; y: string; o: string }>(`SELECT placement_x_m AS x, placement_y_m AS y, orientation_deg AS o FROM emplacement WHERE id = $1`, [id]);
      expect([r.rows[0]?.x, r.rows[0]?.y, r.rows[0]?.o].map(Number)).toEqual([2, -0.5, 92.5]);
      await emplacement({ x: null, y: null, o: null });
    });

    it.each([
      [{ x: 2, y: null, o: 0 }],
      [{ x: null, y: 3, o: 0 }],
      [{ x: 2, y: 3, o: null }],
      [{ x: null, y: null, o: 90 }],
    ])('tout ou rien : %o refusé', async (p) => {
      expect(await codeErreur(emplacement(p))).toBe(VIOLATION_CHECK);
    });

    it.each([
      [{ x: 0, y: 0, o: 360 }],
      [{ x: 0, y: 0, o: -1 }],
      [{ x: 3_000, y: 4_001, o: 0 }],
    ])('hors bornes : %o refusé', async (p) => {
      expect(await codeErreur(emplacement(p))).toBe(VIOLATION_CHECK);
    });
  });

  describe('index, publication, historique', () => {
    it('index sur batiment(ferme_id) et index unique partiel sur batiment(zone_id), bâtiments non supprimés', async () => {
      const r = await c.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'batiment'`);
      const defs = r.rows.map((l) => l.indexdef);
      expect(defs.some((d) => /\(ferme_id\b/.test(d)), defs.join('\n')).toBe(true);
      expect(
        defs.some((d) => d.includes('UNIQUE INDEX') && d.includes('(zone_id)') && d.includes('supprime_le IS NULL')),
        defs.join('\n'),
      ).toBe(true);
    });

    it('batiment est dans la publication « powersync » (il descend sur les téléphones)', async () => {
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = 'batiment'`,
      );
      expect(r.rows[0]?.n).toBe(1);
    });

    it('l’historique accepte nom_table = Batiment', async () => {
      const b = await batiment({ nom: 'Magasin', type: 'magasin' });
      await c.query(
        `INSERT INTO modification (id, ferme_id, nom_table, ligne_id, auteur_id, horodatage, operation, avant, apres, cree_le, modifie_le)
         VALUES ($1, $2, 'Batiment', $3, $4, now(), 'creation', NULL, '{}'::jsonb, now(), now())`,
        [randomUUID(), ferme, b, utilisateur],
      );
    });
  });
});

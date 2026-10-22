/**
 * Tests d'acceptation T58 — état des serres en base (docs/backlog/T58-etat-serres.md, règles 1
 * et 2). Pas de nouvelle table : un nouveau TYPE d'événement `etat_abri` (détail { zoneId,
 * equipement, actif }) et une colonne facultative `zone.equipements_abri`.
 *
 * ── Schéma attendu ──────────────────────────────────────────────────────────────────────────
 *
 *   evenement.type   CHECK étendu : + 'etat_abri' (`TYPES_EVENEMENT` de @planif/db aussi). Le
 *                    CHECK de détail exige, pour ce type : zoneId = chaîne au format uuid,
 *                    equipement ∈ ouvrants_lateraux | ouvrants_faitage | portes | chauffage | voile,
 *                    actif = booléen JSON (`EQUIPEMENTS_ABRI` exporté par @planif/db). Les autres
 *                    types ne changent pas. Que la zone soit de la ferme et déclare cet équipement
 *                    se vérifie au serveur (jsonb : pas de clé étrangère).
 *   zone.equipements_abri   jsonb nullable ; nul = liste par défaut du type d'abri. Sinon un
 *                    tableau JSON de 0 à 5 noms d'équipement connus, sans doublon.
 *
 * Migration GÉNÉRÉE par drizzle-kit (0047 ou après), qui ne réécrit aucune ligne existante.
 * Violations en 23514 (CHECK). Exécution comme plan-chemins.integration.test.ts : DATABASE_URL.
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
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T58)');
}

describe('T58 : schéma Drizzle et migration générée', () => {
  it('@planif/db connaît le type etat_abri et la liste des équipements', () => {
    expect([...db.TYPES_EVENEMENT]).toContain('etat_abri');
    expect((db as unknown as { EQUIPEMENTS_ABRI?: readonly string[] }).EQUIPEMENTS_ABRI).toEqual(['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile']);
  });

  it('zone a une colonne equipements_abri (jsonb, facultative)', () => {
    const zone = (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t)).find((t) => t.name === 'zone');
    const colonne = zone?.columns.find((c) => c.name === 'equipements_abri');
    expect(colonne?.columnType).toBe('PgJsonb');
    expect(colonne?.notNull).toBe(false);
  });

  it('le dernier instantané de drizzle-kit connaît la colonne : migration générée, pas écrite à la main', () => {
    const meta = new URL('../migrations/meta/', import.meta.url);
    const journal = JSON.parse(readFileSync(new URL('_journal.json', meta), 'utf8')) as { entries: { idx: number }[] };
    const dernier = journal.entries.at(-1)?.idx ?? -1;
    expect(dernier, 'une migration après 0046').toBeGreaterThanOrEqual(47);
    const nom = `${String(dernier).padStart(4, '0')}_snapshot.json`;
    const instantane = JSON.parse(readFileSync(new URL(nom, meta), 'utf8')) as { tables: Record<string, { columns: Record<string, unknown> } | undefined> };
    expect(Object.keys(instantane.tables['public.zone']?.columns ?? {})).toContain('equipements_abri');
  });

  it('les migrations du ticket ne réécrivent aucune ligne existante', () => {
    const dossier = new URL('../migrations/', import.meta.url);
    const nouvelles = readdirSync(dossier).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 47);
    expect(nouvelles.length, 'au moins une migration T58 (0047 ou après)').toBeGreaterThan(0);
    for (const f of nouvelles) {
      const sql = readFileSync(new URL(f, dossier), 'utf8');
      expect(sql, f).not.toMatch(/\bUPDATE\s+"?(ferme|zone|emplacement|batiment|evenement|serie)"?\s+SET\b/i);
      expect(sql, f).not.toMatch(/\bDELETE\s+FROM\b/i);
    }
  });
});

decrireAvecBase('T58 : état des serres en base (PostgreSQL)', { timeout: 30_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t58_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const utilisateur = randomUUID();
  const serre = randomUUID();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    await db.appliquerMigrations(urlDe(base));
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T58', 'Europe/Paris')`, [ferme]);
    await c.query(`INSERT INTO utilisateur (id, email) VALUES ($1, 'serres@ferme.fr')`, [utilisateur]);
    await c.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, 'Serre 1', 'serre')`, [serre, ferme]);
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  function evenement(detail: unknown, type = 'etat_abri'): Promise<unknown> {
    return c.query(
      `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, detail)
       VALUES ($1, $2, $3, '2026-10-22', '2026-10-22T07:00:00Z', $4, 'tap', ARRAY[]::uuid[], $5::jsonb)`,
      [randomUUID(), ferme, type, utilisateur, JSON.stringify(detail)],
    );
  }

  describe('événement etat_abri', () => {
    it('« ouvrants latéraux ouverts » : accepté, pour chaque équipement et chaque état', async () => {
      for (const equipement of ['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile']) {
        for (const actif of [true, false]) await evenement({ zoneId: serre, equipement, actif });
      }
      const r = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM evenement WHERE type = 'etat_abri'`);
      expect(r.rows[0]?.n).toBe('10');
    });

    it('zone absente ou pas un uuid : refusé', async () => {
      await evenement({ zoneId: serre, equipement: 'portes', actif: true }); // la forme valide passe d'abord
      expect(await codeErreur(evenement({ equipement: 'portes', actif: true }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(evenement({ zoneId: 'serre-1', equipement: 'portes', actif: true }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(evenement({ zoneId: 12, equipement: 'portes', actif: true }))).toBe(VIOLATION_CHECK);
    });

    it('équipement absent ou inconnu : refusé', async () => {
      await evenement({ zoneId: serre, equipement: 'portes', actif: true }); // la forme valide passe d'abord
      expect(await codeErreur(evenement({ zoneId: serre, actif: true }))).toBe(VIOLATION_CHECK);
      expect(await codeErreur(evenement({ zoneId: serre, equipement: 'arrosage', actif: true }))).toBe(VIOLATION_CHECK);
    });

    it('état absent ou pas un booléen JSON (« ouvert », 1, "true") : refusé', async () => {
      await evenement({ zoneId: serre, equipement: 'portes', actif: true }); // la forme valide passe d'abord
      expect(await codeErreur(evenement({ zoneId: serre, equipement: 'portes' }))).toBe(VIOLATION_CHECK);
      for (const actif of ['ouvert', 1, 'true', null]) expect(await codeErreur(evenement({ zoneId: serre, equipement: 'portes', actif }))).toBe(VIOLATION_CHECK);
    });

    it('les autres types gardent leurs règles : une observation reste refusée sans nature', async () => {
      expect(await codeErreur(evenement({ gravite: 'forte' }, 'observation'))).toBe(VIOLATION_CHECK);
    });

    it('une correction et une annulation sont des événements etat_abri qui désignent l’original', async () => {
      const origine = randomUUID();
      await c.query(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, detail)
         VALUES ($1, $2, 'etat_abri', '2026-10-22', '2026-10-22T07:00:00Z', $3, 'tap', ARRAY[]::uuid[], $4::jsonb)`,
        [origine, ferme, utilisateur, JSON.stringify({ zoneId: serre, equipement: 'portes', actif: true })],
      );
      await c.query(
        `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, emplacement_ids, detail, remplace_sorte, remplace_evenement_id)
         VALUES ($1, $2, 'etat_abri', '2026-10-22', '2026-10-22T07:01:00Z', $3, 'tap', ARRAY[]::uuid[], $4::jsonb, 'annulation', $5)`,
        [randomUUID(), ferme, utilisateur, JSON.stringify({ zoneId: serre, equipement: 'portes', actif: true }), origine],
      );
      const r = await c.query<{ id: string }>(`SELECT id::text FROM evenements_en_vigueur WHERE ferme_id = $1 AND detail ->> 'equipement' = 'portes'`, [ferme]);
      expect(r.rows.map((x) => x.id)).not.toContain(origine);
    });
  });

  describe('zone.equipements_abri', () => {
    const poser = (valeur: unknown, id: string = serre): Promise<unknown> => c.query(`UPDATE zone SET equipements_abri = $2::jsonb WHERE id = $1`, [id, valeur === null ? null : JSON.stringify(valeur)]);

    it('nulle par défaut (liste du type d’abri) ; une zone existante n’est pas réécrite', async () => {
      const r = await c.query<{ equipements_abri: unknown }>(`SELECT equipements_abri FROM zone WHERE id = $1`, [serre]);
      expect(r.rows[0]?.equipements_abri).toBeNull();
    });

    it('liste valide, liste vide, retour à nul : acceptés', async () => {
      await poser(['ouvrants_lateraux', 'portes', 'chauffage']);
      await poser([]);
      await poser(['ouvrants_lateraux', 'ouvrants_faitage', 'portes', 'chauffage', 'voile']);
      await poser(null);
    });

    it('nom inconnu, doublon, pas un tableau, élément pas un texte, plus de 5 noms : refusés', async () => {
      await poser(['portes']); // la forme valide passe d'abord
      for (const mauvaise of [['arrosage'], ['portes', 'portes'], { portes: true }, 'portes', [1], [null], ['portes', 'voile', 'chauffage', 'ouvrants_lateraux', 'ouvrants_faitage', 'portes']]) {
        expect(await codeErreur(poser(mauvaise)), JSON.stringify(mauvaise)).toBe(VIOLATION_CHECK);
      }
    });
  });
});

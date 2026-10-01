/**
 * Tests d'acceptation T10h, décision 1 du chef après la relecture (B1 — origine introuvable).
 *
 * Deux connexions. La session 1 insère e1, correction de d2 dans la chaîne a0 (a0 → d1 → d2),
 * sans valider. La session 2 insère e2, correction de e1, pendant que e1 n'est pas encore visible
 * pour elle ; la session 1 valide pendant que l'insertion de e2 attend.
 *
 * Contrat : jamais `e2.origine_id = e1` (e2 formerait une chaîne à part, la vue montrerait deux
 * lignes en vigueur pour la même récolte). Décision 1 : le déclencheur BEFORE INSERT lève une
 * erreur de référence (23503) quand l'origine du parent ne peut pas être lue, au lieu de retomber
 * sur le parent ; l'API la voit comme un parent absent et refuse, le téléphone renverra.
 *   - a. témoin, INSERT … VALUES : la clé étrangère ne voit pas e1 non plus → 23503 ;
 *   - b. scénario du relecteur, INSERT … SELECT : la ligne de e2 passe le déclencheur (e1
 *     invisible), puis pg_sleep sur la ligne suivante ; la session 1 valide pendant l'attente, et
 *     la clé étrangère, vérifiée en fin d'instruction, voit e1 → avant la décision 1, e2 était
 *     écrite avec origine_id = e1. Attendu : 23503 (forme figée par la décision 1) ;
 *   - c. témoin, pg_sleep AVANT la ligne de e2 : le déclencheur voit e1 validée → soit 23503,
 *     soit `origine_id = a0` et la vue juste ; jamais `origine_id = e1`.
 *
 * Même exécution que vues.integration.test.ts : DATABASE_URL, sinon sauté en local.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appliquerMigrations } from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

decrireAvecBase('T10h, décision 1 : origine introuvable à l’insertion (deux connexions)', { timeout: 60_000 }, () => {
  const nom = `t10h_b1_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let admin: pg.Client;
  let s1: pg.Client;
  let s2: pg.Client;
  const ferme = randomUUID();
  const auteur = randomUUID();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nom}`);
    const url = new URL(URL_BASE);
    url.pathname = `/${nom}`;
    await appliquerMigrations(url.toString());
    s1 = new pg.Client({ connectionString: url.toString() });
    s2 = new pg.Client({ connectionString: url.toString() });
    await s1.connect();
    await s2.connect();
    await s1.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme', 'Europe/Paris')`, [ferme]);
    await s1.query(`INSERT INTO utilisateur (id, email) VALUES ($1, 'auteur@ferme.fr')`, [auteur]);
  }, 120_000);

  afterAll(async () => {
    await s1.end();
    await s2.end();
    await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    await admin.end();
  });

  const COLONNES = `(id, ferme_id, type, date, horodatage, auteur_id, source, detail, remplace_sorte, remplace_evenement_id)`;
  const DETAIL = '{"quantite": 12, "unite": "kg", "categorie": null}';

  async function ecrire(c: pg.Client, horodatage: string, parent: string | null): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO evenement ${COLONNES} VALUES ($1, $2, 'recolte', '2026-10-01', $3, $4, 'tap', $5, $6, $7)`, [
      id,
      ferme,
      horodatage,
      auteur,
      DETAIL,
      parent === null ? null : 'correction',
      parent,
    ]);
    return id;
  }

  /** a0 → d1 → d2, validés. */
  async function chaine(): Promise<{ a0: string; d2: string }> {
    const a0 = await ecrire(s1, '2026-10-01T03:00:00Z', null);
    const d1 = await ecrire(s1, '2026-10-01T04:00:00Z', a0);
    const d2 = await ecrire(s1, '2026-10-01T05:00:00Z', d1);
    return { a0, d2 };
  }

  async function origineDe(id: string): Promise<string | null> {
    const r = await s1.query<{ o: string }>(`SELECT origine_id::text AS o FROM evenement WHERE id = $1`, [id]);
    return r.rows[0]?.o ?? null;
  }

  async function enVigueur(ids: readonly string[]): Promise<string[]> {
    const r = await s1.query<{ id: string }>(`SELECT id::text AS id FROM evenements_en_vigueur WHERE id = ANY($1::uuid[]) ORDER BY id`, [ids]);
    return r.rows.map((l) => l.id);
  }

  async function lignesDeLaFerme(ids: readonly string[]): Promise<string[]> {
    const r = await s1.query<{ id: string }>(`SELECT id::text AS id FROM evenements_en_vigueur WHERE ferme_id = $1`, [ferme]);
    return r.rows.map((l) => l.id).filter((id) => ids.includes(id));
  }

  /** Erreur de `p` (null si l'insertion a réussi). */
  async function erreurDe(p: Promise<unknown>): Promise<{ code?: string } | null> {
    try {
      await p;
      return null;
    } catch (e) {
      return e as { code?: string };
    }
  }

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('a. témoin : INSERT … VALUES de e2 pendant que e1 n’est pas validé : refusé (23503), jamais une chaîne à part ; e1 en vigueur', async () => {
    const { a0, d2 } = await chaine();
    const e1 = randomUUID();
    const e2 = randomUUID();
    await s1.query('BEGIN');
    await s1.query(`INSERT INTO evenement ${COLONNES} VALUES ($1, $2, 'recolte', '2026-10-01', '2026-10-01T06:00:00Z', $3, 'tap', $4, 'correction', $5)`, [
      e1,
      ferme,
      auteur,
      DETAIL,
      d2,
    ]);
    const insertion = s2.query(
      `INSERT INTO evenement ${COLONNES} VALUES ($1, $2, 'recolte', '2026-10-01', '2026-10-01T07:00:00Z', $3, 'tap', $4, 'correction', $5)`,
      [e2, ferme, auteur, DETAIL, e1],
    );
    const erreur = erreurDe(insertion);
    await pause(300);
    await s1.query('COMMIT');
    const e = await erreur;

    expect(await origineDe(e1)).toBe(a0);
    // Jamais e2 rattachée à e1 comme à une origine.
    expect(await origineDe(e2)).not.toBe(e1);
    expect(e?.code, `insertion de e2 : ${e === null ? 'acceptée, origine ' + String(await origineDe(e2)) : String(e.code)}`).toBe('23503');
    expect(await enVigueur([a0, e1, e2])).toEqual([e1]);
    expect(await lignesDeLaFerme([a0, e1, e2])).toEqual([e1]);
  });

  it('b. scénario du relecteur : e2 insérée (déclencheur : e1 invisible) puis pg_sleep sur la ligne suivante du même INSERT … SELECT, la session 1 valide pendant l’attente : 23503, jamais origine e1', async () => {
    const { a0, d2 } = await chaine();
    const e1 = randomUUID();
    const e2 = randomUUID();
    const e3 = randomUUID();
    await s1.query('BEGIN');
    await s1.query(`INSERT INTO evenement ${COLONNES} VALUES ($1, $2, 'recolte', '2026-10-01', '2026-10-01T06:00:00Z', $3, 'tap', $4, 'correction', $5)`, [
      e1,
      ferme,
      auteur,
      DETAIL,
      d2,
    ]);
    // Ligne 1 : e2, correction de e1 (son déclencheur s'exécute tout de suite, e1 encore invisible).
    // Ligne 2 : e3, correction de a0, calculée après une attente. La clé étrangère de e2 n'est
    // vérifiée qu'en fin d'instruction, après la validation de la session 1.
    const insertion = s2.query(
      `INSERT INTO evenement ${COLONNES}
       SELECT CASE WHEN n = 1 THEN $1::uuid ELSE $2::uuid END, $3::uuid, 'recolte', '2026-10-01',
              '2026-10-01T07:00:00Z'::timestamptz + n * interval '1 minute', $4::uuid, 'tap', $5::jsonb, 'correction',
              CASE WHEN n = 1 THEN $6::uuid ELSE $7::uuid END
       FROM generate_series(1, 2) n, LATERAL (SELECT pg_sleep(CASE WHEN n = 2 THEN 0.8 ELSE 0 END)) attente`,
      [e2, e3, ferme, auteur, DETAIL, e1, a0],
    );
    const erreur = erreurDe(insertion);
    await pause(300);
    await s1.query('COMMIT');
    const e = await erreur;

    expect(await origineDe(e1)).toBe(a0);
    expect(await origineDe(e2), 'e2 rattachée à e1 comme à une origine').not.toBe(e1);
    expect(e?.code, `insertion de e2 : ${e === null ? 'acceptée' : String(e.code)}`).toBe('23503');
    expect(await origineDe(e2)).toBeNull();
    expect(await enVigueur([a0, e1, e2, e3])).toEqual([e1]);
    expect(await lignesDeLaFerme([a0, e1, e2, e3])).toEqual([e1]);
  });

  it('c. témoin : pg_sleep AVANT la ligne de e2, la session 1 valide pendant l’attente : 23503, ou origine a0 et la vue juste ; jamais origine e1', async () => {
    const { a0, d2 } = await chaine();
    const e1 = randomUUID();
    const e2 = randomUUID();
    await s1.query('BEGIN');
    await s1.query(`INSERT INTO evenement ${COLONNES} VALUES ($1, $2, 'recolte', '2026-10-01', '2026-10-01T06:00:00Z', $3, 'tap', $4, 'correction', $5)`, [
      e1,
      ferme,
      auteur,
      DETAIL,
      d2,
    ]);
    const insertion = s2.query(
      `INSERT INTO evenement ${COLONNES}
       SELECT $1::uuid, $2::uuid, 'recolte', '2026-10-01', '2026-10-01T07:00:00Z', $3::uuid, 'tap', $4::jsonb, 'correction', $5::uuid
       FROM (SELECT pg_sleep(0.6)) attente`,
      [e2, ferme, auteur, DETAIL, e1],
    );
    const erreur = erreurDe(insertion);
    await pause(200);
    await s1.query('COMMIT');
    const e = await erreur;

    expect(await origineDe(e1)).toBe(a0);
    if (e === null) {
      expect(await origineDe(e2)).toBe(a0);
      expect(await enVigueur([a0, e1, e2])).toEqual([e2]);
      expect(await lignesDeLaFerme([a0, e1, e2])).toEqual([e2]);
    } else {
      expect(e.code).toBe('23503');
      expect(await origineDe(e2)).toBeNull();
      expect(await enVigueur([a0, e1, e2])).toEqual([e1]);
    }
  });
});

/**
 * Tests d'acceptation T28a, relecture B1 — « une zone abritée n'a pas de contour », sous
 * écritures concurrentes (deux connexions, sur le modèle de en-vigueur-concurrence).
 *
 * Règle (Q31, migration 0028) : jamais, une fois tout validé, une zone avec un contour ET un
 * bâtiment non supprimé qui l'abrite. Les deux ordres :
 *   A. la session 1 donne un contour à la zone, sans valider ; la session 2 rattache un bâtiment
 *      à cette zone ; la session 1 valide ;
 *   B. la session 1 rattache un bâtiment à la zone, sans valider ; la session 2 donne un contour
 *      à la zone ; la session 1 valide.
 * Attendu : l'une des deux écritures est refusée en check_violation (23514), l'autre passe ;
 * l'état final respecte la règle. Une écriture qui attend le verrou de l'autre est permise.
 *
 * Même exécution que les autres tests d'intégration : DATABASE_URL, sinon sauté en local.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appliquerMigrations } from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const CONTOUR = JSON.stringify([
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
]);

decrireAvecBase('T28a, B1 : zone abritée sans contour, deux connexions', { timeout: 60_000 }, () => {
  const nom = `t28a_b1_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let admin: pg.Client;
  let s1: pg.Client;
  let s2: pg.Client;
  const ferme = randomUUID();

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
  }, 120_000);

  afterAll(async () => {
    await s1.query('ROLLBACK').catch(() => undefined);
    await s1.end();
    await s2.end();
    await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    await admin.end();
  });

  async function zone(): Promise<string> {
    const id = randomUUID();
    await s1.query(`INSERT INTO zone (id, ferme_id, nom, type_abri) VALUES ($1, $2, $3, 'tunnel')`, [id, ferme, `M${id.slice(0, 4)}`]);
    return id;
  }

  const insererBatiment = (c: pg.Client, zoneId: string) =>
    c.query(
      `INSERT INTO batiment (id, ferme_id, nom, type, longueur_m, largeur_m, hauteur_m, centre_x_m, centre_y_m, orientation_deg, zone_id)
       VALUES ($1, $2, 'Serre M3', 'serre_tunnel', 40, 8, 3.5, 50, 30, 90, $3)`,
      [randomUUID(), ferme, zoneId],
    );

  const poserContour = (c: pg.Client, zoneId: string) => c.query(`UPDATE zone SET contour = $2::jsonb WHERE id = $1`, [zoneId, CONTOUR]);

  /** Code SQLSTATE de l'erreur de `p`, ou null si la requête a réussi. */
  async function codeDe(p: Promise<unknown>): Promise<string | null> {
    try {
      await p;
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? 'sans code';
    }
  }

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** État validé : la zone a-t-elle un contour, et combien de bâtiments actifs l'abritent ? */
  async function etat(zoneId: string): Promise<{ contour: boolean; batiments: number }> {
    const r = await s1.query<{ contour: boolean; batiments: number }>(
      `SELECT (z.contour IS NOT NULL) AS contour,
              (SELECT count(*)::int FROM batiment b WHERE b.zone_id = z.id AND b.supprime_le IS NULL) AS batiments
       FROM zone z WHERE z.id = $1`,
      [zoneId],
    );
    const l = r.rows[0];
    if (l === undefined) throw new Error('zone introuvable');
    return l;
  }

  /**
   * La session 1 fait `premiere` dans une transaction non validée, la session 2 lance `seconde`
   * (qui peut attendre un verrou), puis la session 1 valide. Rend les codes d'erreur.
   */
  async function croiser(premiere: (c: pg.Client) => Promise<unknown>, seconde: (c: pg.Client) => Promise<unknown>): Promise<{ s1: string | null; s2: string | null }> {
    await s1.query('BEGIN');
    const c1 = await codeDe(premiere(s1));
    const enCours = codeDe(seconde(s2));
    await pause(300);
    const commit = await codeDe(s1.query(c1 === null ? 'COMMIT' : 'ROLLBACK'));
    const c2 = await enCours;
    return { s1: c1 ?? commit, s2: c2 };
  }

  it('A. contour posé (non validé), puis bâtiment rattaché : l’un des deux refusé (23514), jamais les deux', async () => {
    const z = await zone();
    const codes = await croiser(
      (c) => poserContour(c, z),
      (c) => insererBatiment(c, z),
    );
    const final = await etat(z);
    expect(final.contour && final.batiments > 0, `zone avec contour ET bâtiment actif (codes ${JSON.stringify(codes)})`).toBe(false);
    expect([codes.s1, codes.s2].filter((c) => c !== null), `codes ${JSON.stringify(codes)}`).toEqual(['23514']);
  });

  it('B. bâtiment rattaché (non validé), puis contour posé : l’un des deux refusé (23514), jamais les deux', async () => {
    const z = await zone();
    const codes = await croiser(
      (c) => insererBatiment(c, z),
      (c) => poserContour(c, z),
    );
    const final = await etat(z);
    expect(final.contour && final.batiments > 0, `zone avec contour ET bâtiment actif (codes ${JSON.stringify(codes)})`).toBe(false);
    expect([codes.s1, codes.s2].filter((c) => c !== null), `codes ${JSON.stringify(codes)}`).toEqual(['23514']);
  });

  it('témoin, sans concurrence : les deux ordres sont refusés quand la première écriture est validée', async () => {
    const z1 = await zone();
    await poserContour(s1, z1);
    expect(await codeDe(insererBatiment(s2, z1))).toBe('23514');
    const z2 = await zone();
    await insererBatiment(s1, z2);
    expect(await codeDe(poserContour(s2, z2))).toBe('23514');
  });
});

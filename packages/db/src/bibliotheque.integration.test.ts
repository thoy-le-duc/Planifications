/**
 * Tests d'acceptation T41 — la bibliothèque commune de départ en base (PostgreSQL) : la migration
 * de données `0032_bibliotheque_depart` insère familles, espèces et itinéraires de
 * `packages/db/bibliotheque/depart.json` à `ferme_id` nul, avec des identifiants fixes ; rejouée,
 * elle n'ajoute rien et ne réécrit rien ; une ferme qui a déjà ses propres lignes n'est pas
 * touchée. API du module : ./bibliotheque.test.ts.
 *
 * Exécution comme type-intervention.integration.test.ts : DATABASE_URL (Postgres avec CREATEDB) ;
 * sans elle, sautés en local (l'échec clair en CI est porté par schema.integration.test.ts).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validerItineraire } from '@planif/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const FERME_TEST = '0192f0c1-4141-7000-8000-000000000001';

function urlDe(base: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${base}`;
  return url.toString();
}

type Ligne = Record<string, unknown>;

/** Le SQL de la migration, instruction par instruction (comme drizzle le découpe). */
function instructionsDeLaMigration(): string[] {
  const sql = readFileSync(new URL(`../migrations/${db.MIGRATION_BIBLIOTHEQUE_DEPART}.sql`, import.meta.url), 'utf8');
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/^\s*--.*$/gm, '').trim() !== '');
}

decrireAvecBase('T41 : bibliothèque de départ en base (PostgreSQL)', { timeout: 60_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t41_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const attendu = db.convertirBibliotheque(db.lireBibliothequeDepart());

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    await db.appliquerMigrations(urlDe(base));
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  /** Lignes de la bibliothèque (ferme_id nul) d'une table, au format to_jsonb, triées par id. */
  async function bibliotheque(table: 'famille' | 'espece' | 'itineraire'): Promise<Ligne[]> {
    const r = await c.query<{ l: Ligne }>(`SELECT to_jsonb(t) AS l FROM ${table} t WHERE ferme_id IS NULL ORDER BY id`);
    return r.rows.map((x) => x.l);
  }

  async function toutes(): Promise<Record<string, Ligne[]>> {
    return { famille: await bibliotheque('famille'), espece: await bibliotheque('espece'), itineraire: await bibliotheque('itineraire') };
  }

  /** Sans horodatages : ce que la conversion décide. */
  const sansHorodatages = (l: Ligne): Ligne => {
    expect(l.supprime_le, 'jamais supprimée').toBeNull();
    return Object.fromEntries(Object.entries(l).filter(([c]) => !['cree_le', 'modifie_le', 'supprime_le'].includes(c)));
  };

  const trier = <T extends { id: string }>(l: readonly T[]): T[] => [...l].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  it('après les migrations : 10 familles, 35 espèces, 46 itinéraires à ferme_id nul, exactement ceux de la conversion', async () => {
    const lues = await toutes();
    expect(lues.famille?.map(sansHorodatages)).toEqual(trier(attendu.familles));
    expect(lues.espece?.map(sansHorodatages)).toEqual(trier(attendu.especes));
    expect(lues.itineraire?.map(sansHorodatages)).toEqual(trier(attendu.itineraires));
    expect(lues.famille).toHaveLength(10);
    expect(lues.espece).toHaveLength(35);
    expect(lues.itineraire).toHaveLength(46);
  });

  it('chaque itinéraire lu en base passe validerItineraire (paramètres jsonb relus sans perte)', async () => {
    for (const l of await bibliotheque('itineraire')) {
      const r = validerItineraire({ ...l, ferme_id: FERME_TEST });
      expect(r.ok ? null : r.erreur, `itinéraire ${String(l.nom)}`).toBeNull();
      if (r.ok) expect(r.valeur.parametres).toEqual(l.parametres);
    }
  });

  it('rejouer les migrations (base à jour) : rien ne change', async () => {
    const avant = await toutes();
    await db.appliquerMigrations(urlDe(base));
    expect(await toutes()).toEqual(avant);
  });

  it('rejouer le SQL de la migration deux fois : mêmes lignes, aucun doublon, horodatages inchangés', async () => {
    const avant = await toutes();
    for (let k = 0; k < 2; k++) for (const s of instructionsDeLaMigration()) await c.query(s);
    expect(await toutes()).toEqual(avant);
  });

  it('une ferme qui a déjà ses propres lignes (mêmes noms) : rien ne change pour elle, ses lignes ne sont pas comptées dans la bibliothèque', async () => {
    const ferme = randomUUID();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T41', 'Europe/Paris')`, [ferme]);
    const famille = randomUUID();
    const espece = randomUUID();
    const itineraire = randomUUID();
    await c.query(`INSERT INTO famille (id, ferme_id, nom, delai_retour_minimal_ans, delai_retour_conseille_ans) VALUES ($1, $2, 'Solanacées', 4, 5)`, [famille, ferme]);
    await c.query(
      `INSERT INTO espece (id, ferme_id, famille_id, nom, categorie, perenne, unite_recolte) VALUES ($1, $2, $3, 'tomate', 'legume', false, 'kg')`,
      [espece, ferme, famille],
    );
    const tomate = attendu.itineraires.find((i) => i.nom === 'Tomate sous serre, plant greffé deux têtes');
    await c.query(`INSERT INTO itineraire (id, ferme_id, espece_id, nom, mode, parametres) VALUES ($1, $2, $3, 'Tomate de la ferme', 'plant_achete', $4)`, [
      itineraire,
      ferme,
      espece,
      JSON.stringify(tomate?.parametres),
    ]);
    const deLaFerme = async (): Promise<Ligne[]> => {
      const r = await c.query<{ l: Ligne }>(
        `SELECT to_jsonb(t) AS l FROM (
           SELECT 'famille' AS t, id, nom, NULL::jsonb AS p, modifie_le FROM famille WHERE ferme_id = $1
           UNION ALL SELECT 'espece', id, nom, NULL, modifie_le FROM espece WHERE ferme_id = $1
           UNION ALL SELECT 'itineraire', id, nom, parametres, modifie_le FROM itineraire WHERE ferme_id = $1) t ORDER BY id`,
        [ferme],
      );
      return r.rows.map((x) => x.l);
    };
    const avant = await deLaFerme();
    const bibliothequeAvant = await toutes();
    for (const s of instructionsDeLaMigration()) await c.query(s);
    expect(await deLaFerme()).toEqual(avant);
    expect(await toutes()).toEqual(bibliothequeAvant);
  });
});

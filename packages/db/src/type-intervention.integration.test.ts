/**
 * Tests d'acceptation T23 — la table des types d'intervention de la ferme (PostgreSQL).
 *
 * Constat de T22 : la liste des types d'intervention n'existait pas en base, le type était un
 * libellé libre. T23 crée la table `type_intervention` (docs/modele-donnees.md, section 5) :
 *
 *   id           uuid, clé primaire (UUID v7 du téléphone)
 *   ferme_id     uuid NULLABLE, clé étrangère vers ferme : nul = liste de départ (bibliothèque
 *                commune, en lecture seule, comme famille, espece, variete, itineraire)
 *   categorie    text NOT NULL, CHECK parmi les CategorieIntervention de T01
 *   libelle      text NOT NULL : le texte recopié dans TravailPrevu.type et DetailIntervention.type
 *   masque       boolean NOT NULL DEFAULT false : un type déjà utilisé ne se supprime pas, il se
 *                masque (il disparaît des listes de choix, les travaux qui l'utilisent restent)
 *   cree_le, modifie_le (timestamptz NOT NULL), supprime_le (timestamptz, suppression douce)
 *
 * - Table déclarée dans le schéma Drizzle (`typeIntervention`, exportée par @planif/db) et
 *   créée par une migration GÉNÉRÉE par drizzle-kit (le dernier instantané de migrations/meta
 *   la connaît) ; elle entre dans la publication « powersync » (schema.integration.test.ts
 *   vérifie déjà que toute table publique y est).
 * - Liste de départ : une migration insère une ligne à ferme_id nul par couple (catégorie,
 *   libellé) de TYPES_INTERVENTION_PAR_DEFAUT (@planif/core), ni masquée ni supprimée ;
 *   rejouer les migrations n'en crée pas de doublon.
 * - L'historique connaît la table : modification.nom_table accepte 'TypeIntervention'.
 *
 * Exécution comme travaux.integration.test.ts : DATABASE_URL (Postgres avec CREATEDB) ; sans
 * elle, sautés en local (l'échec clair en CI est porté par schema.integration.test.ts).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { TYPES_INTERVENTION_PAR_DEFAUT } from '@planif/core';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const VIOLATION_CHECK = '23514';
const VIOLATION_CLE_ETRANGERE = '23503';
const VIOLATION_NON_NUL = '23502';

const CATEGORIES = ['travail_sol', 'couverture', 'fertilisation', 'amendement', 'entretien'];

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
  throw new Error('la base a accepté la ligne : une contrainte était attendue (T23)');
}

/** La liste de départ, à plat, triée. */
function listeDeDepart(): { categorie: string; libelle: string }[] {
  return Object.entries(TYPES_INTERVENTION_PAR_DEFAUT)
    .flatMap(([categorie, libelles]) => (libelles as readonly string[]).map((libelle) => ({ categorie, libelle })))
    .sort((a, b) => `${a.categorie}|${a.libelle}`.localeCompare(`${b.categorie}|${b.libelle}`));
}

describe('T23 : type_intervention dans le schéma Drizzle et la migration générée', () => {
  it('@planif/db déclare la table type_intervention', () => {
    const tables = (Object.values(db) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));
    const table = tables.find((t) => t.name === 'type_intervention');
    expect(table, 'table Drizzle type_intervention exportée par @planif/db').toBeDefined();
    expect(table?.columns.map((c) => c.name).sort()).toEqual(['categorie', 'cree_le', 'ferme_id', 'id', 'libelle', 'masque', 'modifie_le', 'supprime_le']);
  });

  it('le dernier instantané de drizzle-kit connaît la table : la migration est générée, pas écrite à la main', () => {
    const meta = new URL('../migrations/meta/', import.meta.url);
    const journal = JSON.parse(readFileSync(new URL('_journal.json', meta), 'utf8')) as { entries: { idx: number }[] };
    const dernier = journal.entries.at(-1)?.idx ?? -1;
    const nom = `${String(dernier).padStart(4, '0')}_snapshot.json`;
    const instantane = JSON.parse(readFileSync(new URL(nom, meta), 'utf8')) as { tables: Record<string, { columns: Record<string, unknown> }> };
    const table = instantane.tables['public.type_intervention'];
    expect(table, `public.type_intervention dans ${nom}`).toBeDefined();
    expect(Object.keys(table?.columns ?? {}).sort()).toEqual(['categorie', 'cree_le', 'ferme_id', 'id', 'libelle', 'masque', 'modifie_le', 'supprime_le']);
  });
});

decrireAvecBase('T23 : table type_intervention (PostgreSQL)', { timeout: 30_000 }, () => {
  let admin: pg.Client;
  let c: pg.Client;
  const base = `t23_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const ferme = randomUUID();
  const utilisateur = randomUUID();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${base}`);
    await db.appliquerMigrations(urlDe(base));
    c = new pg.Client({ connectionString: urlDe(base) });
    await c.connect();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, 'Ferme T23', 'Europe/Paris')`, [ferme]);
    await c.query(`INSERT INTO utilisateur (id, email, nom) VALUES ($1, $2, 'Théophane')`, [utilisateur, `t23-${utilisateur}@ferme.fr`]);
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${base} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  async function inserer(colonnes: { ferme_id?: string | null; categorie?: string | null; libelle?: string | null; masque?: boolean }): Promise<string> {
    const id = randomUUID();
    const l = { ferme_id: ferme, categorie: 'entretien', libelle: 'binage', ...colonnes };
    if (l.masque === undefined) {
      await c.query(`INSERT INTO type_intervention (id, ferme_id, categorie, libelle) VALUES ($1, $2, $3, $4)`, [id, l.ferme_id, l.categorie, l.libelle]);
    } else {
      await c.query(`INSERT INTO type_intervention (id, ferme_id, categorie, libelle, masque) VALUES ($1, $2, $3, $4, $5)`, [
        id,
        l.ferme_id,
        l.categorie,
        l.libelle,
        l.masque,
      ]);
    }
    return id;
  }

  it('colonnes et types', async () => {
    const r = await c.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name::text, data_type::text, is_nullable::text, column_default::text FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'type_intervention' ORDER BY column_name`,
    );
    const colonnes = Object.fromEntries(r.rows.map((l) => [l.column_name, { type: l.data_type, nul: l.is_nullable === 'YES' }]));
    expect(colonnes).toEqual({
      categorie: { type: 'text', nul: false },
      cree_le: { type: 'timestamp with time zone', nul: false },
      ferme_id: { type: 'uuid', nul: true },
      id: { type: 'uuid', nul: false },
      libelle: { type: 'text', nul: false },
      masque: { type: 'boolean', nul: false },
      modifie_le: { type: 'timestamp with time zone', nul: false },
      supprime_le: { type: 'timestamp with time zone', nul: true },
    });
    expect(r.rows.find((l) => l.column_name === 'masque')?.column_default).toBe('false');
  });

  it('un type de la ferme s’insère, non masqué par défaut', async () => {
    const id = await inserer({});
    const r = await c.query<{ masque: boolean; supprime_le: string | null }>(`SELECT masque, supprime_le FROM type_intervention WHERE id = $1`, [id]);
    expect(r.rows).toEqual([{ masque: false, supprime_le: null }]);
  });

  it.each(CATEGORIES)('catégorie %s : acceptée', async (categorie) => {
    await inserer({ categorie, libelle: `essai ${categorie}` });
  });

  it('catégorie inconnue : refusée (CHECK)', async () => {
    expect(await codeErreur(inserer({ categorie: 'recolte' }))).toBe(VIOLATION_CHECK);
  });

  it('libellé ou catégorie manquants : refusés', async () => {
    expect(await codeErreur(inserer({ libelle: null }))).toBe(VIOLATION_NON_NUL);
    expect(await codeErreur(inserer({ categorie: null }))).toBe(VIOLATION_NON_NUL);
  });

  it('ferme inexistante : refusée (clé étrangère)', async () => {
    expect(await codeErreur(inserer({ ferme_id: randomUUID() }))).toBe(VIOLATION_CLE_ETRANGERE);
  });

  describe('liste de départ', () => {
    it('une ligne à ferme_id nul par type de TYPES_INTERVENTION_PAR_DEFAUT, ni masquée ni supprimée', async () => {
      const r = await c.query<{ categorie: string; libelle: string; masque: boolean; supprime_le: string | null }>(
        `SELECT categorie, libelle, masque, supprime_le FROM type_intervention WHERE ferme_id IS NULL ORDER BY categorie, libelle`,
      );
      const lignes = r.rows.map((l) => ({ categorie: l.categorie, libelle: l.libelle })).sort((a, b) => `${a.categorie}|${a.libelle}`.localeCompare(`${b.categorie}|${b.libelle}`));
      expect(lignes).toEqual(listeDeDepart());
      expect(r.rows.every((l) => !l.masque && l.supprime_le === null)).toBe(true);
    });

    it('rejouer les migrations ne crée aucun doublon', async () => {
      await db.appliquerMigrations(urlDe(base));
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM type_intervention WHERE ferme_id IS NULL`);
      expect(r.rows[0]?.n).toBe(listeDeDepart().length);
    });
  });

  it('la table est dans la publication « powersync » (elle descend sur les téléphones)', async () => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'powersync' AND schemaname = 'public' AND tablename = 'type_intervention'`,
    );
    expect(r.rows[0]?.n).toBe(1);
  });

  it('l’historique accepte nom_table = TypeIntervention', async () => {
    const id = await inserer({ libelle: 'buttage tardif' });
    await c.query(
      `INSERT INTO modification (id, ferme_id, nom_table, ligne_id, auteur_id, horodatage, operation, avant, apres, cree_le, modifie_le)
       VALUES ($1, $2, 'TypeIntervention', $3, $4, now(), 'creation', NULL, '{}'::jsonb, now(), now())`,
      [randomUUID(), ferme, id, utilisateur],
    );
  });
});

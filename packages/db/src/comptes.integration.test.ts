/**
 * Tests d'acceptation T09 — comptes : tables `utilisateur`, `membre`, `code_connexion`,
 * `jeton_renouvellement`, contre un vrai Postgres (16 ou plus ; 17 en CI).
 *
 * Même exécution que schema.integration.test.ts : DATABASE_URL, sinon test sauté en local
 * (l'échec clair en CI sans base est porté par schema.integration.test.ts).
 *
 * ── Tables attendues (schéma public, migration versionnée) ──────────────────────────────────
 *
 * utilisateur            id uuid PK ; email text NOT NULL UNIQUE, toujours en minuscules
 *                        (CHECK email = lower(email) : l'API normalise, la base refuse le reste,
 *                        23514) ; nom text nullable ; cree_le, modifie_le, supprime_le.
 *                        Pas de mot de passe (Q9). Publiée vers PowerSync (nom de l'auteur
 *                        d'une saisie), filtrée par les règles de synchro de T10.
 * membre                 id uuid PK ; utilisateur_id → utilisateur, ferme_id → ferme (NOT NULL,
 *                        sans cascade) ; role text NOT NULL, CHECK in ('gerant', 'equipier') ;
 *                        cree_le, modifie_le, supprime_le ; UNIQUE (utilisateur_id, ferme_id).
 *                        Un membre retiré l'est en douceur (supprime_le) : il perd l'accès.
 *                        Publiée : les règles de synchro PowerSync (T10) la lisent.
 * code_connexion         Choix T09 : les codes à usage unique vivent en base (plusieurs
 *                        processus d'API, redémarrage sans perte, limite de fréquence calculée
 *                        sur ces lignes). id uuid PK ; email text NOT NULL (pas de clé vers
 *                        utilisateur : un code peut précéder la création du compte) ;
 *                        code_hache text NOT NULL (jamais le code en clair) ; expire_le
 *                        timestamptz NOT NULL ; tentatives integer NOT NULL DEFAULT 0, CHECK >= 0 ;
 *                        utilise_le timestamptz nullable ; cree_le. NON publiée.
 * jeton_renouvellement   Jetons de renouvellement (longs, opaques), stockés hachés : révocables
 *                        (téléphone perdu). id uuid PK ; utilisateur_id → utilisateur ;
 *                        jeton_hache text NOT NULL UNIQUE ; expire_le timestamptz NOT NULL ;
 *                        revoque_le timestamptz nullable ; cree_le. NON publiée.
 *
 * Clés étrangères promises par T08 (README, écart n° 1) : evenement.auteur_id,
 * proposition.auteur_id et modification.auteur_id → utilisateur(id), sans cascade.
 *
 * Aucune donnée d'authentification dans la publication `powersync` : ni code_connexion, ni
 * jeton_renouvellement, ni aucune colonne dont le nom évoque un secret (hache, secret, jeton,
 * cle_publique, credential). La clé d'accès (WebAuthn) est reportée : pas de table dans T09.
 *
 * ── API attendue de @planif/db (en plus de T08) ─────────────────────────────────────────────
 *
 * Tables Drizzle exportées : utilisateur, membre, codeConnexion, jetonRenouvellement (clé
 * camelCase ↔ colonne snake_case, comme T08).
 *
 * ROLES_MEMBRE: readonly ['gerant', 'equipier'] ; type RoleMembre.
 *
 * fermesDeLUtilisateur(db, utilisateurId): Promise<Id<'Ferme'>[]>
 *   Fermes dont l'utilisateur est membre actif (membre.supprime_le nul, ferme.supprime_le nul),
 *   triées par id. C'est la règle de découpage que reprendront les règles de synchro
 *   PowerSync (T10) et que l'API applique à chaque requête. `db` est ce que rend
 *   `drizzle(client)` de drizzle-orm/node-postgres (client ou pool pg, sans schéma).
 *
 * roleDansLaFerme(db, utilisateurId, fermeId): Promise<RoleMembre | null>
 *   Rôle du membre actif, ou null s'il n'est pas membre (ou plus).
 *
 * Membre actif (relecture sécurité) : membre.supprime_le nul, ferme.supprime_le nul,
 * utilisateur.supprime_le nul, et membre accepté (pas seulement invité, voir les tests de l'API).
 * Une ligne `membre` insérée sans préciser l'état d'invitation est un membre accepté (les tests
 * ci-dessus insèrent directement).
 */
import { randomUUID } from 'node:crypto';
import type { Id } from '@planif/core';
import { getTableColumns, is, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const TABLES_COMPTES = ['utilisateur', 'membre', 'code_connexion', 'jeton_renouvellement'] as const;
/** Données d'authentification : jamais répliquées vers les téléphones. */
const TABLES_AUTHENTIFICATION = ['code_connexion', 'jeton_renouvellement'] as const;

const VIOLATION_CHECK = '23514';
const VIOLATION_CLE_ETRANGERE = '23503';
const VIOLATION_NOT_NULL = '23502';
const VIOLATION_UNICITE = '23505';

function camel(nom: string): string {
  return nom.replace(/_([a-z0-9])/g, (_m, lettre: string) => lettre.toUpperCase());
}

function snake(cle: string): string {
  return cle.replace(/[A-Z]/g, (lettre) => `_${lettre.toLowerCase()}`);
}

async function codeErreur(requete: Promise<unknown>): Promise<string> {
  try {
    await requete;
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') {
      return e.code;
    }
    throw e;
  }
  throw new Error('la requête aurait dû être refusée par la base');
}

decrireAvecBase('T09 : comptes, membres et codes de connexion', { timeout: 30_000 }, () => {
  const nom = `t09_comptes_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let admin: pg.Client;
  let c: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nom}`);
    const url = new URL(URL_BASE);
    url.pathname = `/${nom}`;
    await db.appliquerMigrations(url.toString());
    c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
  }, 120_000);

  afterAll(async () => {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
    await admin.end();
  });

  async function creerFerme(nomFerme = 'Ferme'): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, $2, 'Europe/Paris')`, [id, nomFerme]);
    return id;
  }

  async function creerUtilisateur(email = `u-${randomUUID()}@ferme.fr`): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO utilisateur (id, email) VALUES ($1, $2)`, [id, email]);
    return id;
  }

  async function ajouterMembre(utilisateurId: string, fermeId: string, role: string): Promise<string> {
    const id = randomUUID();
    await c.query(`INSERT INTO membre (id, utilisateur_id, ferme_id, role) VALUES ($1, $2, $3, $4)`, [
      id,
      utilisateurId,
      fermeId,
      role,
    ]);
    return id;
  }

  // --- Tables et colonnes ---------------------------------------------------------------------

  describe('tables', () => {
    it('les quatre tables de comptes existent, et correspondent aux tables Drizzle exportées', async () => {
      const r = await c.query<{ table_name: string; column_name: string }>(
        `SELECT table_name::text, column_name::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [[...TABLES_COMPTES]],
      );
      const exports = db as Record<string, unknown>;
      for (const t of TABLES_COMPTES) {
        const tableDrizzle = exports[camel(t)];
        if (!is(tableDrizzle, Table)) {
          throw new Error(`@planif/db doit exporter la table Drizzle ${camel(t)}`);
        }
        const attendues = Object.keys(getTableColumns(tableDrizzle)).map(snake).sort();
        const reelles = r.rows
          .filter((l) => l.table_name === t)
          .map((l) => l.column_name)
          .sort();
        expect(reelles, `colonnes de ${t}`).toEqual(attendues);
      }
    });

    it('colonnes attendues, et aucun mot de passe (Q9)', async () => {
      const r = await c.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
        `SELECT table_name::text, column_name::text, data_type::text, is_nullable::text
         FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [[...TABLES_COMPTES]],
      );
      const col = (t: string, n: string) => r.rows.find((l) => l.table_name === t && l.column_name === n);
      const attendues: readonly (readonly [string, string, string, 'YES' | 'NO'])[] = [
        ['utilisateur', 'id', 'uuid', 'NO'],
        ['utilisateur', 'email', 'text', 'NO'],
        ['utilisateur', 'cree_le', 'timestamp with time zone', 'NO'],
        ['utilisateur', 'modifie_le', 'timestamp with time zone', 'NO'],
        ['utilisateur', 'supprime_le', 'timestamp with time zone', 'YES'],
        ['membre', 'id', 'uuid', 'NO'],
        ['membre', 'utilisateur_id', 'uuid', 'NO'],
        ['membre', 'ferme_id', 'uuid', 'NO'],
        ['membre', 'role', 'text', 'NO'],
        ['membre', 'cree_le', 'timestamp with time zone', 'NO'],
        ['membre', 'modifie_le', 'timestamp with time zone', 'NO'],
        ['membre', 'supprime_le', 'timestamp with time zone', 'YES'],
        ['code_connexion', 'id', 'uuid', 'NO'],
        ['code_connexion', 'email', 'text', 'NO'],
        ['code_connexion', 'code_hache', 'text', 'NO'],
        ['code_connexion', 'expire_le', 'timestamp with time zone', 'NO'],
        ['code_connexion', 'tentatives', 'integer', 'NO'],
        ['code_connexion', 'utilise_le', 'timestamp with time zone', 'YES'],
        ['code_connexion', 'cree_le', 'timestamp with time zone', 'NO'],
        ['jeton_renouvellement', 'id', 'uuid', 'NO'],
        ['jeton_renouvellement', 'utilisateur_id', 'uuid', 'NO'],
        ['jeton_renouvellement', 'jeton_hache', 'text', 'NO'],
        ['jeton_renouvellement', 'expire_le', 'timestamp with time zone', 'NO'],
        ['jeton_renouvellement', 'revoque_le', 'timestamp with time zone', 'YES'],
        ['jeton_renouvellement', 'cree_le', 'timestamp with time zone', 'NO'],
      ];
      for (const [t, n, type, nul] of attendues) {
        expect(col(t, n)?.data_type, `${t}.${n}`).toBe(type);
        expect(col(t, n)?.is_nullable, `${t}.${n} nullable`).toBe(nul);
      }
      for (const l of r.rows) {
        expect(l.column_name, `${l.table_name}.${l.column_name} : pas de mot de passe`).not.toMatch(
          /mot_de_passe|password|mdp/,
        );
      }
    });
  });

  // --- utilisateur ----------------------------------------------------------------------------

  describe('utilisateur', () => {
    it('e-mail unique', async () => {
      await creerUtilisateur('theophane@ferme.fr');
      expect(await codeErreur(creerUtilisateur('theophane@ferme.fr'))).toBe(VIOLATION_UNICITE);
    });

    it('e-mail stocké en minuscules : une majuscule est refusée par la base', async () => {
      expect(await codeErreur(creerUtilisateur('Saisonnier@Ferme.fr'))).toBe(VIOLATION_CHECK);
      await creerUtilisateur('saisonnier@ferme.fr');
      // Même adresse, autre casse : ni doublon, ni contournement de l'unicité.
      expect([VIOLATION_CHECK, VIOLATION_UNICITE]).toContain(await codeErreur(creerUtilisateur('SAISONNIER@ferme.fr')));
    });

    it('e-mail obligatoire', async () => {
      expect(await codeErreur(c.query(`INSERT INTO utilisateur (id, email) VALUES ($1, NULL)`, [randomUUID()]))).toBe(
        VIOLATION_NOT_NULL,
      );
    });
  });

  // --- membre ---------------------------------------------------------------------------------

  describe('membre', () => {
    it('rôle gerant ou equipier, rien d’autre', async () => {
      const ferme = await creerFerme();
      await ajouterMembre(await creerUtilisateur(), ferme, 'gerant');
      await ajouterMembre(await creerUtilisateur(), ferme, 'equipier');
      expect(await codeErreur(ajouterMembre(await creerUtilisateur(), ferme, 'admin'))).toBe(VIOLATION_CHECK);
      expect(
        await codeErreur(
          c.query(`INSERT INTO membre (id, utilisateur_id, ferme_id, role) VALUES ($1, $2, $3, NULL)`, [
            randomUUID(),
            await creerUtilisateur(),
            ferme,
          ]),
        ),
      ).toBe(VIOLATION_NOT_NULL);
    });

    it('unique par couple (utilisateur, ferme) ; un utilisateur peut être membre de plusieurs fermes', async () => {
      const u = await creerUtilisateur();
      const f1 = await creerFerme();
      const f2 = await creerFerme();
      await ajouterMembre(u, f1, 'gerant');
      await ajouterMembre(u, f2, 'equipier');
      expect(await codeErreur(ajouterMembre(u, f1, 'equipier'))).toBe(VIOLATION_UNICITE);
    });

    it('clés étrangères vers utilisateur et ferme, sans cascade', async () => {
      const u = await creerUtilisateur();
      const f = await creerFerme();
      expect(await codeErreur(ajouterMembre(randomUUID(), f, 'gerant'))).toBe(VIOLATION_CLE_ETRANGERE);
      expect(await codeErreur(ajouterMembre(u, randomUUID(), 'gerant'))).toBe(VIOLATION_CLE_ETRANGERE);

      await ajouterMembre(u, f, 'gerant');
      // Supprimer physiquement un utilisateur ou une ferme qui a des membres échoue.
      expect(await codeErreur(c.query(`DELETE FROM utilisateur WHERE id = $1`, [u]))).toBe(VIOLATION_CLE_ETRANGERE);
      expect(await codeErreur(c.query(`DELETE FROM ferme WHERE id = $1`, [f]))).toBe(VIOLATION_CLE_ETRANGERE);

      const fk = await c.query<{ colonne: string; cible: string; suppression: string }>(
        `SELECT a.attname::text AS colonne, cf.relname::text AS cible, k.confdeltype::text AS suppression
         FROM pg_constraint k
         JOIN pg_class cl ON cl.oid = k.conrelid
         JOIN pg_class cf ON cf.oid = k.confrelid
         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
         WHERE k.contype = 'f' AND cl.relname = 'membre'`,
      );
      expect(fk.rows).toEqual(
        expect.arrayContaining([
          { colonne: 'utilisateur_id', cible: 'utilisateur', suppression: 'a' },
          { colonne: 'ferme_id', cible: 'ferme', suppression: 'a' },
        ]),
      );
    });
  });

  // --- Auteurs (promis par T08) ---------------------------------------------------------------

  describe('auteurs', () => {
    it('evenement, proposition et modification : auteur_id → utilisateur, sans cascade', async () => {
      const fk = await c.query<{ source: string; suppression: string }>(
        `SELECT cl.relname::text AS source, k.confdeltype::text AS suppression
         FROM pg_constraint k
         JOIN pg_class cl ON cl.oid = k.conrelid
         JOIN pg_class cf ON cf.oid = k.confrelid
         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
         WHERE k.contype = 'f' AND a.attname = 'auteur_id' AND cf.relname = 'utilisateur'
         ORDER BY 1`,
      );
      expect(fk.rows).toEqual([
        { source: 'evenement', suppression: 'a' },
        { source: 'modification', suppression: 'a' },
        { source: 'proposition', suppression: 'a' },
      ]);
    });

    it('un événement d’un auteur connu passe, d’un auteur inconnu est refusé', async () => {
      const f = await creerFerme();
      const inserer = (auteur: string) =>
        c.query(
          `INSERT INTO evenement (id, ferme_id, type, date, horodatage, auteur_id, source, detail)
           VALUES ($1, $2, 'observation', '2027-05-26', now(), $3, 'tap', $4)`,
          [randomUUID(), f, auteur, JSON.stringify({ nature: 'autre', gravite: null })],
        );
      await inserer(await creerUtilisateur());
      expect(await codeErreur(inserer(randomUUID()))).toBe(VIOLATION_CLE_ETRANGERE);
    });
  });

  // --- code_connexion et jeton_renouvellement -------------------------------------------------

  describe('données d’authentification', () => {
    it('code_connexion : tentatives à 0 par défaut, jamais négatives', async () => {
      const id = randomUUID();
      await c.query(
        `INSERT INTO code_connexion (id, email, code_hache, expire_le) VALUES ($1, 'a@ferme.fr', 'h', now())`,
        [id],
      );
      const r = await c.query<{ tentatives: number }>(`SELECT tentatives FROM code_connexion WHERE id = $1`, [id]);
      expect(r.rows[0]?.tentatives).toBe(0);
      expect(
        await codeErreur(
          c.query(
            `INSERT INTO code_connexion (id, email, code_hache, expire_le, tentatives)
             VALUES ($1, 'a@ferme.fr', 'h', now(), -1)`,
            [randomUUID()],
          ),
        ),
      ).toBe(VIOLATION_CHECK);
    });

    it('jeton_renouvellement : rattaché à un utilisateur existant, haché unique', async () => {
      const u = await creerUtilisateur();
      const inserer = (utilisateurId: string, hache: string) =>
        c.query(
          `INSERT INTO jeton_renouvellement (id, utilisateur_id, jeton_hache, expire_le)
           VALUES ($1, $2, $3, now() + interval '90 days')`,
          [randomUUID(), utilisateurId, hache],
        );
      await inserer(u, 'hache-1');
      expect(await codeErreur(inserer(u, 'hache-1'))).toBe(VIOLATION_UNICITE);
      expect(await codeErreur(inserer(randomUUID(), 'hache-2'))).toBe(VIOLATION_CLE_ETRANGERE);
    });
  });

  // --- Publication PowerSync ------------------------------------------------------------------

  describe('publication PowerSync', () => {
    async function publiees(): Promise<string[]> {
      const r = await c.query<{ nom: string }>(
        `SELECT tablename::text AS nom FROM pg_publication_tables
         WHERE pubname = 'powersync' AND schemaname = 'public' ORDER BY 1`,
      );
      return r.rows.map((l) => l.nom);
    }

    it('utilisateur et membre sont publiés (règles de synchro de T10)', async () => {
      expect(await publiees()).toEqual(expect.arrayContaining(['utilisateur', 'membre']));
    });

    it('aucune donnée d’authentification n’est publiée', async () => {
      const tables = await publiees();
      for (const t of TABLES_AUTHENTIFICATION) {
        expect(tables, `${t} ne doit pas être publiée`).not.toContain(t);
      }
      const colonnes = await c.query<{ table_name: string; column_name: string }>(
        `SELECT table_name::text, column_name::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [tables],
      );
      for (const l of colonnes.rows) {
        expect(l.column_name, `${l.table_name}.${l.column_name} publiée`).not.toMatch(
          /hache|secret|jeton|cle_publique|credential|mot_de_passe/,
        );
      }
    });
  });

  // --- Règles de découpage ----------------------------------------------------------------------

  describe('fermesDeLUtilisateur et roleDansLaFerme', () => {
    it('ne renvoient que les fermes dont l’utilisateur est membre actif', async () => {
      const drizzleDb = drizzle(c);
      const theo = await creerUtilisateur();
      const voisin = await creerUtilisateur();
      const jardins = await creerFerme('Jardins de Garonne');
      const magasin = await creerFerme('Magasin');
      const fermeVoisine = await creerFerme('Ferme voisine');
      const ancienne = await creerFerme('Ancienne');
      await ajouterMembre(theo, jardins, 'gerant');
      await ajouterMembre(theo, magasin, 'equipier');
      await ajouterMembre(voisin, fermeVoisine, 'gerant');
      const retire = await ajouterMembre(theo, ancienne, 'equipier');
      await c.query(`UPDATE membre SET supprime_le = now() WHERE id = $1`, [retire]);

      const attendues = [jardins, magasin].sort();
      expect(await db.fermesDeLUtilisateur(drizzleDb, theo as Id<'Utilisateur'>)).toEqual(attendues);
      expect(await db.fermesDeLUtilisateur(drizzleDb, voisin as Id<'Utilisateur'>)).toEqual([fermeVoisine]);
      expect(await db.fermesDeLUtilisateur(drizzleDb, randomUUID() as Id<'Utilisateur'>)).toEqual([]);

      expect(await db.roleDansLaFerme(drizzleDb, theo as Id<'Utilisateur'>, jardins as Id<'Ferme'>)).toBe('gerant');
      expect(await db.roleDansLaFerme(drizzleDb, theo as Id<'Utilisateur'>, magasin as Id<'Ferme'>)).toBe('equipier');
      expect(await db.roleDansLaFerme(drizzleDb, theo as Id<'Utilisateur'>, fermeVoisine as Id<'Ferme'>)).toBeNull();
      expect(await db.roleDansLaFerme(drizzleDb, theo as Id<'Utilisateur'>, ancienne as Id<'Ferme'>)).toBeNull();
    });

    it('une ferme supprimée en douceur n’est plus renvoyée', async () => {
      const drizzleDb = drizzle(c);
      const u = await creerUtilisateur();
      const f = await creerFerme();
      await ajouterMembre(u, f, 'gerant');
      await c.query(`UPDATE ferme SET supprime_le = now() WHERE id = $1`, [f]);
      expect(await db.fermesDeLUtilisateur(drizzleDb, u as Id<'Utilisateur'>)).toEqual([]);
      expect(await db.roleDansLaFerme(drizzleDb, u as Id<'Utilisateur'>, f as Id<'Ferme'>)).toBeNull();
    });

    it('relecture sécurité : un utilisateur supprimé en douceur n’est membre actif de rien', async () => {
      const drizzleDb = drizzle(c);
      const u = await creerUtilisateur();
      const f = await creerFerme();
      await ajouterMembre(u, f, 'gerant');
      expect(await db.roleDansLaFerme(drizzleDb, u as Id<'Utilisateur'>, f as Id<'Ferme'>)).toBe('gerant');
      await c.query(`UPDATE utilisateur SET supprime_le = now() WHERE id = $1`, [u]);
      expect(await db.fermesDeLUtilisateur(drizzleDb, u as Id<'Utilisateur'>)).toEqual([]);
      expect(await db.roleDansLaFerme(drizzleDb, u as Id<'Utilisateur'>, f as Id<'Ferme'>)).toBeNull();
    });

    it('ROLES_MEMBRE', () => {
      expect(db.ROLES_MEMBRE).toEqual(['gerant', 'equipier']);
    });
  });
});

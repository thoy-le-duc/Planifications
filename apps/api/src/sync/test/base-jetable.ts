/**
 * Utilitaires des tests d'intégration de la synchro (T10) : base Postgres jetable, migrations
 * appliquées, et quelques lignes de départ (utilisateurs, fermes, membres).
 *
 * Comme T08 et T09 : DATABASE_URL désigne un Postgres où l'on peut créer des bases. Sans elle,
 * échec clair en CI, saut signalé en local.
 */
import { randomUUID } from 'node:crypto';
import { appliquerMigrations } from '@planif/db';
import pg from 'pg';
import { describe, it } from 'vitest';

export const URL_BASE = process.env.DATABASE_URL ?? '';
export const EN_CI = (process.env.CI ?? '') !== '' && process.env.CI !== 'false';

/** `describe`, ou `describe.skip` sans DATABASE_URL (avec un test qui échoue en CI). */
export function decrireAvecBase(ticket: string): typeof describe | typeof describe.skip {
  if (URL_BASE !== '') return describe;
  if (EN_CI) {
    describe(`${ticket} : base PostgreSQL`, () => {
      it('DATABASE_URL est définie en CI', () => {
        throw new Error(`DATABASE_URL absente en CI : les tests d’intégration de ${ticket} exigent le service Postgres.`);
      });
    });
  } else {
    console.warn(`[${ticket}] DATABASE_URL absente : tests d’intégration sautés.`);
  }
  return describe.skip;
}

export function urlDeLaBase(nom: string): string {
  const url = new URL(URL_BASE);
  url.pathname = `/${nom}`;
  return url.toString();
}

export function nomJetable(prefixe: string): string {
  return `${prefixe}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

/** Attend que plus aucune connexion n'utilise la base (pool.end() rend la main trop tôt). */
async function attendreDeconnexion(admin: pg.Client, nom: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const { rows } = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`, [nom]);
    if (rows[0]?.n === 0) return;
    await new Promise((fin) => setTimeout(fin, 100));
  }
}

export interface BaseJetable {
  readonly nom: string;
  readonly url: string;
  readonly pool: pg.Pool;
  supprimer(): Promise<void>;
}

/** Crée une base vide (`migrer` : migrations de @planif/db appliquées), et son pool. */
export async function creerBaseJetable(prefixe: string, migrer = true): Promise<BaseJetable> {
  const nom = nomJetable(prefixe);
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nom}`);
  await admin.end();
  const url = urlDeLaBase(nom);
  if (migrer) await appliquerMigrations(url);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return {
    nom,
    url,
    pool,
    async supprimer() {
      await pool.end();
      const a = new pg.Client({ connectionString: URL_BASE });
      await a.connect();
      try {
        await attendreDeconnexion(a, nom);
        // Un slot de réplication logique (PowerSync) empêche la suppression de la base.
        await a.query(
          `SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE database = $1 AND NOT active`,
          [nom],
        );
        await a.query(`DROP DATABASE IF EXISTS ${nom} WITH (FORCE)`);
      } finally {
        await a.end();
      }
    },
  };
}

export async function creerUtilisateur(pool: pg.Pool, email = `t10-${randomUUID()}@ferme.fr`): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  await pool.query(`INSERT INTO utilisateur (id, email, nom) VALUES ($1, $2, $3)`, [id, email, `Nom ${email}`]);
  return { id, email };
}

export async function creerFerme(pool: pg.Pool, nom = 'Jardins de Garonne'): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO ferme (id, nom, fuseau_horaire) VALUES ($1, $2, 'Europe/Paris')`, [id, nom]);
  return id;
}

export interface OptionsMembre {
  readonly role?: 'gerant' | 'equipier';
  readonly etat?: 'invite' | 'accepte';
  readonly retire?: boolean;
  readonly invitePar?: string;
}

export async function ajouterMembre(pool: pg.Pool, utilisateurId: string, fermeId: string, o: OptionsMembre = {}): Promise<void> {
  const invite = o.etat === 'invite' || o.invitePar !== undefined;
  await pool.query(
    `INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, invite_par, invite_le, supprime_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      utilisateurId,
      fermeId,
      o.role ?? 'equipier',
      o.etat ?? 'accepte',
      invite ? (o.invitePar ?? utilisateurId) : null,
      invite ? new Date('2026-09-30T08:00:00Z') : null,
      o.retire === true ? new Date('2026-09-30T09:00:00Z') : null,
    ],
  );
}

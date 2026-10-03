import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Dossier des migrations versionnées (drizzle-kit, plus les migrations SQL personnalisées). */
export const DOSSIER_MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applique sur la base `url` les migrations de `packages/db/migrations` qui ne l'ont pas encore
 * été (suivi dans `drizzle.__drizzle_migrations`). Rejouable : sur une base à jour, ne fait rien.
 * Une seule connexion, fermée avant de rendre la main, même en cas d'erreur.
 */
export async function appliquerMigrations(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  // Sans écouteur, une coupure de connexion après connect() serait une exception non rattrapée ;
  // la requête en cours échoue de toute façon, et c'est ce rejet que la reprise voit.
  client.on('error', () => undefined);
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: DOSSIER_MIGRATIONS });
  } finally {
    await client.end();
  }
}

/** Codes d'erreur de connexion : réseau (Node) et arrêt ou démarrage du serveur (Postgres 57P01, 57P03). */
const CODES_CONNEXION: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', '57P01', '57P03']);

/** Erreur de connexion (refusée, coupée, expirée) : le serveur n'est pas encore prêt, ou vient de tomber. */
function estErreurDeConnexion(erreur: unknown): boolean {
  if (typeof erreur !== 'object' || erreur === null) return false;
  const { code, message } = erreur as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && CODES_CONNEXION.has(code)) return true;
  return typeof message === 'string' && message.includes('Connection terminated unexpectedly');
}

export interface OptionsReprise {
  /** Nombre total de tentatives (défaut 10). */
  readonly essais?: number;
  /** Attente entre deux tentatives, en millisecondes (défaut 500). */
  readonly delaiMs?: number;
  /** Application des migrations (défaut : `appliquerMigrations`) ; remplaçable pour les tests. */
  readonly appliquer?: (url: string) => Promise<void>;
}

/**
 * Comme `appliquerMigrations`, mais réessaie quand la connexion échoue (T26) : au démarrage, le
 * serveur Postgres d'initialisation de l'image peut répondre puis s'arrêter. Seules les erreurs
 * de connexion sont reprises ; une erreur de migration est relancée tout de suite. Après `essais`
 * tentatives, la dernière erreur est relancée.
 */
export async function appliquerMigrationsAvecReprise(url: string, options: OptionsReprise = {}): Promise<void> {
  const { essais = 10, delaiMs = 500, appliquer = appliquerMigrations } = options;
  for (let essai = 1; ; essai++) {
    try {
      await appliquer(url);
      return;
    } catch (erreur) {
      if (essai >= essais || !estErreurDeConnexion(erreur)) throw erreur;
      await new Promise<void>((resolve) => setTimeout(resolve, delaiMs));
    }
  }
}

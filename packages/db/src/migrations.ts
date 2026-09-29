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
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: DOSSIER_MIGRATIONS });
  } finally {
    await client.end();
  }
}

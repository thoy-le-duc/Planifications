/**
 * `pnpm --filter @planif/db migrer` : applique les migrations sur la base DATABASE_URL.
 */
import { appliquerMigrations } from './migrations.ts';

const url = process.env.DATABASE_URL ?? '';
if (url === '') {
  console.error('DATABASE_URL absente. Exemple : DATABASE_URL=postgres://planif:planif@localhost:5432/planif');
  process.exit(1);
}
await appliquerMigrations(url);
console.log('Migrations appliquées.');

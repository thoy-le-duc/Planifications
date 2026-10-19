/**
 * `pnpm --filter @planif/db migrer` : applique les migrations sur la base DATABASE_URL.
 * En cas d'échec : le code et le message de l'erreur, nettoyés de l'adresse (T44), jamais l'objet
 * d'erreur entier (il porte l'hôte, le port, parfois l'adresse complète).
 */
import { messageErreurNettoye } from './erreur-migration.ts';
import { appliquerMigrationsAvecReprise } from './migrations.ts';

const url = process.env.DATABASE_URL ?? '';
if (url === '') {
  console.error('DATABASE_URL absente. Exemple : DATABASE_URL=postgres://planif:planif@localhost:5432/planif');
  process.exit(1);
}
try {
  await appliquerMigrationsAvecReprise(url);
} catch (erreur) {
  console.error(`Échec des migrations, ${messageErreurNettoye(erreur, url)}`);
  process.exit(1);
}
console.log('Migrations appliquées.');

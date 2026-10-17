/**
 * `pnpm --filter @planif/db bibliotheque` : écrit le SQL de la migration de la bibliothèque de
 * départ (MIGRATION_BIBLIOTHEQUE_DEPART) depuis bibliotheque/depart.json. Le fichier de migration
 * doit d'abord exister (`drizzle-kit generate --custom`). Une migration fusionnée ne se réécrit
 * jamais : une nouvelle version des valeurs passe par une nouvelle migration.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { convertirBibliotheque, lireBibliothequeDepart, MIGRATION_BIBLIOTHEQUE_DEPART, sqlBibliotheque } from './bibliotheque.ts';

const fichier = new URL(`../migrations/${MIGRATION_BIBLIOTHEQUE_DEPART}.sql`, import.meta.url);
if (!existsSync(fichier)) {
  console.error(`Migration ${MIGRATION_BIBLIOTHEQUE_DEPART} absente : la créer d'abord avec drizzle-kit generate --custom.`);
  process.exit(1);
}
writeFileSync(fichier, sqlBibliotheque(convertirBibliotheque(lireBibliothequeDepart())));
console.log(`Bibliothèque de départ écrite dans migrations/${MIGRATION_BIBLIOTHEQUE_DEPART}.sql.`);

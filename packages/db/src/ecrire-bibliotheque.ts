/**
 * `pnpm --filter @planif/db bibliotheque <NNNN_nom>` : écrit la migration de bibliothèque
 * `<NNNN_nom>` qui mène la base du dernier état (bibliotheque/etats/) au JSON courant
 * (bibliotheque/depart.json), et son état (T41b). Pour une migration nouvelle, ajoute aussi son
 * entrée au journal de drizzle et son instantané, comme `drizzle-kit generate --custom`.
 *
 * 0032_bibliotheque_depart est figée ; une migration fusionnée ne se réécrit jamais. Seule la
 * dernière migration de bibliothèque, pas encore fusionnée, peut être réécrite sous son nom.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { depotBibliotheque, preparerMigrationBibliotheque, verifierBibliotheque } from './bibliotheque.ts';

const migration = process.argv[2] ?? '';
if (migration === '') {
  console.error('Usage : pnpm --filter @planif/db bibliotheque <NNNN_nom> (numéro suivant du journal, par exemple 0034_bibliotheque_correction).');
  process.exit(1);
}
const r = preparerMigrationBibliotheque(migration, depotBibliotheque(), { maintenant: Date.now(), nouvelId: randomUUID });
if (!r.ok) {
  console.error(`Rien d'écrit : ${r.erreur}`);
  process.exit(1);
}
const racine = new URL('../', import.meta.url);
for (const f of r.fichiers) {
  const chemin = fileURLToPath(new URL(f.chemin, racine));
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, f.contenu);
  console.log(`écrit : packages/db/${f.chemin}`);
}
const erreurs = verifierBibliotheque(depotBibliotheque());
if (erreurs.length > 0) {
  console.error(erreurs.join('\n'));
  process.exit(1);
}
console.log(`Migration ${migration} écrite ; bibliothèque à jour.`);

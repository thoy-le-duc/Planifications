/**
 * Écrit src/jetons.css depuis src/ui/jetons.ts (T16) : la règle `:root` des variables CSS, seule
 * définition des couleurs, polices, rayons, espacements et ombres dans l'appli. Feuille de style
 * plutôt que JavaScript : zéro octet au démarrage, et la CSP (style-src 'self') est respectée.
 *
 * À relancer après chaque modification des jetons : `pnpm --filter @planif/web jetons`.
 * src/ui/jetons-css.test.ts échoue tant que le fichier n'est pas à jour.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHEMIN_JETONS_CSS, jetonsCss } from './jetons-css-contenu.ts';

writeFileSync(join(import.meta.dirname, '..', CHEMIN_JETONS_CSS), jetonsCss());
console.log(`${CHEMIN_JETONS_CSS} écrit.`);

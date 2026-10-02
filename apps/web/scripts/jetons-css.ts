/**
 * Écrit src/jetons.css depuis src/ui/jetons.ts (T16) : la règle `:root` des variables CSS, seule
 * définition des couleurs, polices, rayons, espacements et ombres dans l'appli. Feuille de style
 * plutôt que JavaScript : zéro octet au démarrage, et la CSP (style-src 'self') est respectée.
 *
 * T18 : écrit aussi public/theme-initial.js (thème posé avant le premier affichage), qui reprend
 * la couleur forêt des deux thèmes.
 *
 * À relancer après chaque modification des jetons : `pnpm --filter @planif/web jetons`.
 * src/ui/jetons-css.test.ts et src/ui/theme-initial.test.ts échouent tant que les fichiers ne
 * sont pas à jour.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHEMIN_JETONS_CSS, jetonsCss } from './jetons-css-contenu.ts';
import { CHEMIN_THEME_INITIAL, themeInitialJs } from './theme-initial-contenu.ts';

writeFileSync(join(import.meta.dirname, '..', CHEMIN_JETONS_CSS), jetonsCss());
console.log(`${CHEMIN_JETONS_CSS} écrit.`);
writeFileSync(join(import.meta.dirname, '..', CHEMIN_THEME_INITIAL), themeInitialJs());
console.log(`${CHEMIN_THEME_INITIAL} écrit.`);

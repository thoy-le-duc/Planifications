/**
 * T18 — contenu de public/theme-initial.js, généré depuis les jetons et src/ui/theme.ts (voir
 * scripts/jetons-css.ts) : le même travail que `initialiserTheme`, en script classique minuscule.
 *
 * index.html le charge par un <script src> bloquant dans le <head>, après les balises
 * theme-color : il pose `data-theme` avant que <body> existe, donc avant toute image (pas d'écran
 * clair qui clignote quand « Sombre » est forcé). Fichier de l'appli, pas de script en ligne : la
 * CSP (`script-src 'self'`) est respectée ; il est dans le précache du service worker (*.js).
 * Il compte dans le budget du JavaScript de démarrage : chaque octet est pesé.
 */
import { COULEURS, COULEURS_SOMBRES } from '../src/ui/jetons.ts';
import { CLE_THEME } from '../src/ui/theme.ts';

export const CHEMIN_THEME_INITIAL = 'public/theme-initial.js';

export function themeInitialJs(): string {
  // Bloc et `let` : rien n'est laissé dans l'espace global. « Comme le téléphone » : rien à faire,
  // les balises theme-color d'index.html portent déjà chacune la couleur de leur thème (media).
  return (
    `{let t;try{t=localStorage.getItem("${CLE_THEME}")}catch{}` +
    `if(t=="clair"||t=="sombre"){document.documentElement.dataset.theme=t;` +
    `for(const m of document.querySelectorAll('meta[name=theme-color]'))m.content=t=="clair"?"${COULEURS.entete}":"${COULEURS_SOMBRES.entete}"}}\n`
  );
}

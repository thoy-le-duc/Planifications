/**
 * T18 — contenu de public/theme-initial.js, généré depuis les jetons et src/ui/theme.ts (voir
 * scripts/jetons-css.ts) : le même travail que `initialiserTheme`, en script classique minuscule.
 *
 * index.html le charge par un <script src> bloquant dans le <head>, après la balise
 * theme-color : il pose `data-theme` avant que <body> existe, donc avant toute image (pas d'écran
 * clair qui clignote quand « Sombre » est forcé). Fichier de l'appli, pas de script en ligne : la
 * CSP (`script-src 'self'`) est respectée ; il est dans le précache du service worker (*.js).
 * Il compte dans le budget du JavaScript de démarrage : chaque octet est pesé.
 */
import { COULEURS, COULEURS_SOMBRES } from '../src/ui/jetons.ts';
import { CLE_THEME, MEDIA_SOMBRE } from '../src/ui/theme.ts';

export const CHEMIN_THEME_INITIAL = 'public/theme-initial.js';

export function themeInitialJs(): string {
  // Bloc et `let` : rien n'est laissé dans l'espace global de la page.
  return (
    `{let t,m=document.querySelector('meta[name="theme-color"]');` +
    `try{t=localStorage.getItem("${CLE_THEME}")}catch{}` +
    `if(t=="clair"||t=="sombre")document.documentElement.dataset.theme=t;` +
    `else t=matchMedia("${MEDIA_SOMBRE}").matches&&"sombre";` +
    `m&&(m.content=t=="sombre"?"${COULEURS_SOMBRES.foret}":"${COULEURS.foret}")}\n`
  );
}

/** Contenu de src/jetons.css, généré depuis les jetons (voir scripts/jetons-css.ts). */
import { variablesCss } from '../src/ui/jetons.ts';

export const CHEMIN_JETONS_CSS = 'src/jetons.css';

export function jetonsCss(): string {
  return `/* Généré par scripts/jetons-css.ts depuis src/ui/jetons.ts : ne pas modifier à la main. */\n${variablesCss()}\n`;
}

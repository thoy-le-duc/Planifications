/**
 * T18 — thème clair ou sombre, réglage « Apparence » de l'onglet Ferme.
 *
 * Par défaut, l'appli suit le téléphone (`prefers-color-scheme`, règles de src/jetons.css). Le
 * maraîcher peut forcer « Clair » (conseillé en plein soleil) ou « Sombre » : le choix est posé
 * en `data-theme` sur <html> et mémorisé dans le localStorage de cet appareil.
 *
 * Au démarrage, le choix mémorisé est posé AVANT le premier affichage par public/theme-initial.js
 * (script classique bloquant du <head>, généré depuis ce module et les jetons par
 * `pnpm --filter @planif/web jetons`) : jamais d'écran clair qui clignote avant le sombre. Ce
 * module n'est pas dans le JavaScript de démarrage : seul l'écran Ferme s'en sert.
 */
import { COULEURS, COULEURS_SOMBRES } from './jetons.ts';

/** Clé du localStorage. */
export const CLE_THEME = 'planif.theme';

/** « Comme le téléphone » (défaut), « Clair », « Sombre ». */
export type ChoixTheme = 'systeme' | 'clair' | 'sombre';

export type StockageTheme = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Choix mémorisé ; rien, valeur inconnue ou stockage inaccessible → « Comme le téléphone ». */
export function lireTheme(stockage: Pick<Storage, 'getItem'>): ChoixTheme {
  let valeur: string | null = null;
  try {
    valeur = stockage.getItem(CLE_THEME);
  } catch {
    // Mode privé, accès refusé : le téléphone décide.
  }
  return valeur === 'clair' || valeur === 'sombre' ? valeur : 'systeme';
}

/**
 * Pose le thème sur la page : `data-theme`, et couleur de la barre du navigateur (celle de
 * l'en-tête). index.html porte une balise theme-color par thème du téléphone (attribut `media`) :
 * en mode forcé, toutes prennent la couleur du thème choisi ; « Comme le téléphone » rend à
 * chacune la sienne.
 */
function poserTheme(choix: ChoixTheme, doc: Document): void {
  const racine = doc.documentElement;
  if (choix === 'systeme') racine.removeAttribute('data-theme');
  else racine.dataset.theme = choix;
  for (const balise of doc.querySelectorAll('meta[name="theme-color"]')) {
    const sombre = choix === 'systeme' ? (balise.getAttribute('media') ?? '').includes('dark') : choix === 'sombre';
    balise.setAttribute('content', sombre ? COULEURS_SOMBRES.entete : COULEURS.entete);
  }
}

/** Applique le choix et le mémorise (« Comme le téléphone » efface la mémoire). Ne lève jamais. */
export function appliquerTheme(choix: ChoixTheme, doc: Document, stockage: StockageTheme): void {
  poserTheme(choix, doc);
  try {
    if (choix === 'systeme') stockage.removeItem(CLE_THEME);
    else stockage.setItem(CLE_THEME, choix);
  } catch {
    // Stockage plein ou refusé : le thème vaut pour cette visite.
  }
}

/** Au démarrage : applique le choix mémorisé, sans rien écrire. Renvoie le choix appliqué. */
export function initialiserTheme(doc: Document, stockage: StockageTheme): ChoixTheme {
  const choix = lireTheme(stockage);
  poserTheme(choix, doc);
  return choix;
}

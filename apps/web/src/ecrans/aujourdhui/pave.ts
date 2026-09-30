/**
 * Pavé numérique de la récolte (T13) : ce que les touches font du texte affiché. Pur.
 *
 * Décimale à la française : « , » ; deux décimales au plus (le centième de kilo, 10 g, est la
 * résolution des balances de terrain) ; une seconde virgule est ignorée ; « , » en premier donne
 * « 0, ». La quantité est lue sur le texte affiché : 12,5 → 12.5 exactement, jamais 12.4999….
 */

/** Chiffres avant la virgule, au plus : 99 999 reste sous le plafond provisoire des récoltes (100 000). */
export const CHIFFRES_ENTIERS_MAX = 5;
export const DECIMALES_MAX = 2;

export type Touche = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | 'effacer';

/** Texte après l'appui sur `touche`. '' : rien de tapé. */
export function appuyer(texte: string, touche: Touche): string {
  if (touche === 'effacer') {
    const reste = texte.slice(0, -1);
    // « 0, » effacé : « 0 », puis rien.
    return reste;
  }
  const virgule = texte.indexOf(',');
  if (touche === ',') {
    if (virgule >= 0) return texte;
    return texte === '' ? '0,' : `${texte},`;
  }
  if (virgule >= 0) return texte.length - virgule - 1 >= DECIMALES_MAX ? texte : texte + touche;
  // Partie entière : pas de zéro en tête (« 0 » puis « 5 » donne « 5 »).
  if (texte === '0') return touche;
  if (texte.length >= CHIFFRES_ENTIERS_MAX) return texte;
  return texte + touche;
}

/** Quantité du texte affiché, 0 si rien (ou « 0, »). */
export function quantiteDe(texte: string): number {
  if (texte === '') return 0;
  const n = Number(texte.replace(',', '.').replace(/\.$/, ''));
  return Number.isFinite(n) ? n : 0;
}

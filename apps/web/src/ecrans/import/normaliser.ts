/**
 * Comparaison des noms de l'import (T14b) : sans casse, sans accents, ponctuation et espaces
 * multiples ramenés à une espace. « Les Grands Prés », « les grands  pres » : même zone.
 */
const MARQUES = /[̀-ͯ]/g;
const HORS_MOT = /[^a-z0-9]+/g;

export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(MARQUES, '').toLowerCase().replace(HORS_MOT, ' ').trim();
}

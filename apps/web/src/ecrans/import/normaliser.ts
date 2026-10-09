/**
 * Comparaison des noms de l'import (T14b) : sans casse, sans accents, ponctuation et espaces
 * multiples ramenés à une espace. « Les Grands Prés », « les grands  pres » : même zone.
 */
const MARQUES = /[̀-ͯ]/g;
const HORS_MOT = /[^a-z0-9]+/g;

export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(MARQUES, '').toLowerCase().replace(HORS_MOT, ' ').trim();
}

/**
 * Code d'emplacement comparé comme le serveur depuis T10t (Q27, index de la migration 0029) :
 * `lower(trim(code))`, rien de plus. « p3 » et « P3 » sont la même planche ; « P-3 », « P 3 » et
 * « P.3 » en sont trois (T14f).
 */
export function codeDe(code: string): string {
  return code.trim().toLowerCase();
}

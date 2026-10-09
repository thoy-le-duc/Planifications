/**
 * Comparaison des noms de l'import (T14b) : sans casse, sans accents, ponctuation et espaces
 * multiples ramenés à une espace. « Les Grands Prés », « les grands  pres » : même zone.
 */
const MARQUES = /[̀-ͯ]/g;
const HORS_MOT = /[^a-z0-9]+/g;

export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(MARQUES, '').toLowerCase().replace(HORS_MOT, ' ').trim();
}

/** Espaces (U+0020 seulement) en tête et en fin : le `trim()` de Postgres, pas celui de JavaScript. */
const ESPACES_AUTOUR = /^ +| +$/g;

/**
 * Code d'emplacement comparé comme le serveur depuis T10t (Q27, index de la migration 0029) :
 * `lower(trim(code))`, rien de plus ; `trim` de Postgres : espaces seulement, ni tabulation ni
 * espace insécable. « p3 » et « P3 » sont la même planche ; « P-3 », « P 3 » et
 * « P.3 » en sont trois (T14f).
 */
export function codeDe(code: string): string {
  return code.replace(ESPACES_AUTOUR, '').toLowerCase();
}

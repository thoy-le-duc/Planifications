/**
 * Outils communs aux règles des saisies (index.ts, serie.ts) : purs, sans DOM ni Node, ne lèvent
 * jamais. Internes au cœur : non exportés par @planif/core.
 */

/** Octets UTF-8 d'un texte (sans TextEncoder : le cœur n'a ni DOM ni Node). */
export function octetsUtf8(texte: string): number {
  let n = 0;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < texte.length) {
      const suivant = texte.charCodeAt(i + 1);
      if (suivant >= 0xdc00 && suivant <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/**
 * JSON.stringify qui ne lève jamais : le texte, ou le motif de l'échec ('imbrique' : pile
 * dépassée, RangeError ; 'illisible' : BigInt, valeur qui ne s'écrit pas).
 */
export function texteJson(v: unknown): { readonly texte: string } | { readonly echec: 'imbrique' | 'illisible' } {
  try {
    const texte: unknown = JSON.stringify(v);
    return typeof texte === 'string' ? { texte } : { echec: 'illisible' };
  } catch (e) {
    return { echec: e instanceof RangeError ? 'imbrique' : 'illisible' };
  }
}

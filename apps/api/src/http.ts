/** Petits outils HTTP partagés par les routes. */
import type { Context } from 'hono';

/** Corps JSON objet, ou null (absent, illisible, tableau, valeur simple). */
export async function lireCorps(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const corps: unknown = await c.req.json();
    return typeof corps === 'object' && corps !== null && !Array.isArray(corps) ? (corps as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const MOTIF_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Séparateurs et décorations d'adresses pour un analyseur d'en-têtes (« a@x.fr,pirate@y.fr »,
 * « Nom <pirate@y.fr> », commentaires, guillemets, littéraux de domaine), et caractères de
 * contrôle : une seule adresse doit partir, celle saisie.
 */
const CARACTERES_PIEGES = /[,;:<>()[\]"\\\p{Cc}]/u;
/**
 * Caractères invisibles de format (espace sans chasse, inversion de sens, trait d'union
 * conditionnel…), blanc braille (U+2800, ni espace ni format) et caractères combinants : deux
 * adresses différentes identiques à l'œil.
 */
const CARACTERES_INVISIBLES = /[\p{Cf}\p{M}\u2800]/u;
/** Points mal placés : consécutifs, en tête de partie locale ou de domaine, juste avant « @ ». */
const POINTS_MAL_PLACES = /\.\.|^\.|\.@|@\./;

/** Caractère refusé dans `s` (séparateur, contrôle, format, combinant, forme que NFKC change). */
function caracterePiege(s: string): boolean {
  return CARACTERES_PIEGES.test(s) || CARACTERES_INVISIBLES.test(s) || s !== s.normalize('NFKC');
}

/**
 * Vrai si `v` est une chaîne piégée : séparateur d'adresses, caractère de contrôle, de format ou
 * combinant, forme que NFKC change (pleine chasse, ligature, exposant, signe kelvin…), point
 * final de domaine ou point mal placé. Le contrôle est fait avant la normalisation ET refait
 * après : « İ » en minuscules laisse un point combinant (U+0307).
 */
export function emailPiege(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const normalisee = v.trim().toLowerCase();
  return caracterePiege(v) || caracterePiege(normalisee) || normalisee.endsWith('.') || POINTS_MAL_PLACES.test(normalisee);
}

/** Adresse normalisée (espaces retirés, minuscules), ou null si elle n'en est pas une. */
export function normaliserEmail(v: unknown): string | null {
  if (typeof v !== 'string' || emailPiege(v)) return null;
  const email = v.trim().toLowerCase();
  return email.length <= 254 && MOTIF_EMAIL.test(email) ? email : null;
}

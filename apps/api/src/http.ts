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

/** Vrai si `v` est une chaîne qui contient un séparateur d'adresses ou un caractère de contrôle. */
export function emailPiege(v: unknown): boolean {
  return typeof v === 'string' && CARACTERES_PIEGES.test(v);
}

/** Adresse normalisée (espaces retirés, minuscules), ou null si elle n'en est pas une. */
export function normaliserEmail(v: unknown): string | null {
  if (typeof v !== 'string' || emailPiege(v)) return null;
  const email = v.trim().toLowerCase();
  return email.length <= 254 && MOTIF_EMAIL.test(email) ? email : null;
}

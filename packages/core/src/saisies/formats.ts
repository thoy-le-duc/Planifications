/**
 * Formats communs d'une ligne écrite par le téléphone (T28s) : identifiant UUID et instant de
 * suppression douce. Partagés par le serveur (apps/api/src/sync/structure-lignes.ts) et la porte
 * du téléphone (packages/sync/src/placement.ts), pour que la porte refuse exactement ce que le
 * serveur refuserait. Purs, ne lèvent jamais.
 */
import { estDateValide } from '../dates/index.ts';

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Instant ISO 8601 complet avec fuseau ; le jour est vérifié à part (pas de 30 février). */
const MOTIF_INSTANT = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** UUID (toute casse) rendu en minuscules, comme Postgres le range ; null si `v` n'en est pas un. */
export function identifiantNormalise(v: unknown): string | null {
  return typeof v === 'string' && MOTIF_UUID.test(v) ? v.toLowerCase() : null;
}

/**
 * Instant ISO 8601 complet avec fuseau ('Z' ou ±hh:mm ; Postgres rend '+00:00'), jour existant,
 * rendu en ISO UTC (`toISOString()`) ; null sinon (mot, date seule, instant sans fuseau, 30 février).
 */
export function instantNormalise(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const jour = MOTIF_INSTANT.exec(v)?.[1];
  if (jour === undefined || !estDateValide(jour)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Disposition des rangs d'une densité « écartement » (T35a, Q34) : rangs alignés ou en
 * quinconce. Elle ne change pas le nombre de plants (besoins de T05) : c'est un renseignement
 * de pose, dessiné dans le schéma de l'itinéraire.
 */
import type { Centimetres, Densite, DensiteEcartement } from './entites.ts';

/** Plants d'un rang en face de ceux du voisin (`alignee`) ou décalés d'un demi-écartement. */
export type DispositionRangs = 'alignee' | 'quinconce';

export const DISPOSITIONS_RANGS: readonly DispositionRangs[] = ['alignee', 'quinconce'];

/** La disposition de la densité ; absente (itinéraire d'avant T35a) → `alignee`. */
export function dispositionDe(densite: DensiteEcartement): DispositionRangs {
  return densite.disposition ?? 'alignee';
}

// ── Écart entre rangs (T43) ────────────────────────────────────────────────────────────────

/**
 * Bornes de l'écart entre rangs saisi, en cm. Au-delà de la planche, ce n'est qu'un avertissement
 * de l'écran : un rang par planche se règle sur l'entraxe des planches (120 cm, par exemple).
 */
export const ECART_ENTRE_RANGS_MIN_CM = 5;
export const ECART_ENTRE_RANGS_MAX_CM = 200;

/**
 * L'écart entre rangs saisi d'une densité en rangs (écartement, mètre linéaire) ; absent (itinéraire
 * d'avant T43) ou à la volée → null. Renseignement de pose (semoir, traceur) : il ne change pas les
 * besoins de T05.
 */
export function ecartEntreRangsDe(densite: Densite): Centimetres | null {
  if (densite.facon === 'volee') return null;
  return densite.ecartEntreRangsCm ?? null;
}

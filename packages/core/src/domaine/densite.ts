/**
 * Disposition des rangs d'une densité « écartement » (T35a, Q34) : rangs alignés ou en
 * quinconce. Elle ne change pas le nombre de plants (besoins de T05) : c'est un renseignement
 * de pose, dessiné dans le schéma de l'itinéraire.
 */
import type { DensiteEcartement } from './entites.ts';

/** Plants d'un rang en face de ceux du voisin (`alignee`) ou décalés d'un demi-écartement. */
export type DispositionRangs = 'alignee' | 'quinconce';

export const DISPOSITIONS_RANGS: readonly DispositionRangs[] = ['alignee', 'quinconce'];

/** La disposition de la densité ; absente (itinéraire d'avant T35a) → `alignee`. */
export function dispositionDe(densite: DensiteEcartement): DispositionRangs {
  return densite.disposition ?? 'alignee';
}

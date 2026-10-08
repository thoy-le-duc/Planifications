/**
 * Ferme sans placement (T28f) : la vue 3D invite alors à placer la ferme sur la photo aérienne.
 * Pur : ni React, ni three, ni date. Contrat : ./test/contrat-editeur.ts.
 */
import type { Plan } from '../plan/calculs.ts';

/**
 * Vrai quand rien n'est placé : aucun bâtiment, aucune zone avec contour, aucune planche positionnée.
 * Un seul de ces éléments suffit à rendre la réponse fausse.
 */
export function fermeSansPlacement(plan: Pick<Plan, 'lignes' | 'batiments'>): boolean {
  if ((plan.batiments?.length ?? 0) > 0) return false;
  for (const l of plan.lignes) {
    if (l.sorte === 'emplacement') {
      if (l.placement !== null && l.placement !== undefined) return false;
    } else if (l.contour !== null && l.contour !== undefined && l.contour.length > 0) {
      return false;
    }
  }
  return true;
}

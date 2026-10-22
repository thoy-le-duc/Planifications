/**
 * Placer une serre depuis sa zone (T81), règles pures : quelle zone propose une serre, de quel
 * type, avec quelles mesures de départ. Ni React, ni DOM, ni réseau.
 */
import type { TypeBatiment } from './coeur.ts';

/** Mesures d'une serre posée quand la ferme n'a pas encore de bâtiment du même type (m). */
export const LONGUEUR_SERRE_DEFAUT_M = 30;
export const LARGEUR_SERRE_DEFAUT_M = 8;
/** Hauteur d'une serre posée (m), celle de « Nouveau bâtiment ». */
export const HAUTEUR_SERRE_DEFAUT_M = 3.5;

/** Type du bâtiment qui abrite une zone de ce type d'abri ; `null` : la zone se trace (plein champ, hors-sol sans abri). */
export function typeDeSerrePourZone(typeAbri: string | null | undefined): 'serre_tunnel' | 'serre_chapelle' | null {
  if (typeAbri === 'tunnel') return 'serre_tunnel';
  if (typeAbri === 'serre') return 'serre_chapelle';
  return null;
}

/** Longueur et largeur du dernier bâtiment de ce type dans la liste, sinon 30 m × 8 m. */
export function dimensionsParDefaut(
  batiments: readonly { readonly type: TypeBatiment; readonly longueurM: number; readonly largeurM: number }[],
  type: TypeBatiment,
): { readonly longueurM: number; readonly largeurM: number } {
  const dernier = batiments.findLast((b) => b.type === type);
  return dernier === undefined ? { longueurM: LONGUEUR_SERRE_DEFAUT_M, largeurM: LARGEUR_SERRE_DEFAUT_M } : { longueurM: dernier.longueurM, largeurM: dernier.largeurM };
}

/**
 * Placer une serre depuis sa zone (T81), règles pures : quelle zone propose une serre, de quel
 * type, avec quelles mesures de départ. Ni React, ni DOM, ni réseau.
 */
import type { TypeBatiment } from './coeur.ts';

/** Type du bâtiment qui abrite une zone de ce type d'abri ; `null` : la zone se trace (plein champ, hors-sol sans abri). */
export function typeDeSerrePourZone(typeAbri: string | null | undefined): 'serre_tunnel' | 'serre_chapelle' | null {
  if (typeAbri === 'tunnel') return 'serre_tunnel';
  if (typeAbri === 'serre') return 'serre_chapelle';
  return null;
}

/** Longueur et largeur du dernier bâtiment de ce type dans la liste, sinon 30 m × 8 m (hauteur posée : 3,5 m, comme « Nouveau bâtiment »). */
export function dimensionsParDefaut(
  batiments: readonly { readonly type: TypeBatiment; readonly longueurM: number; readonly largeurM: number }[],
  type: TypeBatiment,
): { readonly longueurM: number; readonly largeurM: number } {
  const dernier = batiments.findLast((b) => b.type === type);
  return { longueurM: dernier?.longueurM ?? 30, largeurM: dernier?.largeurM ?? 8 };
}

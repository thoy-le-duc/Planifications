/**
 * Placer une serre depuis sa zone (T81), règle pure : quelle zone propose une serre, de quel type. Ni React, ni DOM, ni réseau.
 */
/** Type du bâtiment qui abrite une zone de ce type d'abri ; `null` : la zone se trace (plein champ, hors-sol sans abri). */
export function typeDeSerrePourZone(typeAbri: string | null | undefined): 'serre_tunnel' | 'serre_chapelle' | null {
  if (typeAbri === 'tunnel') return 'serre_tunnel';
  if (typeAbri === 'serre') return 'serre_chapelle';
  return null;
}

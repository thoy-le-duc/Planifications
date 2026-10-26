/**
 * Le bloc d'une zone (T85), en fonctions pures : ni React, ni DOM, ni réseau, ni horloge. Chargé à la demande
 * avec le panneau de la zone (./zone-ecran.tsx) ; contours.ts le ré-exporte pour ses tests.
 */
import { repereZone, type RepereZone } from './coeur.ts';
import { normaliserCap } from './gestes.ts';
import type { Point } from './tuiles.ts';

/** Mouvement rigide d'un bloc : rotation (sens horaire) autour du centre du repère du contour, puis translation. */
export interface MouvementBloc {
  readonly dx: number;
  readonly dy: number;
  readonly rotationDeg: number;
}

const RAD = Math.PI / 180;

/**
 * Le bloc d'une zone (contour et planches) bouge d'un seul tenant (T85) : le contour et le repère
 * « calage » où ses planches gardent leur placement subissent le même mouvement ; les planches
 * suivent donc, à la même place dans la zone. Contour sans repère (invalide) : null. Sommets au
 * millimètre ; aucun argument modifié.
 */
export function mouvoirBloc(contour: readonly Point[], calage: RepereZone, m: MouvementBloc): { contour: Point[]; calage: RepereZone } | null {
  const repere = repereZone({ contour });
  if (repere === null) return null;
  const c = repere.centre;
  const cos = Math.cos(m.rotationDeg * RAD);
  const sin = Math.sin(m.rotationDeg * RAD);
  const mouvoir = (p: Point): Point => {
    const x = p.x - c.x;
    const y = p.y - c.y;
    return { x: c.x + x * cos + y * sin + m.dx, y: c.y - x * sin + y * cos + m.dy };
  };
  const arrondi = (p: Point): Point => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });
  return {
    contour: contour.map((p) => arrondi(mouvoir(p))),
    calage: { centre: mouvoir(calage.centre), orientationDeg: normaliserCap(calage.orientationDeg + m.rotationDeg) },
  };
}

/**
 * Plusieurs sites (T28h) : cadrer une emprise de la ferme sur l'écran de l'éditeur, pour « Aller à »
 * (une zone) et « Toute la ferme » (l'union des zones placées). Pur. Contrat : ./test/contrat-adresse.ts.
 *
 * Le cadrage de la vue 3D (../plan3d/cadrage.ts) règle une caméra en perspective : il ne se réutilise
 * pas sur une carte à zoom entier. Ce qui est commun, la mesure des mètres par pixel, vient de tuiles.ts.
 */
import { metresParPixel, ZOOM_MIN_VUE, ZOOM_TUILES_MAX, type Point } from './tuiles.ts';

export interface Emprise {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Part de l'écran que l'emprise occupe au plus, pour garder une marge tout autour. */
export const PART_ECRAN_MAX = 0.9;

/** Plus petite boîte qui contient tous les sommets des contours ; null s'il n'y en a aucun. */
export function empriseDeContours(contours: readonly (readonly Point[])[]): Emprise | null {
  let emprise: Emprise | null = null;
  for (const p of contours.flat()) {
    emprise =
      emprise === null
        ? { minX: p.x, maxX: p.x, minY: p.y, maxY: p.y }
        : { minX: Math.min(emprise.minX, p.x), maxX: Math.max(emprise.maxX, p.x), minY: Math.min(emprise.minY, p.y), maxY: Math.max(emprise.maxY, p.y) };
  }
  return emprise;
}

/** Centre = milieu de l'emprise ; zoom = le plus grand entier de [ZOOM_MIN_VUE, ZOOM_TUILES_MAX] où elle tient dans 90 % de l'écran. */
export function vueSurEmprise(emprise: Emprise, ecran: { readonly largeurPx: number; readonly hauteurPx: number }, latitude: number): { readonly centre: Point; readonly zoom: number } {
  const largeurM = emprise.maxX - emprise.minX;
  const hauteurM = emprise.maxY - emprise.minY;
  let zoom = ZOOM_MIN_VUE;
  for (let z = ZOOM_TUILES_MAX; z > ZOOM_MIN_VUE; z--) {
    const mpp = metresParPixel(latitude, z);
    if (largeurM / mpp <= PART_ECRAN_MAX * ecran.largeurPx && hauteurM / mpp <= PART_ECRAN_MAX * ecran.hauteurPx) {
      zoom = z;
      break;
    }
  }
  return { centre: { x: (emprise.minX + emprise.maxX) / 2, y: (emprise.minY + emprise.maxY) / 2 }, zoom };
}

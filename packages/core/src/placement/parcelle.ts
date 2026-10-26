/**
 * Parcelle d'une zone dessinée depuis ses planches (T85) : le rectangle qui les contient, rangées
 * côte à côte, et la place de chacune dedans. Calcul pur, sans repère de la ferme : l'éditeur pose
 * ensuite le rectangle où il veut. Aucun arrondi caché : tout est au millimètre.
 *
 * Repère du résultat : origine au centre du rectangle, x vers l'est (la largeur), y vers le nord (la
 * longueur). Les planches sont parallèles au nord, rangées de l'ouest à l'est dans l'ordre naturel de
 * leurs codes (P1, P2, …, P9, P10 ; casse ignorée), P1 contre le bord ouest, toutes alignées en bout sud.
 */

/** Largeur d'une planche dont la largeur est inconnue ou nulle (même valeur que la vue 3D). */
export const LARGEUR_PLANCHE_PAR_DEFAUT_M = 0.8;
/** Passe-pied de départ : planche de 75 cm + passe-pied de 45 cm = entraxe de 120 cm. */
export const PASSE_PIED_PAR_DEFAUT_CM = 45;
/** Plafond du passe-pied, en centimètres. */
export const PASSE_PIED_MAX_CM = 500;

export interface PlancheDeParcelle {
  readonly id: string;
  readonly code: string;
  readonly longueurM: number;
  /** Nulle ou 0 : 0,80 m. */
  readonly largeurM: number | null;
}

export interface PlancheRangee {
  readonly id: string;
  readonly code: string;
  /** Centre de la planche, dans le repère du rectangle (mètres). */
  readonly centre: { readonly x: number; readonly y: number };
  readonly longueurM: number;
  readonly largeurM: number;
}

export interface Parcelle {
  readonly longueurM: number;
  readonly largeurM: number;
  /** Dans l'ordre de rangement, de l'ouest à l'est. */
  readonly planches: readonly PlancheRangee[];
}

/** Au millimètre ; `+ 0` efface le zéro négatif. */
const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;

const comparerCodes = (a: PlancheDeParcelle, b: PlancheDeParcelle): number =>
  a.code.localeCompare(b.code, 'fr', { numeric: true, sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * La parcelle de ces planches avec ce passe-pied (entier de 0 à 500 cm). `null` : aucune planche, passe-pied
 * hors bornes, ou une longueur qui n'est pas un nombre positif.
 */
export function parcelleDepuisPlanches(planches: readonly PlancheDeParcelle[], passePiedCm: number): Parcelle | null {
  if (planches.length === 0 || !Number.isInteger(passePiedCm) || passePiedCm < 0 || passePiedCm > PASSE_PIED_MAX_CM) return null;
  if (planches.some((p) => !Number.isFinite(p.longueurM) || p.longueurM <= 0)) return null;
  const passePied = passePiedCm / 100;
  const rangees = [...planches]
    .sort(comparerCodes)
    .map((p) => ({ p, largeur: p.largeurM !== null && Number.isFinite(p.largeurM) && p.largeurM > 0 ? p.largeurM : LARGEUR_PLANCHE_PAR_DEFAUT_M }));
  const longueur = Math.max(...rangees.map((r) => r.p.longueurM));
  const largeur = rangees.reduce((somme, r) => somme + r.largeur, 0) + (rangees.length - 1) * passePied;
  let bord = -largeur / 2;
  const resultat: PlancheRangee[] = rangees.map(({ p, largeur: l }) => {
    const x = bord + l / 2;
    bord += l + passePied;
    return { id: p.id, code: p.code, centre: { x: mm(x), y: mm(-longueur / 2 + p.longueurM / 2) }, longueurM: mm(p.longueurM), largeurM: mm(l) };
  });
  return { longueurM: mm(longueur), largeurM: mm(largeur), planches: resultat };
}

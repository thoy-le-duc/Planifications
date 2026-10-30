/**
 * Une serre découpée en cases (T88) : une grille de chapelles (dans la largeur) × tronçons (dans la longueur), avec des allées
 * entre les tronçons. Les sous-zones remplissent les cases dans l'ordre naturel de leurs noms, tronçon par tronçon (tronçon 1
 * chapelles 1 à C, puis tronçon 2…). Grille nulle (nb_chapelles et nb_troncons nuls) : une chapelle par sous-zone, un seul
 * tronçon, soit les bandes de T86. Calcul pur, au millimètre ; rien n'est stocké que les trois colonnes du bâtiment.
 *
 * Repère du bâtiment (celui des bandes) : origine au centre, x dans la largeur, y dans la longueur ; chapelle 1 côté x négatif,
 * tronçon 1 côté y négatif.
 */
import { comparerNoms, rangerDansRectangle, type RangementDeBande, type SousZoneDeSerre } from './bandes.ts';
import type { PlancheDeParcelle } from './parcelle.ts';

/** Bornes de la grille, comprises (mêmes que la base). */
export const GRILLE_SERRE = { chapellesMax: 100, tronconsMax: 50, alleeMaxM: 500 } as const;

export interface GrilleSerre {
  readonly longueurM: number;
  readonly largeurM: number;
  readonly nbChapelles?: number | null;
  readonly nbTroncons?: number | null;
  readonly largeurAlleeM?: number | null;
}

export interface DimensionsGrille {
  readonly largeurChapelleM: number;
  readonly longueurTronconM: number;
}

export interface CaseSerre {
  /** De 1 à C, côté x négatif d'abord. */
  readonly chapelle: number;
  /** De 1 à T, côté y négatif d'abord. */
  readonly troncon: number;
  /** La sous-zone de la case, ou null pour une case vide. */
  readonly id: string | null;
  readonly nom: string | null;
  /** Centre de la case, dans le repère du bâtiment (mètres). */
  readonly centre: { readonly x: number; readonly y: number };
  readonly longueurM: number;
  readonly largeurM: number;
}

export interface ResultatCases {
  /** Toutes les cases (vides comprises), tronçon par tronçon. */
  readonly cases: readonly CaseSerre[];
  /** Sous-zones surnuméraires, dans l'ordre naturel des noms. */
  readonly sansCase: readonly SousZoneDeSerre[];
  /** « 2 zones n’ont pas de place dans la serre », ou null. */
  readonly avertissement: string | null;
}

/** Au millimètre ; `+ 0` efface le zéro négatif. */
const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const positif = (v: number): boolean => Number.isFinite(v) && v > 0;
const entierDans = (v: number, max: number): boolean => Number.isInteger(v) && v >= 1 && v <= max;

interface Grille {
  readonly chapelles: number;
  readonly troncons: number;
  readonly allee: number;
  readonly largeurChapelle: number;
  readonly longueurTroncon: number;
}

/** Plus courte longueur d'un tronçon, et plus petite largeur d'une chapelle (m) : un millimètre, une fois arrondi. */
export const TRONCON_MIN_M = 0.001;

/**
 * La grille effective, sans arrondi. Grille nulle (les trois colonnes nulles) : une chapelle par sous-zone (au moins une), un
 * seul tronçon (T86). nb_chapelles seul : un tronçon, allée de 0. Tronçons ou allée sans nb_chapelles : pas de grille (la base
 * et le serveur le refusent). null aussi : dimensions non positives, valeurs hors bornes, ou tronçon de moins d'un millimètre.
 */
function grille(serre: GrilleSerre, nbSousZones: number): Grille | null {
  if (!positif(serre.longueurM) || !positif(serre.largeurM)) return null;
  const nbChapelles = serre.nbChapelles ?? null;
  if (nbChapelles === null && ((serre.nbTroncons ?? null) !== null || (serre.largeurAlleeM ?? null) !== null)) return null;
  const troncons = serre.nbTroncons ?? 1;
  const allee = serre.largeurAlleeM ?? 0;
  const chapelles = nbChapelles ?? Math.max(1, nbSousZones);
  if (!entierDans(troncons, GRILLE_SERRE.tronconsMax) || !entierDans(chapelles, GRILLE_SERRE.chapellesMax)) return null;
  if (!Number.isFinite(allee) || allee < 0) return null;
  const reste = troncons === 1 ? serre.longueurM : serre.longueurM - (troncons - 1) * allee;
  const longueurTroncon = reste / troncons;
  const largeurChapelle = serre.largeurM / chapelles;
  if (!(mm(longueurTroncon) >= TRONCON_MIN_M) || !(mm(largeurChapelle) >= TRONCON_MIN_M)) return null;
  return { chapelles, troncons, allee: troncons === 1 ? 0 : allee, largeurChapelle, longueurTroncon };
}

/** Largeur d'une chapelle et longueur d'un tronçon, au millimètre ; null si la grille ne tient pas. */
export function dimensionsGrille(serre: GrilleSerre, nbSousZones = 0): DimensionsGrille | null {
  const g = grille(serre, nbSousZones);
  return g === null ? null : { largeurChapelleM: mm(g.largeurChapelle), longueurTronconM: mm(g.longueurTroncon) };
}

/** La serre a une grille renseignée (au moins une des trois colonnes ; sans nb_chapelles, elle est refusée et n'a pas de case). */
export const aUneGrille = (serre: GrilleSerre): boolean =>
  (serre.nbChapelles ?? null) !== null || (serre.nbTroncons ?? null) !== null || (serre.largeurAlleeM ?? null) !== null;

const avertir = (n: number): string | null =>
  n === 0 ? null : n === 1 ? '1 zone n’a pas de place dans la serre.' : `${String(n)} zones n’ont pas de place dans la serre.`;

/** Les cases de la serre et la sous-zone de chacune (ordre naturel des noms, tronçon par tronçon). */
export function casesDeSerre(serre: GrilleSerre, sousZones: readonly SousZoneDeSerre[]): ResultatCases {
  const triees = [...sousZones].sort(comparerNoms);
  // Grille nulle sans sous-zone : rien à dessiner (comme T86).
  const g = triees.length === 0 && !aUneGrille(serre) ? null : grille(serre, triees.length);
  if (g === null) return { cases: [], sansCase: triees, avertissement: avertir(triees.length) };
  const cases: CaseSerre[] = [];
  for (let t = 0; t < g.troncons; t++) {
    const y = -serre.longueurM / 2 + t * (g.longueurTroncon + g.allee) + g.longueurTroncon / 2;
    for (let c = 0; c < g.chapelles; c++) {
      const z = triees[t * g.chapelles + c];
      cases.push({
        chapelle: c + 1,
        troncon: t + 1,
        id: z?.id ?? null,
        nom: z?.nom ?? null,
        centre: { x: mm(-serre.largeurM / 2 + g.largeurChapelle * (c + 0.5)), y: mm(y) },
        longueurM: mm(g.longueurTroncon),
        largeurM: mm(g.largeurChapelle),
      });
    }
  }
  const sansCase = triees.slice(cases.length);
  return { cases, sansCase, avertissement: avertir(sansCase.length) };
}

/**
 * Range ces planches dans la case, côte à côte, le bloc centré dans la case (règle de T85, comme `rangerDansBande`). `null` :
 * aucune planche, passe-pied hors bornes ou longueur qui n'est pas un nombre positif.
 */
export function rangerDansCase(c: CaseSerre, planches: readonly PlancheDeParcelle[], passePiedCm: number): RangementDeBande | null {
  return rangerDansRectangle(c, planches, passePiedCm);
}

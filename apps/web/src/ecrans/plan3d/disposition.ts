/**
 * Rangement automatique des planches non placées d'une zone placée (T28c) : elles se rangent
 * DANS la zone (rectangle de la serre, ou contour), alignées sur son axe, sans toucher aux planches
 * déjà là. Tout est calculé dans le repère de la zone (T28a : x' à droite, y' le long de la
 * longueur, cap 0 = y'), où la serre est un rectangle droit : la rotation et le miroir z = −y de
 * la scène sont appliqués ensuite par l'appelant, ce qui ne change ni les recouvrements ni
 * l'appartenance. Pur : des nombres en entrée et en sortie, ni three ni horloge.
 */

const RAD = Math.PI / 180;

/** Écart voulu entre deux planches rangées automatiquement (m). */
const ECART_M = 0.3;
/** Marge intérieure (m) retirée aux coins d'une planche pour décider qu'elle est dans le contour : un coin posé sur le bord compte dedans. */
const MARGE_BORD_M = 1e-4;

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Rectangle de planche dans le repère de la zone : centre, dimensions, cap relatif à l'axe de la zone (degrés). */
export interface RectZone {
  readonly x: number;
  readonly y: number;
  readonly longueur: number;
  readonly largeur: number;
  readonly capDeg: number;
}

export type Conteneur =
  /** La serre : [−demiX, demiX] × [−demiY, demiY]. */
  | { readonly sorte: 'rectangle'; readonly demiX: number; readonly demiY: number }
  /** Le contour, déjà ramené dans le repère de la zone. */
  | { readonly sorte: 'polygone'; readonly points: readonly Pt[] };

export interface Taille {
  readonly longueur: number;
  readonly largeur: number;
}

/** Les 4 coins d'un rectangle, en rétrécissant ses côtés de `retrait` de chaque bout. */
export function coinsDe(r: RectZone, retrait = 0): Pt[] {
  const t = r.capDeg * RAD;
  const dx = Math.sin(t);
  const dy = Math.cos(t);
  const nx = dy;
  const ny = -dx;
  const l = r.longueur / 2 - retrait;
  const w = r.largeur / 2 - retrait;
  return [
    { x: r.x - l * dx - w * nx, y: r.y - l * dy - w * ny },
    { x: r.x + l * dx - w * nx, y: r.y + l * dy - w * ny },
    { x: r.x + l * dx + w * nx, y: r.y + l * dy + w * ny },
    { x: r.x - l * dx + w * nx, y: r.y - l * dy + w * ny },
  ];
}

/** Deux quadrilatères convexes séparés d'au moins `ecart` selon un des axes de leurs côtés. */
function separes(a: readonly Pt[], b: readonly Pt[], ecart: number): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 2; i += 1) {
      const p = poly[i];
      const q = poly[i + 1];
      if (p === undefined || q === undefined) continue;
      const nx = -(q.y - p.y);
      const ny = q.x - p.x;
      const norme = Math.hypot(nx, ny);
      if (norme === 0) continue;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const c of a) {
        const v = (c.x * nx + c.y * ny) / norme;
        a0 = Math.min(a0, v);
        a1 = Math.max(a1, v);
      }
      for (const c of b) {
        const v = (c.x * nx + c.y * ny) / norme;
        b0 = Math.min(b0, v);
        b1 = Math.max(b1, v);
      }
      if (a1 + ecart <= b0 || b1 + ecart <= a0) return true;
    }
  }
  return false;
}

function dansPolygone(p: Pt, poly: readonly Pt[]): boolean {
  let dedans = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dedans = !dedans;
  }
  return dedans;
}

/** Le point est strictement dans le quadrilatère convexe (coins en ordre). */
function dansQuadrilatere(p: Pt, q: readonly Pt[]): boolean {
  let signe = 0;
  for (let i = 0; i < q.length; i += 1) {
    const a = q[i];
    const b = q[(i + 1) % q.length];
    if (a === undefined || b === undefined) continue;
    const croix = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (croix === 0) return false;
    const s = Math.sign(croix);
    if (signe === 0) signe = s;
    else if (s !== signe) return false;
  }
  return true;
}

function dansConteneur(c: Conteneur, r: RectZone): boolean {
  const coins = coinsDe(r, MARGE_BORD_M);
  if (c.sorte === 'rectangle') return coins.every((p) => Math.abs(p.x) <= c.demiX && Math.abs(p.y) <= c.demiY);
  // Contour : les 4 coins dedans, et aucun sommet du contour dans la planche (l'encoche d'un L).
  return coins.every((p) => dansPolygone(p, c.points)) && !c.points.some((p) => dansQuadrilatere(p, coins));
}

function etendue(c: Conteneur): { x0: number; x1: number; y0: number; y1: number } {
  if (c.sorte === 'rectangle') return { x0: -c.demiX, x1: c.demiX, y0: -c.demiY, y1: c.demiY };
  return {
    x0: Math.min(...c.points.map((p) => p.x)),
    x1: Math.max(...c.points.map((p) => p.x)),
    y0: Math.min(...c.points.map((p) => p.y)),
    y1: Math.max(...c.points.map((p) => p.y)),
  };
}

/**
 * Place chaque planche (dans l'ordre) au premier endroit libre, en balayant les rangées du bas
 * vers le haut et chaque rangée de gauche à droite ; les positions essayées sont les bords du
 * conteneur et les bords des planches déjà posées (plus un écart). Alignée sur la zone (cap 0) ;
 * si elle ne tient pas, couchée (cap 90°) ; si rien ne tient, au centre de la zone (elle déborde :
 * la zone est trop pleine pour ranger sans chevauchement).
 */
export function rangerDansZone(conteneur: Conteneur, deja: readonly RectZone[], aRanger: readonly Taille[]): RectZone[] {
  const posees: RectZone[] = [...deja];
  const resultat: RectZone[] = [];
  const bornes = etendue(conteneur);
  for (const t of aRanger) {
    let choisi: RectZone | null = null;
    for (const capDeg of [0, 90]) {
      // Étendue de la planche selon x' (w) et y' (h) pour ce cap.
      const w = capDeg === 0 ? t.largeur : t.longueur;
      const h = capDeg === 0 ? t.longueur : t.largeur;
      if (w > bornes.x1 - bornes.x0 + 1e-9 || h > bornes.y1 - bornes.y0 + 1e-9) continue;
      const xs = [bornes.x0 + w / 2];
      const ys = [bornes.y0 + h / 2];
      for (const p of posees) {
        const coins = coinsDe(p);
        xs.push(Math.max(...coins.map((c) => c.x)) + ECART_M + w / 2);
        ys.push(Math.max(...coins.map((c) => c.y)) + ECART_M + h / 2);
      }
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      for (const y of ys) {
        if (y + h / 2 > bornes.y1 + 1e-9) break;
        for (const x of xs) {
          if (x + w / 2 > bornes.x1 + 1e-9) break;
          const candidat: RectZone = { x, y, longueur: t.longueur, largeur: t.largeur, capDeg };
          if (!dansConteneur(conteneur, candidat)) continue;
          const coins = coinsDe(candidat);
          if (posees.every((p) => separes(coins, coinsDe(p), ECART_M))) {
            choisi = candidat;
            break;
          }
        }
        if (choisi !== null) break;
      }
      if (choisi !== null) break;
    }
    const final: RectZone = choisi ?? { x: 0, y: 0, longueur: t.longueur, largeur: t.largeur, capDeg: 0 };
    posees.push(final);
    resultat.push(final);
  }
  return resultat;
}

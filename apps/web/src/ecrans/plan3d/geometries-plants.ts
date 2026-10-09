/**
 * Vue 3D (T32b) — les géométries partagées des plants stylisés : une par forme, de 1 m de haut et
 * d'environ 1 m de large (rayon 0,5), à une cinquantaine de triangles (TRIANGLES_PAR_FORME, vérifié
 * par geometries-plants.test.ts). Facettes plates, sans texture : une teinte par sommet (le bois plus
 * sombre que le feuillage) que la couleur de l'instance multiplie. Pas de React ici : three seul.
 */
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { FormePlant } from '@planif/core/croissance';

/** Un pas de construction : positions et teintes des sommets, triangle par triangle. */
class Facettes {
  readonly positions: number[] = [];
  readonly teintes: number[] = [];

  private triangle(teinte: number, ...p: readonly number[]): void {
    this.positions.push(...p);
    this.teintes.push(teinte, teinte, teinte, teinte, teinte, teinte, teinte, teinte, teinte);
  }

  /**
   * Tronc de cône à `n` côtés de (y0, rayon r0) à (y1, rayon r1), centré en (cx, cz) en bas et en
   * (cx + dx, cz + dz) en haut ; r1 = 0 : une pointe. `fermer` pose un couvercle plat sur le haut.
   */
  tronc(n: number, y0: number, r0: number, y1: number, r1: number, teinte: number, cx = 0, cz = 0, dx = 0, dz = 0, fermer = false): this {
    const bas = (i: number): [number, number, number] => [cx + r0 * Math.cos((2 * Math.PI * i) / n), y0, cz + r0 * Math.sin((2 * Math.PI * i) / n)];
    const haut = (i: number): [number, number, number] => [cx + dx + r1 * Math.cos((2 * Math.PI * i) / n), y1, cz + dz + r1 * Math.sin((2 * Math.PI * i) / n)];
    for (let i = 0; i < n; i += 1) {
      const a0 = bas(i);
      const b0 = bas(i + 1);
      const a1 = haut(i);
      const b1 = haut(i + 1);
      if (r1 === 0) this.triangle(teinte, ...a0, ...a1, ...b0);
      else {
        this.triangle(teinte, ...a0, ...b1, ...b0);
        this.triangle(teinte, ...a0, ...a1, ...b1);
      }
      if (fermer && r1 > 0) this.triangle(teinte, cx + dx, y1, cz + dz, ...b1, ...a1);
    }
    return this;
  }

  geometrie(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.teintes, 3));
    g.computeVertexNormals();
    return g;
  }
}

const FEUILLE = 1;
const BOIS = 0.45;

/** Touffe de lames : `n` pointes à 4 côtés, les unes plus hautes, penchées vers l'extérieur. */
function lames(n: number, anneau: number, largeur: number, penche: number, hauteurs: readonly number[]): Facettes {
  const f = new Facettes();
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    const h = hauteurs[i % hauteurs.length] ?? 1;
    f.tronc(4, 0, largeur, h, 0, FEUILLE, anneau * Math.cos(a), anneau * Math.sin(a), penche * h * Math.cos(a), penche * h * Math.sin(a));
  }
  return f;
}

/** Les sept silhouettes, sur un pas de 1 m de haut (l'échelle verticale de l'instance est la hauteur du jour). */
const CONSTRUCTEURS: Readonly<Record<FormePlant, () => Facettes>> = {
  // Tuteur de bois et feuillage étagé qui se resserre vers le haut.
  'erige-tuteure': () => new Facettes().tronc(4, 0, 0.04, 1, 0.04, BOIS).tronc(8, 0.06, 0.5, 0.4, 0.45, FEUILLE).tronc(8, 0.4, 0.45, 0.75, 0.3, FEUILLE).tronc(8, 0.75, 0.3, 1, 0, FEUILLE),
  // Rosette basse et large : le cœur monte en pointe.
  rosette: () => new Facettes().tronc(14, 0, 0.5, 0.4, 0.42, FEUILLE).tronc(14, 0.4, 0.42, 1, 0, FEUILLE),
  touffe: () => lames(12, 0.12, 0.09, 0.35, [1, 0.8, 0.9]),
  // Trois lobes bas qui s'étalent.
  rampant: () => {
    const f = new Facettes();
    for (let i = 0; i < 3; i += 1) {
      const a = (2 * Math.PI * i) / 3;
      f.tronc(6, 0, 0.22, 1, 0.12, FEUILLE, 0.28 * Math.cos(a), 0.28 * Math.sin(a), 0, 0, true);
    }
    return f;
  },
  // Dôme dense.
  buisson: () => new Facettes().tronc(10, 0, 0.5, 0.5, 0.45, FEUILLE).tronc(10, 0.5, 0.45, 1, 0.25, FEUILLE, 0, 0, 0, 0, true),
  // Couronne de feuillage posée haut : la structure (poteau et traverse) est dessinée à part.
  'arbre-ou-liane': () => new Facettes().tronc(10, 0.3, 0.5, 0.7, 0.5, FEUILLE).tronc(10, 0.7, 0.5, 1, 0.3, FEUILLE, 0, 0, 0, 0, true),
  // Fanes courtes d'une racine ou d'un bulbe.
  'bulbe-ou-racine': () => lames(10, 0.1, 0.07, 0.25, [1, 0.75]),
};

export function geometriePlant(forme: FormePlant): BufferGeometry {
  return CONSTRUCTEURS[forme]().geometrie();
}

/** Poteau et traverse (pergola du kiwi, pieds de la gouttière) : 1 m de haut, traverse de 1 m en haut. */
export function geometrieStructure(): BufferGeometry {
  const f = new Facettes().tronc(4, 0, 0.05, 1, 0.05, BOIS, 0, 0, 0, 0, true);
  // Traverse : un prisme à 4 côtés couché, de longueur 1 selon x, dessiné comme un poteau très aplati vers le haut.
  const t = new Facettes().tronc(4, 0.96, 0.5, 1, 0.5, BOIS, 0, 0, 0, 0, true);
  f.positions.push(...t.positions);
  f.teintes.push(...t.teintes);
  return f.geometrie();
}

/** Triangles d'une géométrie (sans indice : trois sommets chacun). */
export function trianglesDe(g: BufferGeometry): number {
  return g.getAttribute('position').count / 3;
}

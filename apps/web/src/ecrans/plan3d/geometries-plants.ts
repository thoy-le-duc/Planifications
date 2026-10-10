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

  triangle(teinte: number, ...p: readonly number[]): void {
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

  /**
   * Sphère (ou, à peu de bandes, double pyramide) de rayon `r` à `seg` méridiens et `anneaux` bandes de latitude (pôles sur l'axe y) :
   * 2 × seg × (anneaux − 1) triangles, tournés vers l'extérieur.
   */
  sphere(seg: number, anneaux: number, r: number, teinte: number): this {
    const sommet = (i: number, j: number): [number, number, number] => {
      const theta = (Math.PI * i) / anneaux;
      const phi = (2 * Math.PI * j) / seg;
      return [r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi)];
    };
    for (let j = 0; j < seg; j += 1) {
      for (let i = 0; i < anneaux; i += 1) {
        const a = sommet(i, j);
        const b = sommet(i, j + 1);
        const c = sommet(i + 1, j);
        const d = sommet(i + 1, j + 1);
        if (i > 0) this.triangle(teinte, ...a, ...b, ...c);
        if (i < anneaux - 1) this.triangle(teinte, ...b, ...d, ...c);
      }
    }
    return this;
  }

  /**
   * Haie : un profil (y, demi-largeur) extrudé sur `baies` tronçons le long de x (de −0,5 à 0,5),
   * des deux côtés de z ; les bouts restent ouverts (les haies se touchent bout à bout).
   */
  haie(baies: number, profil: readonly (readonly [number, number])[], teinte: number): this {
    for (let b = 0; b < baies; b += 1) {
      const x0 = -0.5 + b / baies;
      const x1 = x0 + 1 / baies;
      for (let k = 0; k + 1 < profil.length; k += 1) {
        const [yl = 0, wl = 0] = profil[k] ?? [];
        const [yu = 0, wu = 0] = profil[k + 1] ?? [];
        for (const cote of [1, -1]) {
          const a: [number, number, number] = [x0, yl, cote * wl];
          const c: [number, number, number] = [x1, yl, cote * wl];
          const d: [number, number, number] = [x1, yu, cote * wu];
          const e: [number, number, number] = [x0, yu, cote * wu];
          if (cote === 1) {
            this.triangle(teinte, ...a, ...c, ...d);
            this.triangle(teinte, ...a, ...d, ...e);
          } else {
            this.triangle(teinte, ...a, ...d, ...c);
            this.triangle(teinte, ...a, ...e, ...d);
          }
        }
      }
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
  // Haie palissée sur sa ficelle : un tronçon de rang (de 1 m de long à l'échelle 1), qui se resserre vers le haut.
  'erige-tuteure': () =>
    new Facettes().haie(4, [[0.04, 0.5], [0.4, 0.47], [0.75, 0.3], [1, 0.08]], FEUILLE),
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

/**
 * Fruit, balise et tuteur (T32e) : une double pyramide à 4 côtés (un octaèdre) de 1 m de haut et de large,
 * posée sur son pied (y de 0 à 1), blanche (la couleur de l'instance la teinte), 8 triangles seulement :
 * les fruits se comptent par centaines et les garde-fous de dessin (BORNES_DEMO) plafonnent les appels de dessin
 * et les triangles de la scène. L'échelle de l'instance donne la forme : courgette en fuseau, tomate ramassée,
 * tuteur en fuseau très fin et haut, balise grande et vive (symétrique : lisible sous tous les angles). Une seule
 * géométrie pour les trois : un seul InstancedMesh, donc un seul appel de dessin, porte tuteurs, fruits et balises.
 */
export function geometrieFruit(): BufferGeometry {
  return new Facettes().sphere(4, 2, 0.5, FEUILLE).geometrie().translate(0, 0.5, 0);
}

/** Tuteur d'un plant (tige ou ficelle tendue) : la même double pyramide, étirée par l'échelle de l'instance. */
export function geometrieTuteur(): BufferGeometry {
  return geometrieFruit();
}

/** Triangles d'une géométrie (sans indice : trois sommets chacun). */
export function trianglesDe(g: BufferGeometry): number {
  return g.getAttribute('position').count / 3;
}

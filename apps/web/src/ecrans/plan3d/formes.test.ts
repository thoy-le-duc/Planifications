/**
 * T28c — formes de la vue 3D : le sol extrudé d'un contour en L garde sa forme (aire, sommets),
 * les géométries partagées sont celles qu'on attend. three seul, sans navigateur ni WebGL.
 */
import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { empreinteDe, geometrieArceau, geometrieBache, geometrieBout, geometriePlanche, geometrieSol, geometrieToit } from './formes.ts';
import type { SocleScene } from './scene.ts';

const L = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 20, z: -10 },
  { x: 10, z: -10 },
  { x: 10, z: -30 },
  { x: 0, z: -30 },
];

/** Aire des triangles dont les trois sommets sont à y = 0 (le dessus). */
function aireDuDessus(positions: ArrayLike<number>): number {
  let aire = 0;
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const y = [positions[i + 1], positions[i + 4], positions[i + 7]];
    if (y.some((v) => v !== 0)) continue;
    const [ax = 0, az = 0, bx = 0, bz = 0, cx = 0, cz = 0] = [positions[i], positions[i + 2], positions[i + 3], positions[i + 5], positions[i + 6], positions[i + 8]];
    // Les flancs ont deux sommets à y = 0 et un dessous : seuls les triangles entièrement à 0 sont des faces du dessus.
    aire += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  return aire;
}

describe('T28c : sol extrudé depuis le polygone', () => {
  it('un L de 400 m² garde ses 400 m² (triangulation concave, pas sa boîte englobante de 600 m²)', () => {
    const g = geometrieSol([L], 0.2);
    expect(aireDuDessus(g.getAttribute('position').array)).toBeCloseTo(400, 6);
  });

  it('plusieurs zones : une seule géométrie, les aires s’additionnent', () => {
    const carre = [
      { x: 50, z: 0 },
      { x: 60, z: 0 },
      { x: 60, z: 10 },
      { x: 50, z: 10 },
    ];
    const g = geometrieSol([L, carre], 0.2);
    expect(aireDuDessus(g.getAttribute('position').array)).toBeCloseTo(500, 6);
  });

  it('un socle sans contour a pour empreinte son rectangle tourné, un socle à contour son contour', () => {
    const base: SocleScene = { id: 'z', nom: 'Z', x: 10, z: 5, largeur: 4, profondeur: 20, angle: -Math.PI / 2, contour: null, placee: true, batimentId: 'b' };
    const coins = empreinteDe(base);
    expect(coins).toHaveLength(4);
    const xs = coins.map((c) => c.x);
    const zs = coins.map((c) => c.z);
    // Serre tournée d’un quart de tour : la longueur (20 m) court selon x.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(20, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(4, 6);
    expect(empreinteDe({ ...base, contour: L, angle: 0 })).toBe(L);
  });
});

describe('T28c : géométries partagées', () => {
  it('l’arceau est un demi-cercle de rayon 0,5 au-dessus du sol', () => {
    const g = geometrieArceau();
    g.computeBoundingBox();
    expect(g.boundingBox?.min.y ?? 1).toBeGreaterThanOrEqual(-0.01);
    expect(g.boundingBox?.max.y ?? 0).toBeCloseTo(0.508, 3);
    expect(g.boundingBox?.max.x ?? 0).toBeCloseTo(0.508, 3);
  });

  it('la bâche est un demi-cylindre d’axe z, de longueur 1, qui ne descend pas sous le sol', () => {
    const g = geometrieBache();
    g.computeBoundingBox();
    expect(g.boundingBox?.min.z ?? 0).toBeCloseTo(-0.5, 6);
    expect(g.boundingBox?.max.z ?? 0).toBeCloseTo(0.5, 6);
    expect(g.boundingBox?.min.y ?? -1).toBeGreaterThanOrEqual(-1e-6);
    expect(g.boundingBox?.max.y ?? 0).toBeCloseTo(0.5, 6);
    expect(g.boundingBox?.max.x ?? 0).toBeCloseTo(0.5, 6);
    expect(g.boundingBox?.min.x ?? 0).toBeCloseTo(-0.5, 6);
  });

  it('le bout et le toit tiennent dans leur boîte unité', () => {
    const bout = geometrieBout();
    bout.computeBoundingBox();
    expect(bout.boundingBox?.max.y ?? 0).toBeCloseTo(0.5, 6);
    const toit = geometrieToit();
    toit.computeBoundingBox();
    expect(toit.boundingBox?.min.y ?? 1).toBe(0);
    expect(toit.boundingBox?.max.y ?? 0).toBe(1);
    expect(toit.boundingBox?.max.z ?? 0).toBe(0.5);
  });
});

/**
 * T29b — la planche n'a pas de face du dessous. Mesure : le rendu logiciel (SwiftShader) pèse
 * sur chaque triangle, et la face du dessous d'une planche posée sur le sol ne se voit jamais
 * (la caméra reste au-dessus du sol). 5 faces au lieu de 6 : 10 triangles au lieu de 12, sans
 * rien changer à la vue de dessus ni de côté. Même boîte unité centrée que `BoxGeometry`, donc
 * mêmes matrices d'instance (Vue3d.tsx).
 */
describe('T29b : géométrie d’une planche', () => {
  interface Face {
    readonly normale: readonly [number, number, number];
    readonly aire: number;
  }

  /** Les triangles de la géométrie (indexée ou non), avec leur normale (sens de l'enroulement) et leur aire. */
  function faces(g: BufferGeometry): Face[] {
    const pos = g.getAttribute('position').array;
    const index = g.getIndex();
    const nb = index === null ? pos.length / 9 : index.count / 3;
    const sommet = (k: number): [number, number, number] => {
      const i = index === null ? k : index.getX(k);
      return [pos[3 * i] ?? 0, pos[3 * i + 1] ?? 0, pos[3 * i + 2] ?? 0];
    };
    const resultat: Face[] = [];
    for (let t = 0; t < nb; t += 1) {
      const [a, b, c] = [sommet(3 * t), sommet(3 * t + 1), sommet(3 * t + 2)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] as const;
      const longueur = Math.hypot(n[0], n[1], n[2]);
      resultat.push({ normale: [n[0] / longueur, n[1] / longueur, n[2] / longueur], aire: longueur / 2 });
    }
    return resultat;
  }

  const aireVers = (fs: readonly Face[], axe: 0 | 1 | 2, sens: 1 | -1): number => fs.filter((f) => f.normale[axe] * sens > 0.99).reduce((total, f) => total + f.aire, 0);

  it('au plus 10 triangles (12 pour un cube complet)', () => {
    expect(faces(geometriePlanche()).length).toBeLessThanOrEqual(10);
  });

  it('aucune face ne regarde vers le bas', () => {
    const fs = faces(geometriePlanche());
    expect(fs.filter((f) => f.normale[1] < -0.5)).toEqual([]);
  });

  it('le dessus et les quatre côtés sont intacts : une face unité chacun, tournée vers l’extérieur', () => {
    const fs = faces(geometriePlanche());
    expect(aireVers(fs, 1, 1)).toBeCloseTo(1, 6);
    expect(aireVers(fs, 0, 1)).toBeCloseTo(1, 6);
    expect(aireVers(fs, 0, -1)).toBeCloseTo(1, 6);
    expect(aireVers(fs, 2, 1)).toBeCloseTo(1, 6);
    expect(aireVers(fs, 2, -1)).toBeCloseTo(1, 6);
    // Rien d'autre : l'aire totale est celle des cinq faces.
    expect(fs.reduce((total, f) => total + f.aire, 0)).toBeCloseTo(5, 6);
  });

  it('même boîte unité centrée que BoxGeometry : les matrices d’instance ne changent pas', () => {
    const g = geometriePlanche();
    g.computeBoundingBox();
    expect(g.boundingBox?.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
    expect(g.boundingBox?.max.toArray()).toEqual([0.5, 0.5, 0.5]);
  });

  it('les normales d’ombrage suivent les faces (éclairage identique au cube)', () => {
    const g = geometriePlanche();
    const n = g.getAttribute('normal');
    expect(n.count).toBe(g.getAttribute('position').count);
    for (let i = 0; i < n.count; i += 1) {
      expect(Math.abs(n.getX(i)) + Math.abs(n.getY(i)) + Math.abs(n.getZ(i))).toBeCloseTo(1, 6);
      expect(n.getY(i)).toBeGreaterThanOrEqual(0);
    }
  });
});

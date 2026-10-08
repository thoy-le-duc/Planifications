/**
 * T28c — formes de la vue 3D : le sol extrudé d'un contour en L garde sa forme (aire, sommets),
 * les géométries partagées sont celles qu'on attend. three seul, sans navigateur ni WebGL.
 */
import { describe, expect, it } from 'vitest';
import { empreinteDe, geometrieArceau, geometrieBache, geometrieBout, geometrieSol, geometrieToit } from './formes.ts';
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

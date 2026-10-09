/**
 * T32b — géométries partagées des plants : le nombre de triangles annoncé par l'adaptateur
 * (TRIANGLES_PAR_FORME) est celui des géométries, elles tiennent dans 1 m de haut et 1 m de large,
 * et leurs faces regardent vers l'extérieur. three seul, sans navigateur ni WebGL.
 */
import { describe, expect, it } from 'vitest';
import { FORMES_PLANT } from '@planif/core/croissance';
import { geometriePlant, geometrieStructure, trianglesDe } from './geometries-plants.ts';
import { TRIANGLES_PAR_FORME } from './plants.ts';

describe('T32b : géométries des plants', () => {
  it.each(FORMES_PLANT)('forme %s : triangles annoncés = triangles dessinés, dans 1 m × 1 m (carré de 1 m de côté)', (forme) => {
    const g = geometriePlant(forme);
    expect(trianglesDe(g)).toBe(TRIANGLES_PAR_FORME[forme]);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 1) {
      expect(p.getY(i)).toBeGreaterThanOrEqual(-1e-9);
      expect(p.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.abs(p.getZ(i))).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    expect(g.getAttribute('color').count).toBe(p.count);
  });

  it.each(FORMES_PLANT)('forme %s : les faces regardent vers l’extérieur (au moins 90 % des normales)', (forme) => {
    const g = geometriePlant(forme);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    // Pour une silhouette à peu près convexe autour de son axe, la normale d'une face a une composante radiale ou vers le haut positive.
    let dehors = 0;
    for (let i = 0; i < p.count; i += 1) {
      const radial = p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i);
      if (radial > -1e-9 || n.getY(i) > 0) dehors += 1;
    }
    expect(dehors / p.count).toBeGreaterThanOrEqual(0.9);
  });

  it('la structure (poteau et traverse) est légère', () => {
    expect(trianglesDe(geometrieStructure())).toBeLessThanOrEqual(40);
  });
});

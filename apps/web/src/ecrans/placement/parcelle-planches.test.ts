/**
 * Tests d'acceptation T85 — de la parcelle calculée par le cœur au contour et aux placements écrits
 * (docs/backlog/T85-parcelle-depuis-planches.md, règles 3 et 4). Repère de la ferme : x est, y nord.
 *
 * Exemple chiffré à la main : 3 planches de 30 × 0,75 m, passe-pied 45 cm, au centre (100 ; 200) :
 * rectangle 3,15 m (est-ouest) × 30 m, de (98,425 ; 185) à (101,575 ; 215), sens antihoraire (sud-ouest,
 * sud-est, nord-est, nord-ouest). Plus long côté nord-sud : cap 0°. Centres des planches (98,8 ; 200),
 * (100 ; 200), (101,2 ; 200), soit (−1,2 ; 0), (0 ; 0), (1,2 ; 0) dans le repère de la zone, cap 0°.
 */
import { describe, expect, it } from 'vitest';
import { depuisRepereZone } from './coeur.ts';
import type { EmplacementEnService } from './donnees.ts';
import { preparerParcelle } from './parcelle-planches.ts';

const emp = (code: string, longueurM: number, largeurM: number | null, placement: EmplacementEnService['placement'] = null): EmplacementEnService => ({
  id: `id-${code}`,
  zoneId: 'z',
  code,
  longueurM,
  largeurM,
  placement,
});
const TROIS = [emp('P1', 30, 0.75), emp('P2', 30, 0.75), emp('P3', 30, 0.75)];
const CENTRE = { x: 100, y: 200 };

describe('T85 : preparerParcelle', () => {
  it('exemple chiffré : contour 3,15 × 30 m autour de (100 ; 200), planches à −1,2 ; 0 ; +1,2 m, cap 0°', () => {
    const r = preparerParcelle('z', TROIS, 45, CENTRE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contour).toEqual([
      { x: 98.425, y: 185 },
      { x: 101.575, y: 185 },
      { x: 101.575, y: 215 },
      { x: 98.425, y: 215 },
    ]);
    expect(r.calage.centre.x).toBeCloseTo(100, 6);
    expect(r.calage.centre.y).toBeCloseTo(200, 6);
    expect(r.calage.orientationDeg).toBeCloseTo(0, 6);
    expect(r.planches.map((p) => p.id)).toEqual(['id-P1', 'id-P2', 'id-P3']);
    expect(r.planches.map((p) => p.placement)).toEqual([
      { x: -1.2, y: 0, orientation_deg: 0 },
      { x: 0, y: 0, orientation_deg: 0 },
      { x: 1.2, y: 0, orientation_deg: 0 },
    ]);
    for (const p of r.planches) {
      expect(p.zoneId).toBe('z');
      expect(p.longueurM).toBe(30);
      expect(p.largeurM).toBe(0.75);
    }
  });

  it('passe-pied 100 cm : 3 × 0,75 + 2 × 1 = 4,25 m de large', () => {
    const r = preparerParcelle('z', TROIS, 100, CENTRE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const xs = r.contour.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.25, 6);
    expect(r.planches.map((p) => p.placement.x)).toEqual([-1.75, 0, 1.75]);
  });

  it('un emplacement déjà placé est rangé comme les autres ; sans largeur : 0,80 m', () => {
    const r = preparerParcelle('z', [emp('P1', 10, null, { x: 7, y: 3, orientation_deg: 45 }), emp('P2', 10, 0.5)], 0, CENTRE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.planches[0]?.largeurM).toBe(0.8);
    expect(r.planches[0]?.placement).toEqual({ x: -0.25, y: 0, orientation_deg: 0 });
    expect(r.planches[1]?.placement).toEqual({ x: 0.4, y: 0, orientation_deg: 0 });
  });

  it('rectangle plus large que long : le repère de la zone tourne, les planches restent au même endroit du terrain, cap nord', () => {
    // 2 planches de 1 m × 2 m, jointives : rectangle 4 m (est-ouest) × 1 m ; plus long côté est-ouest, cap 90°.
    const r = preparerParcelle('z', [emp('P1', 1, 2), emp('P2', 1, 2)], 0, CENTRE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calage.orientationDeg).toBeCloseTo(90, 6);
    const attendus = [
      { x: 99, y: 200 },
      { x: 101, y: 200 },
    ];
    r.planches.forEach((p, i) => {
      const abs = depuisRepereZone(r.calage, p.placement);
      expect(abs.x).toBeCloseTo(attendus[i]?.x ?? 0, 6);
      expect(abs.y).toBeCloseTo(attendus[i]?.y ?? 0, 6);
      expect((r.calage.orientationDeg + p.placement.orientation_deg + 360) % 360).toBeCloseTo(0, 6);
    });
  });

  it('refus : passe-pied invalide, aucun emplacement, parcelle trop petite pour le cœur', () => {
    const a = preparerParcelle('z', TROIS, 501, CENTRE);
    expect(a.ok).toBe(false);
    const b = preparerParcelle('z', [], 45, CENTRE);
    expect(b.ok).toBe(false);
    const c = preparerParcelle('z', [emp('P1', 0.1, 0.5)], 45, CENTRE);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.message.length).toBeGreaterThan(0);
  });
});

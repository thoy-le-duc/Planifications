/**
 * Tests d'acceptation T81 — rectangle englobant de surface minimale d'un contour tracé à la main
 * (docs/backlog/T81-placer-serre-depuis-zone.md, règle 4). Pur : mètres du repère de la ferme.
 *
 * Exemple chiffré à la main. Axe de la longueur eu = (0,6 ; 0,8) (cap atan2(0,6 ; 0,8) =
 * 36,8699°), axe de la largeur ev = (0,8 ; −0,6), centre (100 ; 50). Quatre sommets « de travers »,
 * en coordonnées (a le long de eu, b le long de ev) : (−15 ; −4) (15 ; −4) (14 ; 4) (−14 ; 4).
 * Dans le repère de la ferme : point = centre + a·eu + b·ev :
 *   (−15 ; −4) → (100 − 9 − 3,2 ; 50 − 12 + 2,4) = (87,8 ; 40,4)
 *   (15 ; −4)  → (100 + 9 − 3,2 ; 50 + 12 + 2,4) = (105,8 ; 64,4)
 *   (14 ; 4)   → (100 + 8,4 + 3,2 ; 50 + 11,2 − 2,4) = (111,6 ; 58,8)
 *   (−14 ; 4)  → (100 − 8,4 + 3,2 ; 50 − 11,2 − 2,4) = (94,8 ; 36,4)
 * Les deux grands côtés sont parallèles : le rectangle de surface minimale a un côté sur le
 * grand côté, a ∈ [−15 ; 15], b ∈ [−4 ; 4] : centre (100 ; 50), longueur 30, largeur 8 (240 m²,
 * contre 424 m² et plus pour les autres directions des côtés), cap 36,8699°.
 */
import { describe, expect, it } from 'vitest';
import { rectangleEnglobantMinimal } from '@planif/core/placement';

const CAP = (Math.atan2(0.6, 0.8) * 180) / Math.PI;
const TRAVERS_ANTIHORAIRE = [
  { x: 94.8, y: 36.4 },
  { x: 111.6, y: 58.8 },
  { x: 105.8, y: 64.4 },
  { x: 87.8, y: 40.4 },
] as const;

describe('T81 : rectangle englobant minimal', () => {
  it('contour de 4 sommets de travers : centre (100 ; 50), 30 m × 8 m, cap 36,87°', () => {
    const r = rectangleEnglobantMinimal(TRAVERS_ANTIHORAIRE);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.centre.x).toBeCloseTo(100, 6);
    expect(r.centre.y).toBeCloseTo(50, 6);
    expect(r.longueurM).toBeCloseTo(30, 6);
    expect(r.largeurM).toBeCloseTo(8, 6);
    expect(r.orientationDeg).toBeCloseTo(CAP, 6);
  });

  it('même résultat quel que soit le sens du tracé et le premier sommet', () => {
    const horaire = [...TRAVERS_ANTIHORAIRE].reverse();
    const decale = [...TRAVERS_ANTIHORAIRE.slice(2), ...TRAVERS_ANTIHORAIRE.slice(0, 2)];
    for (const contour of [horaire, decale]) {
      const r = rectangleEnglobantMinimal(contour);
      expect(r?.centre.x).toBeCloseTo(100, 6);
      expect(r?.centre.y).toBeCloseTo(50, 6);
      expect(r?.longueurM).toBeCloseTo(30, 6);
      expect(r?.largeurM).toBeCloseTo(8, 6);
      expect(r?.orientationDeg).toBeCloseTo(CAP, 6);
    }
  });

  it('rectangle droit est-ouest 40 m × 10 m : cap 90° (axe de la longueur vers l’est)', () => {
    const r = rectangleEnglobantMinimal([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(r?.centre.x).toBeCloseTo(20, 9);
    expect(r?.centre.y).toBeCloseTo(5, 9);
    expect(r?.longueurM).toBeCloseTo(40, 9);
    expect(r?.largeurM).toBeCloseTo(10, 9);
    expect(r?.orientationDeg).toBeCloseTo(90, 6);
  });

  it('rectangle nord-sud : cap 0° ; le cap reste dans [0 ; 180[', () => {
    const r = rectangleEnglobantMinimal([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 40 },
      { x: 0, y: 40 },
    ]);
    expect(r?.longueurM).toBeCloseTo(40, 9);
    expect(r?.orientationDeg).toBeCloseTo(0, 6);
    for (const k of [0, 45, 100, 170, 250, 359]) {
      const t = (k * Math.PI) / 180;
      const eu = { x: Math.sin(t), y: Math.cos(t) };
      const ev = { x: Math.cos(t), y: -Math.sin(t) };
      const coin = (a: number, b: number) => ({ x: 10 + a * eu.x + b * ev.x, y: 20 + a * eu.y + b * ev.y });
      const q = rectangleEnglobantMinimal([coin(-12, -3), coin(12, -3), coin(12, 3), coin(-12, 3)]);
      expect(q?.orientationDeg ?? -1).toBeGreaterThanOrEqual(0);
      expect(q?.orientationDeg ?? 360).toBeLessThan(180);
      expect(q?.longueurM).toBeCloseTo(24, 6);
      expect(q?.largeurM).toBeCloseTo(6, 6);
      expect(q?.centre.x).toBeCloseTo(10, 6);
      expect(q?.centre.y).toBeCloseTo(20, 6);
    }
  });

  it('triangle rectangle 3-4-5 (0,0) (4,0) (0,3) : aire du rectangle minimal 12 m² (4 × 3, 5 × 2,4 ou 3 × 4)', () => {
    const r = rectangleEnglobantMinimal([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ]);
    // Les trois directions de côté donnent la même aire (le double de celle du triangle) : seule l'aire est fixée.
    expect((r?.longueurM ?? 0) * (r?.largeurM ?? 0)).toBeCloseTo(12, 6);
  });

  it('contour en L (T28a) : boîte alignée sur les axes, 20 m × 30 m, centre (10 ; 15), cap 0°', () => {
    const r = rectangleEnglobantMinimal([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ]);
    expect((r?.longueurM ?? 0) * (r?.largeurM ?? 0)).toBeCloseTo(600, 6);
    expect(r?.centre.x).toBeCloseTo(10, 6);
    expect(r?.centre.y).toBeCloseTo(15, 6);
    expect(r?.longueurM).toBeCloseTo(30, 6);
    expect(r?.largeurM).toBeCloseTo(20, 6);
    expect(r?.orientationDeg).toBeCloseTo(0, 6);
  });

  it('moins de 3 sommets ou sommets alignés : null', () => {
    expect(rectangleEnglobantMinimal([])).toBeNull();
    expect(rectangleEnglobantMinimal([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(rectangleEnglobantMinimal([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
  });

  it('ne modifie pas son argument', () => {
    const copie = structuredClone(TRAVERS_ANTIHORAIRE);
    rectangleEnglobantMinimal(TRAVERS_ANTIHORAIRE);
    expect(TRAVERS_ANTIHORAIRE).toEqual(copie);
  });
});

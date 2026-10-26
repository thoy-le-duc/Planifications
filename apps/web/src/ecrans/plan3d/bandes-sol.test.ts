/**
 * T86 — la limite au sol entre deux bandes d'une serre est posée dans la géométrie du sol (même appel de dessin : le budget des
 * appels de la vue 3D est à 9 sur téléphone). Calcul à la main : bandes de 4 × 40 m à 0°, centres x = 48 et 52, z = −30 ;
 * la limite de la bande 2 est son bord ouest, x = 52 − 2 = 50, un trait de 0,12 × 40 m (x de 49,94 à 50,06, z de −50 à −10).
 */
import { describe, expect, it } from 'vitest';
import { geometrieSol, limitesDeBandes } from './formes.ts';
import type { BandeScene } from './scene.ts';

const bande = (rang: number, x: number): BandeScene => ({ id: `b${String(rang)}`, nom: `B${String(rang)}`, batimentId: 'S', rang, total: 2, x, z: -30, largeur: 4, profondeur: 40, angle: 0 });

describe('T86 : limites de bandes au sol', () => {
  it('une limite par bande sauf la première, sur son bord de x local négatif', () => {
    const l = limitesDeBandes([bande(1, 48), bande(2, 52)]);
    expect(l).toHaveLength(1);
    const xs = (l[0] ?? []).map((p) => p.x);
    const zs = (l[0] ?? []).map((p) => p.z);
    expect(Math.min(...xs)).toBeCloseTo(49.94, 6);
    expect(Math.max(...xs)).toBeCloseTo(50.06, 6);
    expect(Math.min(...zs)).toBeCloseTo(-50, 6);
    expect(Math.max(...zs)).toBeCloseTo(-10, 6);
  });

  it('tournée de 90° : la limite suit la serre', () => {
    const l = limitesDeBandes([{ ...bande(2, 50), angle: -Math.PI / 2 }]);
    // bord ouest local tourné : centre (50 − 2·cos, −30 + 2·sin(−90°)) = (50 ; −32)
    const c = { x: (l[0] ?? []).reduce((s, p) => s + p.x, 0) / 4, z: (l[0] ?? []).reduce((s, p) => s + p.z, 0) / 4 };
    expect(c.x).toBeCloseTo(50, 6);
    expect(c.z).toBeCloseTo(-32, 6);
  });

  it('le sol porte une couleur par sommet seulement s’il y a des limites', () => {
    const carre = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    expect(geometrieSol([carre], 0.1).hasAttribute('color')).toBe(false);
    const g = geometrieSol([carre], 0.1, limitesDeBandes([bande(2, 5)]));
    expect(g.hasAttribute('color')).toBe(true);
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
  });
});

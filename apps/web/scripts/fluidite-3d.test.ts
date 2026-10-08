/**
 * T29b — seuil d'un intervalle fautif des e2e 3D : max(58,3 ms ; 2 × plancher mesuré), plafonné à
 * 100 ms (sinon une machine saturée relèverait le seuil jusqu'à ne plus rien voir).
 */
import { describe, expect, it } from 'vitest';
import { PLANCHER_MAX_MS, SEUIL_FAUTIF_PLAFOND_MS, seuilFautif } from '../e2e/fluidite-3d.ts';

describe('T29b : seuilFautif', () => {
  it('plancher rapide : le seuil historique de T27 (plus de 2 images perdues, 58,3 ms)', () => {
    expect(seuilFautif(10, 2)).toBeCloseTo(58.33, 1);
    expect(seuilFautif(16.7, 2)).toBeCloseTo(58.33, 1);
  });

  it('plancher lent : 2 × plancher', () => {
    expect(seuilFautif(40, 2)).toBe(80);
  });

  it('plancher très lent : plafonné à 100 ms', () => {
    expect(seuilFautif(500, 2)).toBe(100);
    expect(SEUIL_FAUTIF_PLAFOND_MS).toBe(100);
  });

  it('le test refuse de juger au-delà de 40 ms de plancher', () => {
    expect(PLANCHER_MAX_MS).toBe(40);
  });
});

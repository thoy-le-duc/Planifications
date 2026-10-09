/**
 * T34 — marge de durée des vols de caméra, déduite du plancher mesuré (même principe que T29b).
 *
 * API à créer dans apps/web/e2e/fluidite-3d.ts (fonctions pures, sans Playwright) :
 *
 *   export const MARGE_VOL_MIN_MS = 100;   // marge historique : jamais plus stricte qu'avant
 *   export const MARGE_VOL_MAX_MS = ...;   // plafond nommé, au plus 200
 *   export function margeVolMs(plancherMs: number): number;
 *     // = min(MARGE_VOL_MAX_MS, MARGE_VOL_MIN_MS + 3 × plancherMs).
 *     // Erreur explicite si plancherMs n'est pas un nombre fini positif (mesure absente)
 *     // ou si plancherMs > PLANCHER_MAX_MS (machine trop lente, pas de tolérance cachée).
 *   export function messageDureeVol(dureeMs: number, plancherMs: number, margeMs: number, dureeVolMaxMs: number): string;
 *     // contient : durée arrondie à la ms, plancher à 0,1 ms, marge arrondie à la ms, borne (vol + marge).
 */
import { describe, expect, it } from 'vitest';
import { MARGE_VOL_MAX_MS, MARGE_VOL_MIN_MS, PLANCHER_MAX_MS, margeVolMs, messageDureeVol } from '../e2e/fluidite-3d.ts';

describe('T34 : margeVolMs', () => {
  it('constantes : plancher historique 100 ms, plafond nommé d’au plus 200 ms', () => {
    expect(MARGE_VOL_MIN_MS).toBe(100);
    expect(MARGE_VOL_MAX_MS).toBeGreaterThanOrEqual(MARGE_VOL_MIN_MS);
    expect(MARGE_VOL_MAX_MS).toBeLessThanOrEqual(200);
  });

  it('machine rapide : proche de la marge actuelle (100 ms)', () => {
    expect(margeVolMs(0.001)).toBeCloseTo(100, 1);
    expect(margeVolMs(1)).toBe(103);
  });

  it('100 ms + 3 × plancher : plancher 10 ms → 130 ms, 16,7 ms → 150,1 ms, 30 ms → 190 ms', () => {
    expect(margeVolMs(10)).toBe(130);
    expect(margeVolMs(16.7)).toBeCloseTo(150.1, 5);
    expect(margeVolMs(30)).toBe(190);
  });

  it('plafonnée : plancher 40 ms → 200 ms', () => {
    expect(margeVolMs(PLANCHER_MAX_MS)).toBe(200);
    expect(margeVolMs(34)).toBe(200);
    expect(MARGE_VOL_MAX_MS).toBe(200);
  });

  it('toujours bornée entre le minimum et le plafond, sur tout plancher admis', () => {
    for (let p = 0.5; p <= PLANCHER_MAX_MS; p += 0.5) {
      const m = margeVolMs(p);
      expect(m).toBeGreaterThan(MARGE_VOL_MIN_MS);
      expect(m).toBeLessThanOrEqual(MARGE_VOL_MAX_MS);
      expect(m).toBeCloseTo(Math.min(MARGE_VOL_MAX_MS, MARGE_VOL_MIN_MS + 3 * p), 9);
    }
  });

  it('plancher absent ou non fini : erreur explicite', () => {
    expect(() => margeVolMs(Number.NaN)).toThrow(/plancher/i);
    expect(() => margeVolMs(Number.POSITIVE_INFINITY)).toThrow(/plancher/i);
    expect(() => margeVolMs(Number.NEGATIVE_INFINITY)).toThrow(/plancher/i);
    expect(() => margeVolMs(undefined as unknown as number)).toThrow(/plancher/i);
    expect(() => margeVolMs(0)).toThrow(/plancher/i);
    expect(() => margeVolMs(-3)).toThrow(/plancher/i);
  });

  it('plancher au-delà de la limite de T29b : erreur explicite « trop lente »', () => {
    expect(() => margeVolMs(PLANCHER_MAX_MS + 0.1)).toThrow(/trop (lente|charg)/i);
    expect(() => margeVolMs(500)).toThrow(/plancher/i);
  });
});

describe('T34 : messageDureeVol', () => {
  it('donne la durée, le plancher mesuré, la marge appliquée et la borne', () => {
    const m = messageDureeVol(728.4, 33.3, 100, 600);
    expect(m).toContain('728');
    expect(m).toContain('33.3');
    expect(m).toContain('100');
    expect(m).toContain('700');
  });

  it('suit les valeurs : une autre marge, un autre plancher', () => {
    const m = messageDureeVol(905, 41.2, 183.6, 600);
    expect(m).toContain('905');
    expect(m).toContain('41.2');
    expect(m).toContain('184');
    expect(m).toContain('784');
  });
});

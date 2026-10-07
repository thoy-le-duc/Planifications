import { describe, expect, it } from 'vitest';
import { identifiantNormalise, instantNormalise } from './formats.ts';

describe('T28s : formats communs au serveur et à la porte', () => {
  it('identifiant : UUID ramené en minuscules, le reste refusé', () => {
    expect(identifiantNormalise('0192F0C1-7A6E-7CC3-9B1E-3F6A2D4C5B50')).toBe('0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50');
    for (const v of ['serre-1', '', '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b5', 12, null]) expect(identifiantNormalise(v)).toBeNull();
  });

  it('instant : complet avec fuseau, rendu en ISO UTC ; date seule, sans fuseau, 30 février refusés', () => {
    expect(instantNormalise('2026-10-07T08:00:00+02:00')).toBe('2026-10-07T06:00:00.000Z');
    expect(instantNormalise('2026-10-07T06:00:00.123456+00:00')).toBe('2026-10-07T06:00:00.123Z');
    for (const v of ['demain', '2026-10-07', '2026-10-07T06:00:00', '2026-02-30T06:00:00Z', 0, null]) expect(instantNormalise(v)).toBeNull();
  });
});

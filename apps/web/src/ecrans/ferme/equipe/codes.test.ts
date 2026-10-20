/**
 * Relecture T60 : le code d'un membre (ce que l'équipier dit au gérant pour être lié) désigne UN
 * seul membre de la ferme. Les 4 derniers caractères de l'id suffisent d'ordinaire ; deux membres
 * dont l'id finit pareil auraient le même code, et le gérant lierait peut-être le mauvais compte :
 * leurs codes s'allongent alors jusqu'à se distinguer.
 */
import { describe, expect, it } from 'vitest';
import { codesDesMembres } from './donnees.ts';

describe('codes des membres (relecture T60)', () => {
  it('4 derniers caractères en majuscules quand ils sont uniques', () => {
    const codes = codesDesMembres(['0192f0c1-6060-7000-8000-000000002a3b', '0192f0c1-1313-7000-8000-000000000003']);
    expect([...codes.values()]).toEqual(['2A3B', '0003']);
  });

  it('deux ids qui finissent pareil : codes allongés et distincts', () => {
    const a = '0192f0c1-6060-7000-8000-0000001a2a3b';
    const b = '0192f0c1-6060-7000-8000-0000002b2a3b';
    const c = '0192f0c1-1313-7000-8000-000000000003';
    const codes = codesDesMembres([a, b, c]);
    expect(codes.get(a)).toBe('A2A3B');
    expect(codes.get(b)).toBe('B2A3B');
    expect(codes.get(c)).toBe('0003');
  });

  it('le même id en double ne fait pas une collision', () => {
    const a = '0192f0c1-6060-7000-8000-000000002a3b';
    expect(codesDesMembres([a, a.toUpperCase()]).get(a)).toBe('2A3B');
  });
});

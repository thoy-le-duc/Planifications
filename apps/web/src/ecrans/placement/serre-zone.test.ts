/**
 * Tests d'acceptation T81 — règles pures de « Placer la serre » (docs/backlog/T81-placer-serre-depuis-zone.md,
 * règles 1, 2 et 6) : quelle zone propose une serre, de quel type, et avec quelles mesures de départ.
 */
import { describe, expect, it } from 'vitest';
import { dimensionsParDefaut, typeDeSerrePourZone } from './serre-zone.ts';

describe('T81 : type de serre d’une zone', () => {
  it('tunnel → serre tunnel, serre → serre chapelle', () => {
    expect(typeDeSerrePourZone('tunnel')).toBe('serre_tunnel');
    expect(typeDeSerrePourZone('serre')).toBe('serre_chapelle');
  });
  it('plein champ, hors-sol, inconnu : pas de serre proposée (le contour libre reste)', () => {
    expect(typeDeSerrePourZone('plein_champ')).toBeNull();
    expect(typeDeSerrePourZone('hors_sol')).toBeNull();
    expect(typeDeSerrePourZone(undefined)).toBeNull();
    expect(typeDeSerrePourZone(null)).toBeNull();
  });
});

describe('T81 : mesures de départ', () => {
  const lot = [
    { type: 'serre_tunnel', longueurM: 40, largeurM: 6 },
    { type: 'hangar', longueurM: 20, largeurM: 12 },
    { type: 'serre_chapelle', longueurM: 50, largeurM: 9.6 },
    { type: 'serre_tunnel', longueurM: 35, largeurM: 7 },
  ] as const;
  it('celles du dernier bâtiment du même type', () => {
    expect(dimensionsParDefaut(lot, 'serre_tunnel')).toEqual({ longueurM: 35, largeurM: 7 });
    expect(dimensionsParDefaut(lot, 'serre_chapelle')).toEqual({ longueurM: 50, largeurM: 9.6 });
  });
  it('sinon 30 m × 8 m', () => {
    expect(dimensionsParDefaut([], 'serre_tunnel')).toEqual({ longueurM: 30, largeurM: 8 });
    expect(dimensionsParDefaut(lot.slice(1, 2), 'serre_tunnel')).toEqual({ longueurM: 30, largeurM: 8 });
  });
});

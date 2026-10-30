/**
 * Tests d'acceptation T81 — règles pures de « Placer la serre » (docs/backlog/T81-placer-serre-depuis-zone.md,
 * règles 1, 2 et 6) : quelle zone propose une serre, de quel type, et avec quelles mesures de départ.
 */
import { describe, expect, it } from 'vitest';
import { typeDeSerrePourZone } from './serre-zone.ts';

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

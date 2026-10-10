/**
 * T28k — rotation par pas (boutons « Tourner −5° / +5° ») et par les deux doigts : `tournerDe`,
 * en fonction pure. Le cap reste dans [0, 360[, le centre et les dimensions ne bougent pas.
 */
import { describe, expect, it } from 'vitest';
import { tournerDe, type RectanglePlace } from './gestes.ts';

const SERRE: RectanglePlace = { centre: { x: 40, y: 40 }, orientationDeg: 0, longueurM: 40, largeurM: 8 };

describe('T28k : tournerDe', () => {
  it('+5° puis −5° ramène au cap de départ', () => {
    const a = tournerDe(SERRE, 5);
    expect(a.orientationDeg).toBe(5);
    expect(tournerDe(a, -5).orientationDeg).toBe(0);
  });

  it('−5° depuis 0 donne 355, +5° depuis 355 donne 0 : jamais de cap négatif ni de 360', () => {
    expect(tournerDe(SERRE, -5).orientationDeg).toBe(355);
    expect(tournerDe({ ...SERRE, orientationDeg: 355 }, 5).orientationDeg).toBe(0);
    expect(tournerDe({ ...SERRE, orientationDeg: 10 }, -730).orientationDeg).toBe(0);
  });

  it('ne change ni le centre ni les dimensions, et ne modifie pas l’entrée', () => {
    const avant = structuredClone(SERRE);
    const r = tournerDe(SERRE, 33);
    expect(r.centre).toEqual(SERRE.centre);
    expect([r.longueurM, r.largeurM]).toEqual([40, 8]);
    expect(SERRE).toEqual(avant);
  });

  it('pas de dérive après 72 pas de 5° : retour exact au cap de départ', () => {
    let r = SERRE;
    for (let i = 0; i < 72; i++) r = tournerDe(r, 5);
    expect(r.orientationDeg).toBe(0);
  });
});

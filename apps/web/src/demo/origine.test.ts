/**
 * Tests d'acceptation T28i — l'origine du plan de la ferme de démo : un lieu agricole réel et
 * plausible, aux coordonnées fixes, sans ferme réelle nommée. Contrat : ./test/contrat-placement.ts.
 */
import { validerPlacement } from '@planif/core';
import { describe, expect, it } from 'vitest';
import { lignesDeLaDemo } from './remplir.ts';
import { NOM_FERME_DEMO } from './identite.ts';
import { BORNES_FRANCE, CENTRE_RODEZ, DISTANCE_MAX_POSITION_M, DISTANCE_MIN_CENTRE_RODEZ_M } from './test/contrat-placement.ts';

const RAYON_TERRE_M = 6_371_000;

/** Distance (m) entre deux points, formule de haversine. */
function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.sqrt(h));
}

interface Coordonnees {
  readonly latitude: number;
  readonly longitude: number;
}

function lireCoordonnees(texte: unknown, quoi: string): Coordonnees {
  expect(typeof texte, `${quoi} est un texte JSON`).toBe('string');
  const o = JSON.parse(String(texte)) as { latitude?: unknown; longitude?: unknown };
  expect(typeof o.latitude, `${quoi} : latitude`).toBe('number');
  expect(typeof o.longitude, `${quoi} : longitude`).toBe('number');
  return { latitude: Number(o.latitude), longitude: Number(o.longitude) };
}

const decimales = (n: number): number => (String(n).split('.')[1] ?? '').length;
const tables = () => lignesDeLaDemo('2026-10-10', new Date('2026-10-10T08:00:00.000Z'));

describe('T28i : origine du plan de la ferme de démo', () => {
  const ferme = tables().get('ferme')?.[0];

  it('coordonnées fixes : deux générations donnent la même origine', () => {
    const a = tables().get('ferme')?.[0]?.origine_plan;
    const b = lignesDeLaDemo('2027-03-01', new Date('2027-03-01T08:00:00.000Z')).get('ferme')?.[0]?.origine_plan;
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  it('en France métropolitaine, arrondie à 3 décimales au plus (aucune ferme réelle désignée)', () => {
    const o = lireCoordonnees(ferme?.origine_plan, 'origine_plan');
    expect(o.latitude).toBeGreaterThanOrEqual(BORNES_FRANCE.latMin);
    expect(o.latitude).toBeLessThanOrEqual(BORNES_FRANCE.latMax);
    expect(o.longitude).toBeGreaterThanOrEqual(BORNES_FRANCE.lonMin);
    expect(o.longitude).toBeLessThanOrEqual(BORNES_FRANCE.lonMax);
    expect(decimales(o.latitude), 'décimales de la latitude').toBeLessThanOrEqual(3);
    expect(decimales(o.longitude), 'décimales de la longitude').toBeLessThanOrEqual(3);
  });

  it('un lieu agricole : loin du centre de Rodez, où tombait l’ancienne origine (une ville)', () => {
    const o = lireCoordonnees(ferme?.origine_plan, 'origine_plan');
    expect(distanceM(o, CENTRE_RODEZ)).toBeGreaterThan(DISTANCE_MIN_CENTRE_RODEZ_M);
  });

  it('la position météo de la démo est au même endroit que la photo', () => {
    const o = lireCoordonnees(ferme?.origine_plan, 'origine_plan');
    const p = lireCoordonnees(ferme?.position, 'position');
    expect(distanceM(o, p)).toBeLessThan(DISTANCE_MAX_POSITION_M);
  });

  it('aucun nom de ferme réelle : la ferme de démo reste fictive, et ses placements restent valides', () => {
    expect(String(ferme?.nom)).toBe(NOM_FERME_DEMO);
    for (const b of tables().get('batiment') ?? []) expect(validerPlacement({ table: 'batiment', ligne: b }).ok, String(b.nom)).toBe(true);
  });
});

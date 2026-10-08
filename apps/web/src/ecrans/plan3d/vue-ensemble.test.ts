/**
 * Tests T28c — la vue de départ et « Vue d'ensemble » : fonctions pures de cadrage.ts
 * (`pointsDeFerme`, `cadragePoints`, `meilleureVueDeFerme`). Contrat : fin de ./test/contrat-camera.ts.
 * Le bouton lui-même est vérifié par e2e/vue-3d-camera.e2e.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModuleCadrage, ModuleVueFerme, Point3 } from './test/contrat-camera.ts';
import { AZIMUT_DEPART } from './test/contrat-camera.ts';
import { coinsRect } from './test/geometrie.ts';
import { projeter } from './test/projection.ts';

const CHEMIN_CADRAGE = './cadrage.ts';
const CHAMP = 40;
const ECRAN = 16 / 9;

let m: ModuleCadrage & ModuleVueFerme;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_CADRAGE)) as ModuleCadrage & ModuleVueFerme;
});

const socle = (id: string, x: number, z: number, largeur: number, profondeur: number, angle = 0) => ({ id, nom: id, x, z, largeur, profondeur, angle, contour: null, placee: angle !== 0, batimentId: null });
const volume = (id: string, zoneId: string, x: number, z: number, longueur: number, largeur: number, angle = 0) => ({
  id, code: id, zoneId, x, z, longueur, largeur, hauteur: 0.3, couleur: '#000000', cleFamille: null, culture: null, occupationId: null, angle, placee: angle !== 0,
});
const batiment = (id: string, x: number, z: number, largeur: number, profondeur: number, hauteur: number, angle: number) => ({
  id, nom: id, type: 'serre_tunnel', zoneId: null, x, z, largeur, profondeur, hauteur, angle, forme: 'tunnel', arceaux: [], nefs: 1, opacite: 0.3, couleur: '#ffffff',
});

/** Ferme longue et tournée de 0,7 rad : sa boîte axée est bien plus grande qu'elle. */
const PLACEE = {
  semaine: 0,
  libelleSemaine: 'S01',
  socles: [socle('a', 0, 0, 8, 80, 0.7), socle('b', 40, -30, 10, 10, 0.7)],
  volumes: [volume('v1', 'a', 0, 0, 10, 1, 0.7), volume('v2', 'b', 40, -30, 4, 1)],
  batiments: [batiment('s1', -20, 20, 8, 60, 3.5, 0.7)],
};

/** Ferme non placée, rectangle aligné sur les axes (comme en T27). */
const NON_PLACEE = {
  semaine: 0,
  libelleSemaine: 'S01',
  socles: [socle('a', 0, 0, 40, 20), socle('b', 50, 0, 40, 20)],
  volumes: [volume('v1', 'a', 0, 0, 10, 1), volume('v2', 'b', 50, 0, 10, 1)],
};

const tient = (points: readonly Point3[], pose: Parameters<typeof projeter>[0]): { pire: number; devant: boolean } => {
  let pire = 0;
  let devant = true;
  for (const p of points) {
    const e = projeter(pose, CHAMP, ECRAN, p);
    if (!(e.profondeur > 0)) devant = false;
    pire = Math.max(pire, Math.abs(e.x), Math.abs(e.y));
  }
  return { pire, devant };
};
const recul = (pose: { position: Point3; cible: Point3 }) => Math.hypot(pose.position.x - pose.cible.x, pose.position.y - pose.cible.y, pose.position.z - pose.cible.z);

describe('T28c : pointsDeFerme', () => {
  it('coins réels (tournés) de chaque socle, planche et bâtiment : au sol, et en hauteur pour planches et bâtiments', () => {
    const pts = m.pointsDeFerme(PLACEE);
    const a = (x: number, y: number, z: number) => pts.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6 && Math.abs(p.z - z) < 1e-6);
    for (const c of coinsRect(0, 0, 8, 80, 0.7)) expect(a(c.x, 0, c.z), 'coin du socle a').toBe(true);
    for (const c of coinsRect(-20, 20, 8, 60, 0.7)) {
      expect(a(c.x, 0, c.z), 'pied de la serre').toBe(true);
      expect(a(c.x, 3.5, c.z), 'faîte de la serre').toBe(true);
    }
    for (const c of coinsRect(40, -30, 4, 1, 0)) expect(a(c.x, 0.3, c.z), 'dessus de la planche v2').toBe(true);
  });

  it('scène vide : aucun point', () => {
    expect(m.pointsDeFerme({ semaine: 0, libelleSemaine: 'S01', socles: [], volumes: [], batiments: [] })).toEqual([]);
  });

  it('ferme non placée (T27, sans angle ni bâtiment) : les coins des socles et des planches, alignés sur les axes', () => {
    const pts = m.pointsDeFerme({ ...NON_PLACEE, batiments: undefined });
    const xs = pts.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-20, 6);
    expect(Math.max(...xs)).toBeCloseTo(70, 6);
    const zs = pts.map((p) => p.z);
    expect(Math.min(...zs)).toBeCloseTo(-10, 6);
    expect(Math.max(...zs)).toBeCloseTo(10, 6);
  });
});

describe('T28c : cadragePoints', () => {
  const DIR = { x: 0.6, z: 0.8 };
  it('tous les points dans ±0,9 de l’écran, devant la caméra, et l’un d’eux à 0,75 au moins', () => {
    for (const scene of [PLACEE, NON_PLACEE]) {
      const pts = m.pointsDeFerme(scene);
      const pose = m.cadragePoints(pts, CHAMP, ECRAN, DIR);
      if (pose === null) throw new Error('pose nulle');
      const { pire, devant } = tient(pts, pose);
      expect(devant).toBe(true);
      expect(pire).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(pire).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('plongée de 45° dans le sens demandé', () => {
    const pts = m.pointsDeFerme(PLACEE);
    const pose = m.cadragePoints(pts, CHAMP, ECRAN, DIR);
    if (pose === null) throw new Error('pose nulle');
    const dx = pose.position.x - pose.cible.x;
    const dz = pose.position.z - pose.cible.z;
    expect(pose.position.y - pose.cible.y).toBeCloseTo(Math.hypot(dx, dz), 6);
    expect(dx / Math.hypot(dx, dz)).toBeCloseTo(0.6, 6);
  });

  it('une ferme tournée est cadrée plus serré que par sa boîte axée', () => {
    const pts = m.pointsDeFerme(PLACEE);
    const boite = m.boiteDe(PLACEE, { sorte: 'ferme' });
    if (boite === null) throw new Error('boîte nulle');
    const parPoints = m.cadragePoints(pts, CHAMP, ECRAN, DIR);
    if (parPoints === null) throw new Error('pose nulle');
    expect(recul(parPoints)).toBeLessThan(recul(m.cadrage(boite, CHAMP, ECRAN, DIR)) * 0.9);
  });

  it('aucun point → null ; champ, rapport ou direction invalides → RangeError', () => {
    expect(m.cadragePoints([], CHAMP, ECRAN, DIR)).toBeNull();
    const un = [{ x: 0, y: 0, z: 0 }];
    expect(() => m.cadragePoints(un, 0, ECRAN, DIR)).toThrow(RangeError);
    expect(() => m.cadragePoints(un, 180, ECRAN, DIR)).toThrow(RangeError);
    expect(() => m.cadragePoints(un, CHAMP, 0, DIR)).toThrow(RangeError);
    expect(() => m.cadragePoints(un, CHAMP, ECRAN, { x: 0, z: 0 })).toThrow(RangeError);
  });
});

describe('T28c : meilleureVueDeFerme', () => {
  const dir = (a: number) => ({ x: Math.sin(a), z: Math.cos(a) });

  it('tous les points dans ±0,9 de l’écran, l’un à 0,75 au moins, dans la direction de l’azimut rendu', () => {
    for (const scene of [PLACEE, NON_PLACEE]) {
      const pts = m.pointsDeFerme(scene);
      const v = m.meilleureVueDeFerme(pts, CHAMP, ECRAN, AZIMUT_DEPART);
      if (v === null) throw new Error('vue nulle');
      const { pire, devant } = tient(pts, v.pose);
      expect(devant).toBe(true);
      expect(pire).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(pire).toBeGreaterThanOrEqual(0.75);
      const dx = v.pose.position.x - v.pose.cible.x;
      const dz = v.pose.position.z - v.pose.cible.z;
      expect(dx / Math.hypot(dx, dz)).toBeCloseTo(Math.sin(v.azimut), 6);
      expect(dz / Math.hypot(dx, dz)).toBeCloseTo(Math.cos(v.azimut), 6);
    }
  });

  it('le recul est le plus court des 16 azimuts, à 2 % près', () => {
    const pts = m.pointsDeFerme(PLACEE);
    const v = m.meilleureVueDeFerme(pts, CHAMP, ECRAN, AZIMUT_DEPART);
    if (v === null) throw new Error('vue nulle');
    for (let k = 0; k < 16; k += 1) {
      const p = m.cadragePoints(pts, CHAMP, ECRAN, dir((k * Math.PI) / 8));
      if (p === null) throw new Error('pose nulle');
      expect(recul(v.pose), `azimut ${String(k)}/16`).toBeLessThanOrEqual(recul(p) * 1.02 + 1e-9);
    }
  });

  it('l’azimut de départ est gardé s’il est à 2 % près du meilleur (ferme ronde : tous les azimuts se valent)', () => {
    const pts = Array.from({ length: 96 }, (_, k) => ({ x: 30 * Math.cos((k * Math.PI) / 48), y: 0, z: 30 * Math.sin((k * Math.PI) / 48) }));
    for (const prefere of [AZIMUT_DEPART, 0.3, 2.9]) {
      const v = m.meilleureVueDeFerme(pts, CHAMP, ECRAN, prefere);
      expect(v?.azimut, `préféré ${String(prefere)}`).toBe(prefere);
    }
  });

  it('une ferme très allongée change d’azimut pour se montrer par son côté', () => {
    const longue = { semaine: 0, libelleSemaine: 'S01', socles: [socle('a', 0, 0, 6, 120)], volumes: [], batiments: [] };
    const pts = m.pointsDeFerme(longue);
    const v = m.meilleureVueDeFerme(pts, CHAMP, ECRAN, 0);
    const garde = m.cadragePoints(pts, CHAMP, ECRAN, dir(0));
    if (v === null || garde === null) throw new Error('vue nulle');
    expect(recul(v.pose)).toBeLessThan(recul(garde) * 0.98);
    expect(v.azimut).not.toBe(0);
  });

  it('ferme non placée : comportement de T27 — jamais plus large que le cadrage de sa boîte au même azimut', () => {
    const pts = m.pointsDeFerme(NON_PLACEE);
    const v = m.meilleureVueDeFerme(pts, CHAMP, ECRAN, AZIMUT_DEPART);
    const boite = m.boiteDe(NON_PLACEE, { sorte: 'ferme' });
    if (v === null || boite === null) throw new Error('vue nulle');
    expect(recul(v.pose)).toBeLessThanOrEqual(recul(m.cadrage(boite, CHAMP, ECRAN, dir(v.azimut))) + 1e-6);
  });

  it('aucun point → null ; pure : mêmes entrées, même sortie, entrée intacte', () => {
    expect(m.meilleureVueDeFerme([], CHAMP, ECRAN, AZIMUT_DEPART)).toBeNull();
    const pts = Object.freeze(m.pointsDeFerme(PLACEE).map((p) => Object.freeze({ ...p })));
    expect(m.meilleureVueDeFerme(pts, CHAMP, ECRAN, AZIMUT_DEPART)).toEqual(m.meilleureVueDeFerme(pts, CHAMP, ECRAN, AZIMUT_DEPART));
  });
});

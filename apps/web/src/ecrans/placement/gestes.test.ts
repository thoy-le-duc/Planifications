/**
 * Tests d'acceptation T28b — gestes de l'éditeur en fonctions pures : glisser, pivoter (crans de
 * 1°, Maj = 15°), poignées de côté (longueur, largeur), clavier (flèches 0,1 m, Maj 1 m, [ ] 1°),
 * et passage d'une planche entre repère de la ferme et repère de sa zone
 * (docs/backlog/T28b-editeur-placement.md ; contrat : ./test/contrat.ts, « Gestes »).
 *
 * Précision demandée par le ticket : 1 cm sur les positions et les dimensions, 0,1° sur les
 * orientations (un arrondi au centimètre est permis).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModuleGestes, Point, RectanglePlace } from './test/contrat.ts';

const CHEMIN = './gestes.ts';
let g: ModuleGestes;

beforeAll(async () => {
  g = (await import(/* @vite-ignore */ CHEMIN)) as ModuleGestes;
});

const CM = 0.01;
const DIXIEME_DEGRE = 0.1;

/** Serre M3 des exemples du modèle : 40 × 8 m, centrée en (50, 30), longueur vers l'est. */
const SERRE: RectanglePlace = { centre: { x: 50, y: 30 }, orientationDeg: 90, longueurM: 40, largeurM: 8 };
const NORD: RectanglePlace = { centre: { x: 0, y: 0 }, orientationDeg: 0, longueurM: 40, largeurM: 8 };

function prochePoint(recu: Point, attendu: Point, quoi = 'centre'): void {
  expect(Math.abs(recu.x - attendu.x), `${quoi}.x : ${String(recu.x)} au lieu de ${String(attendu.x)}`).toBeLessThanOrEqual(CM);
  expect(Math.abs(recu.y - attendu.y), `${quoi}.y : ${String(recu.y)} au lieu de ${String(attendu.y)}`).toBeLessThanOrEqual(CM);
}

/** Écart angulaire, en tenant compte du passage 360 → 0. */
const ecartAngle = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

function procheRect(recu: RectanglePlace, attendu: RectanglePlace): void {
  prochePoint(recu.centre, attendu.centre);
  expect(ecartAngle(recu.orientationDeg, attendu.orientationDeg), `orientation ${String(recu.orientationDeg)} au lieu de ${String(attendu.orientationDeg)}`).toBeLessThanOrEqual(
    DIXIEME_DEGRE,
  );
  expect(recu.orientationDeg).toBeGreaterThanOrEqual(0);
  expect(recu.orientationDeg).toBeLessThan(360);
  expect(Math.abs(recu.longueurM - attendu.longueurM), 'longueur').toBeLessThanOrEqual(CM);
  expect(Math.abs(recu.largeurM - attendu.largeurM), 'largeur').toBeLessThanOrEqual(CM);
}

/** Point à `distance` m du centre, au cap `cap` (degrés, sens horaire depuis le nord). */
const auCap = (centre: Point, cap: number, distance = 10): Point => ({
  x: centre.x + distance * Math.sin((cap * Math.PI) / 180),
  y: centre.y + distance * Math.cos((cap * Math.PI) / 180),
});

describe('T28b : glisser', () => {
  it('translation du pointeur, orientation et dimensions inchangées', () => {
    procheRect(g.glisser(SERRE, { x: 52, y: 31 }, { x: 60, y: 25 }), { ...SERRE, centre: { x: 58, y: 24 } });
    procheRect(g.glisser(NORD, { x: -3.3, y: 7.7 }, { x: -3.3, y: 7.7 }), NORD);
  });

  it('n’altère pas le rectangle reçu', () => {
    const copie = structuredClone(SERRE);
    g.glisser(SERRE, { x: 0, y: 0 }, { x: 5, y: 5 });
    expect(SERRE).toEqual(copie);
  });
});

describe('T28b : pivoter (crans de 1°, Maj = 15°)', () => {
  it.each([
    { cap: 0, attendu: 0 },
    { cap: 90, attendu: 90 },
    { cap: 180, attendu: 180 },
    { cap: 270, attendu: 270 },
    { cap: 45, attendu: 45 },
    { cap: 26.565, attendu: 27 },
    { cap: 7.4, attendu: 7 },
    { cap: 358.2, attendu: 358 },
    { cap: 359.7, attendu: 0 },
  ])('pointeur au cap $cap° → orientation $attendu°', ({ cap, attendu }) => {
    const r = g.pivoter(SERRE, auCap(SERRE.centre, cap), false);
    procheRect(r, { ...SERRE, orientationDeg: attendu });
  });

  it.each([
    { cap: 26.565, attendu: 30 },
    { cap: 7.4, attendu: 0 },
    { cap: 8, attendu: 15 },
    { cap: 97, attendu: 90 },
    { cap: 353, attendu: 0 },
    { cap: 352, attendu: 345 },
  ])('Maj : pointeur au cap $cap° → orientation $attendu° (crans de 15°)', ({ cap, attendu }) => {
    procheRect(g.pivoter(NORD, auCap(NORD.centre, cap), true), { ...NORD, orientationDeg: attendu });
  });

  it('pointeur sur le centre : rien ne change', () => {
    procheRect(g.pivoter(SERRE, SERRE.centre, false), SERRE);
  });
});

describe('T28b : poignées de côté (longueur et largeur), le côté opposé ne bouge pas', () => {
  it('serre au nord : bout avant tiré de 20 à 25 m → longueur 45, centre avancé de 2,5 m', () => {
    procheRect(g.redimensionner(NORD, 'avant', { x: 3, y: 25 }), { ...NORD, longueurM: 45, centre: { x: 0, y: 2.5 } });
  });

  it('serre au nord : bout arrière tiré vers le centre → longueur 30, centre reculé vers le nord', () => {
    procheRect(g.redimensionner(NORD, 'arriere', { x: -1, y: -10 }), { ...NORD, longueurM: 30, centre: { x: 0, y: 5 } });
  });

  it('serre au nord : côté gauche (ouest) tiré à x = −6 → largeur 10, centre x = −1', () => {
    procheRect(g.redimensionner(NORD, 'gauche', { x: -6, y: 7 }), { ...NORD, largeurM: 10, centre: { x: -1, y: 0 } });
  });

  it('serre à l’est (90°) : bout avant tiré à x = 80 → longueur 50, centre (55, 30)', () => {
    procheRect(g.redimensionner(SERRE, 'avant', { x: 80, y: 33 }), { ...SERRE, longueurM: 50, centre: { x: 55, y: 30 } });
  });

  it('serre à l’est (90°) : côté droit (au sud) tiré à y = 24 → largeur 10, centre (50, 29)', () => {
    procheRect(g.redimensionner(SERRE, 'droite', { x: 51, y: 24 }), { ...SERRE, largeurM: 10, centre: { x: 50, y: 29 } });
  });

  it('côté tiré au-delà du côté opposé : dimension minimale, côté opposé fixe', () => {
    const r = g.redimensionner(NORD, 'avant', { x: 0, y: -30 });
    expect(g.DIMENSION_MIN_M).toBe(0.5);
    procheRect(r, { ...NORD, longueurM: 0.5, centre: { x: 0, y: -19.75 } });
  });
});

describe('T28b : clavier (flèches 0,1 m, Maj 1 m, [ ] 1°)', () => {
  const R: RectanglePlace = { centre: { x: 10, y: 20 }, orientationDeg: 0, longueurM: 30, largeurM: 8 };
  const touche = (key: string, shiftKey = false) => ({ key, shiftKey });

  it.each([
    { key: 'ArrowRight', shiftKey: false, centre: { x: 10.1, y: 20 } },
    { key: 'ArrowLeft', shiftKey: false, centre: { x: 9.9, y: 20 } },
    { key: 'ArrowUp', shiftKey: false, centre: { x: 10, y: 20.1 } },
    { key: 'ArrowDown', shiftKey: false, centre: { x: 10, y: 19.9 } },
    { key: 'ArrowRight', shiftKey: true, centre: { x: 11, y: 20 } },
    { key: 'ArrowLeft', shiftKey: true, centre: { x: 9, y: 20 } },
    { key: 'ArrowUp', shiftKey: true, centre: { x: 10, y: 21 } },
    { key: 'ArrowDown', shiftKey: true, centre: { x: 10, y: 19 } },
  ])('$key (Maj : $shiftKey) → centre ($centre.x, $centre.y)', ({ key, shiftKey, centre }) => {
    const r = g.appliquerTouche(R, touche(key, shiftKey));
    expect(r).not.toBeNull();
    if (r !== null) procheRect(r, { ...R, centre });
  });

  it('les flèches déplacent dans le repère de la ferme, quelle que soit l’orientation', () => {
    const r = g.appliquerTouche(SERRE, touche('ArrowUp'));
    expect(r).not.toBeNull();
    if (r !== null) procheRect(r, { ...SERRE, centre: { x: 50, y: 30.1 } });
  });

  it('dix flèches à droite = 1 m, au centimètre près', () => {
    let r: RectanglePlace = R;
    for (let k = 0; k < 10; k++) r = g.appliquerTouche(r, touche('ArrowRight')) ?? r;
    procheRect(r, { ...R, centre: { x: 11, y: 20 } });
  });

  it('] tourne de +1°, [ de −1°, ramené dans [0, 360[', () => {
    const plus = g.appliquerTouche(R, touche(']'));
    const moins = g.appliquerTouche(R, touche('['));
    const tour = g.appliquerTouche({ ...R, orientationDeg: 359 }, touche(']'));
    expect([plus, moins, tour]).not.toContain(null);
    if (plus !== null) procheRect(plus, { ...R, orientationDeg: 1 });
    if (moins !== null) procheRect(moins, { ...R, orientationDeg: 359 });
    if (tour !== null) procheRect(tour, { ...R, orientationDeg: 0 });
  });

  it('quatre-vingt-dix fois ] : 90° exactement', () => {
    let r: RectanglePlace = R;
    for (let k = 0; k < 90; k++) r = g.appliquerTouche(r, touche(']')) ?? r;
    procheRect(r, { ...R, orientationDeg: 90 });
  });

  it.each(['a', 'Enter', 'Tab', 'Escape', ' ', 'z'])('autre touche (« %s ») : null', (key) => {
    expect(g.appliquerTouche(R, touche(key))).toBeNull();
  });
});

describe('T28b : planche entre repère de la ferme et repère de sa zone', () => {
  // Exemple du modèle : planche à (2, 0) dans une serre centrée en (50, 30), tournée de 90°.
  const REPERE = { centre: { x: 50, y: 30 }, orientationDeg: 90 };

  it('placement (2, 0, 0°) dans la serre → (50, 28) dans la ferme, cap 90°', () => {
    const r = g.depuisPlacementPlanche(REPERE, { x: 2, y: 0, orientation_deg: 0 });
    prochePoint(r.centre, { x: 50, y: 28 });
    expect(ecartAngle(r.orientationDeg, 90)).toBeLessThanOrEqual(DIXIEME_DEGRE);
  });

  it('rectangle (50, 28, 90°) → placement (2, 0, 0°) dans la serre', () => {
    const p = g.versPlacementPlanche(REPERE, { centre: { x: 50, y: 28 }, orientationDeg: 90, longueurM: 30, largeurM: 0.8 });
    prochePoint(p, { x: 2, y: 0 }, 'placement');
    expect(ecartAngle(p.orientation_deg, 0)).toBeLessThanOrEqual(DIXIEME_DEGRE);
    expect(p.orientation_deg).toBeGreaterThanOrEqual(0);
    expect(p.orientation_deg).toBeLessThan(360);
  });

  it('planche glissée à (52, 30) et tournée à 100° → (0, 2, 10°) ; tournée à 30° → 300°', () => {
    const p = g.versPlacementPlanche(REPERE, { centre: { x: 52, y: 30 }, orientationDeg: 100, longueurM: 30, largeurM: 0.8 });
    prochePoint(p, { x: 0, y: 2 }, 'placement');
    expect(ecartAngle(p.orientation_deg, 10)).toBeLessThanOrEqual(DIXIEME_DEGRE);
    const q = g.versPlacementPlanche(REPERE, { centre: { x: 52, y: 30 }, orientationDeg: 30, longueurM: 30, largeurM: 0.8 });
    expect(ecartAngle(q.orientation_deg, 300)).toBeLessThanOrEqual(DIXIEME_DEGRE);
    expect(q.orientation_deg).toBeLessThan(360);
  });

  it('aller-retour, zone quelconque', () => {
    const repere = { centre: { x: -12.5, y: 7.25 }, orientationDeg: 33 };
    const depart = { x: 3.4, y: -11.2, orientation_deg: 341 };
    const ferme = g.depuisPlacementPlanche(repere, depart);
    const retour = g.versPlacementPlanche(repere, { centre: ferme.centre, orientationDeg: ferme.orientationDeg, longueurM: 30, largeurM: 0.8 });
    prochePoint(retour, depart, 'placement');
    expect(ecartAngle(retour.orientation_deg, depart.orientation_deg)).toBeLessThanOrEqual(DIXIEME_DEGRE);
  });
});

describe('T28b : gestes.ts est pur', () => {
  it('n’importe ni React ni DOM ni réseau', () => {
    const source = readFileSync(join(import.meta.dirname, 'gestes.ts'), 'utf8');
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2] ?? '');
    for (const i of imports) expect(['@planif/core'].includes(i) || i.startsWith('./'), `import « ${i} »`).toBe(true);
    expect(source).not.toMatch(/\bfetch\s*\(|\bdocument\.|\bwindow\./);
  });
});

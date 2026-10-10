/**
 * Tests d'acceptation T29 — cadrage de la caméra et vol, côté module pur (`cadrage.ts`).
 * Contrat : ./test/contrat-camera.ts. Le DOM de la vue et la mesure du vol (600 ms, fluidité,
 * mouvement réduit) sont vérifiés par apps/web/e2e/vue-3d-camera.e2e.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Scene, VolumeScene } from './test/contrat.ts';
import type { Boite, Direction, ModuleCadrage, Point3, Pose } from './test/contrat-camera.ts';
import { distance, etendueEcran, tourner } from './test/projection.ts';

const CHEMIN_CADRAGE = './cadrage.ts';

let m: ModuleCadrage;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_CADRAGE)) as ModuleCadrage;
});

const CHAMP = 40;
const ECRAN = 16 / 10;
const DIAG: Direction = { x: 1, z: 1 };

function boite(x0: number, z0: number, x1: number, z1: number, hauteur: number, angle?: number): Boite {
  return { min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: hauteur, z: z1 }, ...(angle === undefined ? {} : { angle }) };
}
const centree = (largeur: number, profondeur: number, hauteur: number, angle?: number): Boite => boite(-largeur / 2, -profondeur / 2, largeur / 2, profondeur / 2, hauteur, angle);

function proche(a: Point3, b: Point3, tolerance = 1e-6): void {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
  expect(a.z).toBeCloseTo(b.z, 5);
  expect(distance(a, b)).toBeLessThan(tolerance + 1e-4);
}

// ── Scène écrite à la main : deux zones, quatre planches ─────────────────────────────────────

function volume(id: string, zoneId: string, x: number, z: number, longueur: number, largeur: number, hauteur: number): VolumeScene {
  return { id, code: id.toUpperCase(), zoneId, x, z, longueur, largeur, hauteur, couleur: '#888888', cleFamille: null, culture: null, occupationId: null };
}

const scene: Scene = {
  semaine: 0,
  libelleSemaine: 'S01',
  socles: [
    { id: 'zA', nom: 'Serre M3', x: 0, z: 0, largeur: 20, profondeur: 10 },
    { id: 'zB', nom: 'Plein champ', x: 30, z: 0, largeur: 10, profondeur: 10 },
  ],
  volumes: [volume('p1', 'zA', -5, 0, 8, 1, 0.5), volume('p2', 'zA', 5, 2, 6, 1, 2.5), volume('p3', 'zB', 28, 0, 4, 2, 1), volume('p4', 'zB', 32, 0, 4, 2, 1.5)],
};

describe('boiteDe : la boîte à cadrer', () => {
  it('une zone : son socle, de y = 0 à la plus haute planche', () => {
    expect(m.boiteDe(scene, { sorte: 'zone', id: 'zA' })).toEqual({ min: { x: -10, y: 0, z: -5 }, max: { x: 10, y: 2.5, z: 5 } });
    expect(m.boiteDe(scene, { sorte: 'zone', id: 'zB' })).toEqual({ min: { x: 25, y: 0, z: -5 }, max: { x: 35, y: 1.5, z: 5 } });
  });

  it('une planche : son volume', () => {
    expect(m.boiteDe(scene, { sorte: 'planche', id: 'p2' })).toEqual({ min: { x: 2, y: 0, z: 1.5 }, max: { x: 8, y: 2.5, z: 2.5 } });
  });

  it('toute la ferme : l’union des socles et des volumes', () => {
    expect(m.boiteDe(scene, { sorte: 'ferme' })).toEqual({ min: { x: -10, y: 0, z: -5 }, max: { x: 35, y: 2.5, z: 5 } });
  });

  it('une zone sans planche : hauteur nulle, boîte plate permise', () => {
    const vide: Scene = { ...scene, volumes: [] };
    const b = m.boiteDe(vide, { sorte: 'zone', id: 'zA' });
    expect(b).toEqual({ min: { x: -10, y: 0, z: -5 }, max: { x: 10, y: 0, z: 5 } });
  });

  it('scène vide : null pour la ferme (rien à cadrer) ; identifiant inconnu : RangeError', () => {
    const rien: Scene = { semaine: 0, libelleSemaine: 'S01', socles: [], volumes: [] };
    expect(m.boiteDe(rien, { sorte: 'ferme' })).toBeNull();
    expect(() => m.boiteDe(scene, { sorte: 'zone', id: 'inconnue' })).toThrow(RangeError);
    expect(() => m.boiteDe(scene, { sorte: 'planche', id: 'inconnue' })).toThrow(RangeError);
  });

  it('ne modifie pas la scène', () => {
    const avant = JSON.stringify(scene);
    m.boiteDe(scene, { sorte: 'ferme' });
    m.boiteDe(scene, { sorte: 'zone', id: 'zA' });
    expect(JSON.stringify(scene)).toBe(avant);
  });
});

describe('cadrage : la boîte tient à l’écran avec 10 % de marge', () => {
  const cas: readonly { nom: string; boite: Boite; ecran: number; direction: Direction }[] = [
    { nom: 'planche seule (6 m × 0,8 m, haute de 0,5 m)', boite: centree(6, 0.8, 0.5), ecran: ECRAN, direction: DIAG },
    { nom: 'zone carrée (20 m × 20 m)', boite: centree(20, 20, 3), ecran: ECRAN, direction: DIAG },
    { nom: 'zone carrée, vue de face', boite: centree(20, 20, 3), ecran: ECRAN, direction: { x: 0, z: 1 } },
    { nom: 'tunnel de 50 m × 8 m, vu par le travers', boite: centree(50, 8, 4), ecran: ECRAN, direction: { x: 0, z: 1 } },
    { nom: 'tunnel de 50 m × 8 m, vu dans l’axe', boite: centree(50, 8, 4), ecran: ECRAN, direction: { x: 1, z: 0 } },
    { nom: 'tunnel de 50 m × 8 m, vu en diagonale', boite: centree(50, 8, 4), ecran: ECRAN, direction: DIAG },
    { nom: 'tunnel, écran étroit (téléphone en portrait, 0,5)', boite: centree(50, 8, 4), ecran: 0.5, direction: { x: 0, z: 1 } },
    { nom: 'tunnel, écran très large (3)', boite: centree(50, 8, 4), ecran: 3, direction: { x: 0, z: 1 } },
    { nom: 'zone tournée de 30° (40 m × 12 m)', boite: centree(40, 12, 4, Math.PI / 6), ecran: ECRAN, direction: DIAG },
    { nom: 'zone tournée de 90° (tunnel couché)', boite: centree(50, 8, 4, Math.PI / 2), ecran: ECRAN, direction: { x: 0, z: 1 } },
    { nom: 'zone tournée de −40°, hors de l’origine', boite: boite(100, -60, 140, -48, 4, -0.7), ecran: ECRAN, direction: { x: -1, z: 0.3 } },
    { nom: 'très grande zone (3 km × 2 km)', boite: centree(3000, 2000, 10), ecran: ECRAN, direction: DIAG },
  ];

  for (const c of cas) {
    it(c.nom, () => {
      const pose = m.cadrage(c.boite, CHAMP, c.ecran, c.direction);
      const etendue = etendueEcran(pose, CHAMP, c.ecran, c.boite);
      expect(Number.isFinite(etendue), 'un coin est derrière la caméra').toBe(true);
      expect(etendue, 'la boîte déborde de la marge de 10 %').toBeLessThanOrEqual(0.9 + 1e-6);
      expect(etendue, 'cadrage trop large : la caméra recule pour rien').toBeGreaterThanOrEqual(0.75);
      for (const n of [pose.position.x, pose.position.y, pose.position.z, pose.cible.x, pose.cible.y, pose.cible.z]) expect(Number.isFinite(n)).toBe(true);
    });
  }

  it('la cible est le centre de la boîte', () => {
    const b = boite(100, -60, 140, -48, 4, -0.7);
    proche(m.cadrage(b, CHAMP, ECRAN, DIAG).cible, { x: 120, y: 2, z: -54 });
  });

  it('plongée de 45° et même sens que la caméra actuelle (pas de demi-tour)', () => {
    for (const direction of [DIAG, { x: 0, z: 1 }, { x: -3, z: 0.5 }, { x: 0, z: -7 }]) {
      const pose = m.cadrage(centree(20, 20, 3), CHAMP, ECRAN, direction);
      const dx = pose.position.x - pose.cible.x;
      const dz = pose.position.z - pose.cible.z;
      const dy = pose.position.y - pose.cible.y;
      const plongee = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
      expect(plongee).toBeCloseTo(m.PLONGEE_DEGRES, 3);
      expect(m.PLONGEE_DEGRES).toBe(45);
      // Colinéaire et de même sens que `direction` (la longueur de `direction` ne compte pas).
      const croise = dx * direction.z - dz * direction.x;
      const scalaire = dx * direction.x + dz * direction.z;
      expect(Math.abs(croise) / (Math.hypot(dx, dz) * Math.hypot(direction.x, direction.z))).toBeLessThan(1e-9);
      expect(scalaire).toBeGreaterThan(0);
    }
  });

  it('la longueur de la direction ne change rien', () => {
    const a = m.cadrage(centree(20, 20, 3), CHAMP, ECRAN, { x: 1, z: 2 });
    const b = m.cadrage(centree(20, 20, 3), CHAMP, ECRAN, { x: 100, z: 200 });
    proche(a.position, b.position);
  });

  it('une boîte tournée, vue avec la même rotation, demande la même distance qu’une boîte droite', () => {
    const angle = 0.6;
    const droite = m.cadrage(centree(40, 12, 4), CHAMP, ECRAN, { x: 0.3, z: 1 });
    const r = tourner(0.3, 1, angle);
    const tournee = m.cadrage(centree(40, 12, 4, angle), CHAMP, ECRAN, r);
    expect(distance(tournee.position, tournee.cible)).toBeCloseTo(distance(droite.position, droite.cible), 5);
  });

  it('un tunnel vu dans l’axe se cadre plus près que le même tunnel vu par le travers sur un écran large', () => {
    const travers = m.cadrage(centree(50, 8, 4), CHAMP, ECRAN, { x: 0, z: 1 });
    const axe = m.cadrage(centree(50, 8, 4), CHAMP, ECRAN, { x: 1, z: 0 });
    // Les deux tiennent, mais le recul n’est pas celui d’une sphère : il dépend de la forme.
    expect(distance(travers.position, travers.cible)).not.toBeCloseTo(distance(axe.position, axe.cible), 1);
  });

  it('un champ plus étroit recule la caméra', () => {
    const b = centree(20, 20, 3);
    const large = m.cadrage(b, 60, ECRAN, DIAG);
    const etroit = m.cadrage(b, 20, ECRAN, DIAG);
    expect(distance(etroit.position, etroit.cible)).toBeGreaterThan(distance(large.position, large.cible));
    expect(etendueEcran(etroit, 20, ECRAN, b)).toBeLessThanOrEqual(0.9 + 1e-6);
  });

  it('une boîte réduite à un point : la caméra ne colle pas la cible', () => {
    const p = boite(5, 5, 5, 5, 0);
    const pose = m.cadrage(p, CHAMP, ECRAN, DIAG);
    expect(distance(pose.position, pose.cible)).toBeGreaterThanOrEqual(m.DISTANCE_MIN_M);
    expect(m.DISTANCE_MIN_M).toBeGreaterThan(0);
  });

  it('marge de 10 % annoncée', () => {
    expect(m.MARGE_CADRAGE).toBe(0.1);
  });

  it('pure : même entrée, même sortie, entrée intacte', () => {
    const b = Object.freeze({ min: Object.freeze({ x: -10, y: 0, z: -4 }), max: Object.freeze({ x: 10, y: 3, z: 4 }), angle: 0.3 });
    const d = Object.freeze({ x: 1, z: 1 });
    const a1 = m.cadrage(b, CHAMP, ECRAN, d);
    const a2 = m.cadrage(b, CHAMP, ECRAN, d);
    expect(a1).toEqual(a2);
  });

  it('entrées invalides : RangeError', () => {
    const b = centree(10, 10, 2);
    expect(() => m.cadrage(b, CHAMP, ECRAN, { x: 0, z: 0 }), 'direction nulle').toThrow(RangeError);
    expect(() => m.cadrage(b, 0, ECRAN, DIAG), 'champ nul').toThrow(RangeError);
    expect(() => m.cadrage(b, 180, ECRAN, DIAG), 'champ de 180°').toThrow(RangeError);
    expect(() => m.cadrage(b, CHAMP, 0, DIAG), 'écran sans largeur').toThrow(RangeError);
    expect(() => m.cadrage(b, CHAMP, Number.NaN, DIAG), 'rapport NaN').toThrow(RangeError);
    expect(() => m.cadrage({ min: { x: 1, y: 0, z: 0 }, max: { x: 0, y: 1, z: 1 } }, CHAMP, ECRAN, DIAG), 'min > max').toThrow(RangeError);
  });

  it('de la scène au cadrage : la serre M3 de la scène écrite à la main tient à l’écran', () => {
    const b = m.boiteDe(scene, { sorte: 'zone', id: 'zA' });
    if (b === null) throw new Error('boîte de zA absente');
    const pose = m.cadrage(b, CHAMP, ECRAN, DIAG);
    expect(etendueEcran(pose, CHAMP, ECRAN, b)).toBeLessThanOrEqual(0.9 + 1e-6);
    proche(pose.cible, { x: 0, y: 1.25, z: 0 });
  });
});

describe('vol : interpolation de la pose', () => {
  const depart: Pose = { position: { x: 0, y: 40, z: 40 }, cible: { x: 0, y: 0, z: 0 } };
  const arrivee: Pose = { position: { x: 60, y: 14, z: -20 }, cible: { x: 50, y: 2, z: -30 } };

  it('durée de 600 ms au plus, pour un vrai déplacement au moins 100 ms', () => {
    expect(m.DUREE_VOL_MAX_MS).toBe(600);
    const v = m.demarrerVol(depart, arrivee, false);
    expect(v.dureeMs).toBeLessThanOrEqual(600);
    expect(v.dureeMs).toBeGreaterThanOrEqual(100);
    expect(v.depart).toEqual(depart);
    expect(v.arrivee).toEqual(arrivee);
  });

  it('une très longue distance reste sous 600 ms', () => {
    const loin: Pose = { position: { x: 5000, y: 4000, z: 5000 }, cible: { x: 5000, y: 0, z: 4000 } };
    expect(m.demarrerVol(depart, loin, false).dureeMs).toBeLessThanOrEqual(600);
  });

  it('début et fin exacts', () => {
    const v = m.demarrerVol(depart, arrivee, false);
    expect(m.poseAu(v, 0)).toEqual(depart);
    expect(m.poseAu(v, -50)).toEqual(depart);
    expect(m.poseAu(v, v.dureeMs)).toEqual(arrivee);
    expect(m.poseAu(v, v.dureeMs + 1)).toEqual(arrivee);
    expect(m.poseAu(v, 1e9)).toEqual(arrivee);
  });

  it('position et cible avancent du même pas sur le segment, de façon croissante', () => {
    const v = m.demarrerVol(depart, arrivee, false);
    let precedent = 0;
    for (let k = 1; k < 100; k += 1) {
      const pose = m.poseAu(v, (v.dureeMs * k) / 100);
      const p = (pose.position.x - depart.position.x) / (arrivee.position.x - depart.position.x);
      expect(p).toBeGreaterThanOrEqual(precedent);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
      precedent = p;
      expect((pose.position.y - depart.position.y) / (arrivee.position.y - depart.position.y)).toBeCloseTo(p, 9);
      expect((pose.position.z - depart.position.z) / (arrivee.position.z - depart.position.z)).toBeCloseTo(p, 9);
      expect((pose.cible.x - depart.cible.x) / (arrivee.cible.x - depart.cible.x)).toBeCloseTo(p, 9);
      expect((pose.cible.y - depart.cible.y) / (arrivee.cible.y - depart.cible.y)).toBeCloseTo(p, 9);
      expect((pose.cible.z - depart.cible.z) / (arrivee.cible.z - depart.cible.z)).toBeCloseTo(p, 9);
    }
  });

  it('départ et arrivée en douceur, milieu à mi-chemin', () => {
    const v = m.demarrerVol(depart, arrivee, false);
    const avancement = (fraction: number): number => (m.poseAu(v, v.dureeMs * fraction).position.x - depart.position.x) / (arrivee.position.x - depart.position.x);
    expect(avancement(0.01)).toBeLessThan(0.005);
    expect(avancement(0.05)).toBeLessThan(0.05);
    expect(avancement(0.5)).toBeCloseTo(0.5, 1);
    expect(Math.abs(avancement(0.5) - 0.5)).toBeLessThan(0.02);
    expect(avancement(0.95)).toBeGreaterThan(0.95);
    expect(avancement(0.99)).toBeGreaterThan(0.995);
  });

  it('mouvement réduit : saut direct, durée nulle, arrivée dès le premier instant', () => {
    const v = m.demarrerVol(depart, arrivee, true);
    expect(v.dureeMs).toBe(0);
    expect(m.poseAu(v, 0)).toEqual(arrivee);
    expect(m.poseAu(v, 300)).toEqual(arrivee);
  });

  it('reprise en cours de vol : le nouveau vol part de la pose atteinte, sans saut', () => {
    const v1 = m.demarrerVol(depart, arrivee, false);
    const enRoute = m.poseAu(v1, 250);
    expect(enRoute).not.toEqual(depart);
    expect(enRoute).not.toEqual(arrivee);
    const autre: Pose = { position: { x: -30, y: 20, z: 10 }, cible: { x: -25, y: 1, z: 0 } };
    const v2 = m.demarrerVol(enRoute, autre, false);
    expect(v2.dureeMs).toBeLessThanOrEqual(600);
    expect(m.poseAu(v2, 0)).toEqual(enRoute);
    expect(m.poseAu(v2, v2.dureeMs)).toEqual(autre);
  });

  it('même pose au départ et à l’arrivée : rien ne bouge, durée valide', () => {
    const v = m.demarrerVol(depart, depart, false);
    expect(v.dureeMs).toBeGreaterThanOrEqual(0);
    expect(v.dureeMs).toBeLessThanOrEqual(600);
    expect(m.poseAu(v, v.dureeMs / 2)).toEqual(depart);
  });

  it('pure : les poses passées ne sont pas modifiées', () => {
    const d = structuredClone(depart);
    const a = structuredClone(arrivee);
    const v = m.demarrerVol(d, a, false);
    m.poseAu(v, 100);
    expect(d).toEqual(depart);
    expect(a).toEqual(arrivee);
  });
});

describe('budgets : le cadrage ne pèse rien au démarrage', () => {
  it('cadrage.ts n’importe rien d’exécutable (ni three, ni React, ni DOM, ni horloge)', () => {
    const source = readFileSync(fileURLToPath(new URL(CHEMIN_CADRAGE, import.meta.url)), 'utf8');
    const imports = [...source.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((r) => r[1]);
    expect(imports, 'imports exécutables de cadrage.ts').toEqual([]);
    expect(source).not.toMatch(/\bperformance\.now\b|\bDate\b|\bdocument\b|\bwindow\b|requestAnimationFrame/);
  });

  it('les budgets de apps/web/budget.json sont tenus (démarrage 71 Kio, morceau 3D 207,9 Kio depuis T37b)', () => {
    const budget = JSON.parse(readFileSync(fileURLToPath(new URL('../../../budget.json', import.meta.url)), 'utf8')) as { jsInitialGzKio?: number; jsVue3dGzKio?: number };
    expect(budget.jsInitialGzKio).toBe(71);
    expect(budget.jsVue3dGzKio).toBe(207.9);
  });
});

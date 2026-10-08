/**
 * Tests d'acceptation T28c — jumeau 3D : `versScene` place zones, planches et bâtiments à leur
 * vraie place et leur vraie orientation (repère de zone, T28a), les serres en tunnels, le repli
 * sur la disposition de T27 pour ce qui n'est pas placé. Contrat : ./test/contrat-jumeau.ts.
 * Adaptateur pur, sans navigateur ni three. La vue (mesures, DOM) est vérifiée par
 * apps/web/e2e/vue-3d-jumeau.e2e.ts, la ferme de démo par src/demo/placement.test.ts.
 */
import { depuisRepereZone, repereZone, type RepereZone } from '@planif/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { COULEURS } from '../../ui/jetons.ts';
import type { BarrePlan } from '../plan/calculs.ts';
import type { ModuleScene } from './test/contrat.ts';
import type { CibleVol as CibleT29, ModuleCadrage } from './test/contrat-camera.ts';
import type { FiltresScene, ModuleFiltres } from './test/contrat-filtres.ts';
import type { BatimentPlan, BatimentScene, ModuleJumeau, PlacementPlanche, PlanJumeau, PointFerme, SceneJumeau, SocleJumeau, TypeBatiment, VolumeJumeau } from './test/contrat-jumeau.ts';
import { coinsDe, tourner } from './test/projection.ts';

const CHEMIN_SCENE = './scene.ts';
const CHEMIN_CADRAGE = './cadrage.ts';
const TOL = 1e-6;

let m: ModuleJumeau & ModuleScene & ModuleFiltres;
let cadrage: ModuleCadrage;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleJumeau & ModuleScene & ModuleFiltres;
  cadrage = (await import(/* @vite-ignore */ CHEMIN_CADRAGE)) as ModuleCadrage;
});

// ── Outils de géométrie, indépendants du code de l'appli ─────────────────────────────────────

const RAD = Math.PI / 180;
const DEUX_PI = 2 * Math.PI;

/** Deux angles égaux à `periode` près (2π pour un repère, π pour un rectangle symétrique). */
function memeAngle(a: number, b: number, periode = DEUX_PI): boolean {
  const d = (((a - b) % periode) + periode) % periode;
  return d < 1e-6 || periode - d < 1e-6;
}

interface Pt {
  readonly x: number;
  readonly z: number;
}

/** Coins d'un rectangle de scène : `ex` selon son x local, `ez` selon son z local, tourné de `angle`. */
function coinsRect(cx: number, cz: number, ex: number, ez: number, angle: number): Pt[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx = 0, sz = 0]) => {
    const r = tourner((sx * ex) / 2, (sz * ez) / 2, angle);
    return { x: cx + r.x, z: cz + r.z };
  });
}

const coinsVolume = (v: VolumeJumeau): Pt[] => coinsRect(v.x, v.z, v.longueur, v.largeur, v.angle);
const coinsSocle = (s: SocleJumeau): Pt[] => coinsRect(s.x, s.z, s.largeur, s.profondeur, s.angle);
const coinsBatiment = (b: BatimentScene): Pt[] => coinsRect(b.x, b.z, b.largeur, b.profondeur, b.angle);

/** Les polygones convexes se recouvrent-ils de plus de TOL (axe séparant = pas de recouvrement) ? */
function recouvre(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (p === undefined || q === undefined) continue;
      const nx = -(q.z - p.z);
      const nz = q.x - p.x;
      const norme = Math.hypot(nx, nz);
      const proj = (pts: readonly Pt[]) => {
        const v = pts.map((c) => (c.x * nx + c.z * nz) / norme);
        return [Math.min(...v), Math.max(...v)] as const;
      };
      const [a0, a1] = proj(a);
      const [b0, b1] = proj(b);
      if (a1 <= b0 + TOL || b1 <= a0 + TOL) return false;
    }
  }
  return true;
}

const aabb = (pts: readonly Pt[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)) });
const rectDeAabb = (b: ReturnType<typeof aabb>): Pt[] => [
  { x: b.x0, z: b.z0 },
  { x: b.x1, z: b.z0 },
  { x: b.x1, z: b.z1 },
  { x: b.x0, z: b.z1 },
];
/** Polygone à comparer pour un socle : son rectangle (tourné), ou la boîte englobante de son contour. */
const formeSocle = (s: SocleJumeau): Pt[] => (s.contour === null ? coinsSocle(s) : rectDeAabb(aabb(s.contour)));

/** `a` est entièrement dans le rectangle convexe `b` (à TOL près). */
function dansRect(a: readonly Pt[], rect: readonly Pt[]): boolean {
  return a.every((c) => {
    let signe = 0;
    for (let i = 0; i < rect.length; i += 1) {
      const p = rect[i];
      const q = rect[(i + 1) % rect.length];
      if (p === undefined || q === undefined) continue;
      const croix = (q.x - p.x) * (c.z - p.z) - (q.z - p.z) * (c.x - p.x);
      if (Math.abs(croix) < TOL * Math.hypot(q.x - p.x, q.z - p.z)) continue;
      const s = Math.sign(croix);
      if (signe === 0) signe = s;
      else if (s !== signe) return false;
    }
    return true;
  });
}

// ── Plan écrit à la main, en repère de la ferme (x est, y nord) ──────────────────────────────

const semaines = [0, 1, 2].map((i) => ({ annee: 2026, semaine: i + 1, libelle: `S0${String(i + 1)}`, lundi: `2026-01-${String(5 + 7 * i).padStart(2, '0')}` }));

const barreTomate: BarrePlan = {
  occupationId: 'o1',
  serieId: null,
  plantationId: null,
  libelle: 'Tomate',
  famille: null,
  cleFamille: 'solanacees',
  etat: 'prevu',
  du: '2026-01-05',
  au: null,
  debutJour: 0,
  finJour: 14,
  enConflit: false,
};

function planche(id: string, zoneId: string, longueurM: number, largeurM: number, placement: PlacementPlanche | null, chapelleId: string | null = null, barres: BarrePlan[] = []) {
  return { sorte: 'emplacement' as const, id, code: id.toUpperCase(), zoneId, chapelleId, barres, conflits: [], longueurM, largeurM, placement };
}
const zone = (id: string, nom: string, contour: readonly PointFerme[] | null = null) => ({ sorte: 'zone' as const, id, nom, contour });
const place = (x: number, y: number, orientationDeg = 0): PlacementPlanche => ({ x, y, orientationDeg });

const batiment = (id: string, nom: string, type: TypeBatiment, centre: PointFerme, orientationDeg: number, longueurM: number, largeurM: number, hauteurM: number, zoneId: string | null): BatimentPlan => ({
  id,
  nom,
  type,
  longueurM,
  largeurM,
  hauteurM,
  centre,
  orientationDeg,
  zoneId,
});

const CONTOUR_L: PointFerme[] = [
  { x: 100, y: 0 },
  { x: 120, y: 0 },
  { x: 120, y: 10 },
  { x: 110, y: 10 },
  { x: 110, y: 30 },
  { x: 100, y: 30 },
];
const CONTOUR_CARRE: PointFerme[] = [
  { x: 150, y: -40 },
  { x: 170, y: -40 },
  { x: 170, y: -20 },
  { x: 150, y: -20 },
];

const B1 = batiment('b1', 'Tunnel A', 'serre_tunnel', { x: 50, y: 30 }, 90, 40, 8, 3.5, 'zt');
const B2 = batiment('b2', 'Chapelles', 'serre_chapelle', { x: -40, y: 10 }, 30, 30, 24, 5, 'zc');
const B_MAGASIN = batiment('b3', 'Magasin', 'magasin', { x: -100, y: -60 }, 45, 12, 6, 4, null);
const B_HANGAR = batiment('b4', 'Hangar', 'hangar', { x: 0, y: -80 }, 0, 20, 10, 6, null);
const B_AUTRE = batiment('b5', 'Local', 'autre', { x: -20, y: -60 }, 10, 10, 4, 3, null);
const B_COURT = batiment('b6', 'Petit tunnel', 'serre_tunnel', { x: 60, y: -80 }, 0, 10, 4, 2.5, null);
const B_LONG = batiment('b7', 'Grand tunnel', 'serre_tunnel', { x: 100, y: -80 }, 0, 60, 6, 3, null);

const PLAN: PlanJumeau = {
  saison: { id: 's', nom: '2026', debut: '2026-01-05', fin: '2026-01-25' },
  semaines,
  semaineCourante: 0,
  lignes: [
    zone('zt', 'Tunnel A'),
    planche('p1', 'zt', 10, 1.2, place(2, 0), null, [barreTomate]),
    planche('p2', 'zt', 10, 1.2, place(-2, 0)),
    planche('p3', 'zt', 6, 1, place(2, 12)),
    planche('pa', 'zt', 6, 1, null),
    zone('zc', 'Chapelles'),
    { sorte: 'chapelle' as const, id: 'ch1', nom: 'Chapelle 1' },
    planche('q1', 'zc', 10, 1, place(0, 0)),
    planche('q2', 'zc', 10, 1, place(3, 10, 15)),
    planche('q3', 'zc', 8, 1, place(-3, -10)),
    planche('qc', 'zc', 8, 1, place(6, -5), 'ch1'),
    zone('zl', 'Plein champ L', CONTOUR_L),
    planche('l1', 'zl', 8, 1, place(0, 0)),
    planche('l2', 'zl', 8, 1, place(-2, 5, 90)),
    planche('l3', 'zl', 6, 1, null),
    zone('zr', 'Carré', CONTOUR_CARRE),
    planche('r1', 'zr', 10, 1, null),
    zone('zu', 'À ranger'),
    planche('u1', 'zu', 12, 1.2, place(1, 1, 45)),
    planche('u2', 'zu', 12, 1.2, null),
    planche('u3', 'zu', 8, 1, null),
    zone('zv', 'Verger'),
  ],
  batiments: [B1, B2, B_MAGASIN, B_HANGAR, B_AUTRE, B_COURT, B_LONG],
};

const scene = (plan: PlanJumeau = PLAN, semaine = 0): SceneJumeau => m.versScene(plan, semaine);
const vol = (s: SceneJumeau, id: string): VolumeJumeau => {
  const v = s.volumes.find((x) => x.id === id);
  if (v === undefined) throw new Error(`volume ${id} absent`);
  return v;
};
const socle = (s: SceneJumeau, id: string): SocleJumeau => {
  const z = s.socles.find((x) => x.id === id);
  if (z === undefined) throw new Error(`socle ${id} absent`);
  return z;
};
const bat = (s: SceneJumeau, id: string): BatimentScene => {
  const b = s.batiments.find((x) => x.id === id);
  if (b === undefined) throw new Error(`bâtiment ${id} absent`);
  return b;
};

/** Centre attendu d'une planche : le repère de la zone (moteur de T28a), puis z = −y. */
function attendu(repere: RepereZone, p: PlacementPlanche): Pt & { cap: number } {
  const f = depuisRepereZone(repere, { x: p.x, y: p.y });
  return { x: f.x, z: -f.y, cap: (repere.orientationDeg + p.orientationDeg) % 360 };
}
const repereDe = (b: BatimentPlan): RepereZone => ({ centre: b.centre, orientationDeg: b.orientationDeg });

// ── Zone abritée par une serre : les planches suivent la serre ───────────────────────────────

describe('T28c : serre et planches (repère de zone)', () => {
  it('exemple chiffré du modèle : planche à (2, 0) dans une serre en (50, 30) tournée de 90° → (50, 28) dans la ferme', () => {
    const p1 = vol(scene(), 'p1');
    expect(p1.x).toBeCloseTo(50, 6);
    expect(p1.z).toBeCloseTo(-28, 6); // z = −y
    expect(p1.longueur).toBe(10);
    expect(p1.largeur).toBe(1.2);
    expect(p1.placee).toBe(true);
    // Cap 90° : la longueur de la planche court vers l'est, comme celle de la serre.
    expect(memeAngle(p1.angle, 0, Math.PI)).toBe(true);
  });

  it('la même serre déplacée en (150, 30), orientation 0 : la même planche est en (152, 30) dans la ferme', () => {
    const plan: PlanJumeau = { ...PLAN, batiments: [batiment('b1', 'Tunnel A', 'serre_tunnel', { x: 150, y: 30 }, 0, 40, 8, 3.5, 'zt')] };
    const p1 = vol(scene(plan), 'p1');
    expect(p1.x).toBeCloseTo(152, 6);
    expect(p1.z).toBeCloseTo(-30, 6);
    expect(memeAngle(p1.angle, Math.PI / 2, Math.PI)).toBe(true); // cap 0 : longueur nord-sud
  });

  it('le socle d’une zone abritée est le rectangle de sa serre (centre, largeur, longueur, angle)', () => {
    const s = socle(scene(), 'zt');
    expect(s.placee).toBe(true);
    expect(s.batimentId).toBe('b1');
    expect(s.contour).toBeNull();
    expect(s.x).toBeCloseTo(50, 6);
    expect(s.z).toBeCloseTo(-30, 6);
    expect(s.largeur).toBeCloseTo(8, 6);
    expect(s.profondeur).toBeCloseTo(40, 6);
    expect(memeAngle(s.angle, -Math.PI / 2, Math.PI)).toBe(true);
    // Les coins : la serre court d'ouest en est, de x = 30 à 70, sur 8 m de large.
    const b = aabb(coinsSocle(s));
    expect([b.x0, b.x1, b.z0, b.z1].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([30, 70, -34, -26]);
  });

  it('serre tournée de 30° : chaque planche est à la place que donne le repère de la zone, tournée avec elle', () => {
    const s = scene();
    const repere = repereDe(B2);
    for (const [id, p] of [
      ['q1', place(0, 0)],
      ['q2', place(3, 10, 15)],
      ['q3', place(-3, -10)],
    ] as const) {
      const v = vol(s, id);
      const e = attendu(repere, p);
      expect(v.x, `${id}.x`).toBeCloseTo(e.x, 6);
      expect(v.z, `${id}.z`).toBeCloseTo(e.z, 6);
      expect(memeAngle(v.angle, Math.PI / 2 - e.cap * RAD, Math.PI), `${id}.angle`).toBe(true);
      expect(v.placee).toBe(true);
    }
  });

  it('serre tournée : le vecteur entre deux planches est celui du plan tourné de 30° (rigidité)', () => {
    const s = scene();
    const q1 = vol(s, 'q1');
    const q2 = vol(s, 'q2');
    const dx = q2.x - q1.x;
    const dyFerme = -(q2.z - q1.z);
    // (3, 10) tourné de 30° dans le sens horaire : x' = 3 cos30 + 10 sin30, y' = −3 sin30 + 10 cos30.
    expect(dx).toBeCloseTo(3 * Math.cos(30 * RAD) + 10 * Math.sin(30 * RAD), 6);
    expect(dyFerme).toBeCloseTo(-3 * Math.sin(30 * RAD) + 10 * Math.cos(30 * RAD), 6);
  });

  it('le socle de la serre tournée de 30° porte l’angle de la serre ; elle abrite aussi les planches de ses chapelles', () => {
    const s = scene();
    const z = socle(s, 'zc');
    expect(memeAngle(z.angle, -30 * RAD, Math.PI)).toBe(true);
    expect(z.largeur).toBeCloseTo(24, 6);
    expect(z.profondeur).toBeCloseTo(30, 6);
    const qc = vol(s, 'qc');
    const e = attendu(repereDe(B2), place(6, -5));
    expect(qc.x).toBeCloseTo(e.x, 6);
    expect(qc.z).toBeCloseTo(e.z, 6);
    expect(qc.zoneId).toBe('zc');
  });

  it('une planche sans placement dans la serre est rangée à l’intérieur, alignée sur la serre, sans recouvrir les autres', () => {
    const s = scene();
    const pa = vol(s, 'pa');
    expect(pa.placee).toBe(false);
    expect(pa.longueur).toBe(6);
    expect(dansRect(coinsVolume(pa), coinsSocle(socle(s, 'zt')))).toBe(true);
    expect(memeAngle(pa.angle, 0, Math.PI), 'alignée sur la serre (cap 90°)').toBe(true);
    for (const autre of s.volumes) {
      if (autre.id === 'pa') continue;
      expect(recouvre(coinsVolume(pa), coinsVolume(autre)), `pa recouvre ${autre.id}`).toBe(false);
    }
  });

  it('si une zone a un contour ET une serre (la base le refuse), la serre prime', () => {
    const plan: PlanJumeau = { ...PLAN, lignes: PLAN.lignes.map((l) => (l.sorte === 'zone' && l.id === 'zt' ? zone('zt', 'Tunnel A', CONTOUR_L) : l)) };
    const s = socle(scene(plan), 'zt');
    expect(s.contour).toBeNull();
    expect(s.x).toBeCloseTo(50, 6);
    expect(s.largeur).toBeCloseTo(8, 6);
  });
});

// ── Zone à contour : sol extrudé depuis le polygone ──────────────────────────────────────────

describe('T28c : zone en L (sol extrudé depuis le polygone)', () => {
  it('le socle porte les sommets du contour attendus (x, −y), dans l’ordre du plan', () => {
    const s = socle(scene(), 'zl');
    expect(s.placee).toBe(true);
    expect(s.batimentId).toBeNull();
    expect(s.angle).toBeCloseTo(0, 9);
    expect(s.contour).toEqual(CONTOUR_L.map((p) => ({ x: p.x, z: -p.y })));
  });

  it('x, z, largeur, profondeur du socle = boîte englobante du contour', () => {
    const s = socle(scene(), 'zl');
    expect(s.x).toBeCloseTo(110, 6);
    expect(s.z).toBeCloseTo(-15, 6);
    expect(s.largeur).toBeCloseTo(20, 6);
    expect(s.profondeur).toBeCloseTo(30, 6);
  });

  it('les planches suivent le repère de la zone : centroïde (107,5 ; 12,5) du L, plus long côté nord-sud', () => {
    const s = scene();
    const l1 = vol(s, 'l1');
    expect(l1.x).toBeCloseTo(107.5, 6);
    expect(l1.z).toBeCloseTo(-12.5, 6);
    expect(memeAngle(l1.angle, Math.PI / 2, Math.PI)).toBe(true); // orientation 0 : longueur nord-sud
    // Même résultat que le moteur de T28a pour ce contour.
    const repere = repereZone({ contour: CONTOUR_L });
    if (repere === null) throw new Error('repère du L nul');
    const e = attendu(repere, place(-2, 5, 90));
    const l2 = vol(s, 'l2');
    expect(l2.x).toBeCloseTo(e.x, 6);
    expect(l2.z).toBeCloseTo(e.z, 6);
    expect(l2.x).toBeCloseTo(105.5, 6);
    expect(l2.z).toBeCloseTo(-17.5, 6);
    expect(memeAngle(l2.angle, 0, Math.PI), 'orientation 90 : longueur vers l’est').toBe(true);
  });

  it('une planche sans placement est rangée dans la boîte de la zone, sans recouvrir les autres', () => {
    const s = scene();
    const l3 = vol(s, 'l3');
    expect(l3.placee).toBe(false);
    expect(dansRect(coinsVolume(l3), rectDeAabb(aabb(socle(s, 'zl').contour ?? [])))).toBe(true);
    for (const autre of s.volumes) {
      if (autre.id !== 'l3') expect(recouvre(coinsVolume(l3), coinsVolume(autre)), `l3 recouvre ${autre.id}`).toBe(false);
    }
  });

  it('zone rectangulaire à contour : sa planche non placée est rangée dedans', () => {
    const s = scene();
    const r1 = vol(s, 'r1');
    expect(r1.placee).toBe(false);
    expect(socle(s, 'zr').contour).toEqual(CONTOUR_CARRE.map((p) => ({ x: p.x, z: -p.y })));
    expect(dansRect(coinsVolume(r1), rectDeAabb(aabb(socle(s, 'zr').contour ?? [])))).toBe(true);
  });
});

// ── Repli : ce qui n'est pas placé garde la disposition de T27, à côté ──────────────────────

describe('T28c : zones et planches non placées (repli sur T27)', () => {
  const placees = (s: SceneJumeau): Pt[] => [
    ...s.socles.filter((z) => z.placee).flatMap(formeSocle),
    ...s.batiments.flatMap(coinsBatiment),
    ...s.volumes.filter((v) => v.placee).flatMap(coinsVolume),
  ];

  it('une zone sans contour ni serre est non placée : socle rectangulaire sans angle ni contour', () => {
    const s = scene();
    for (const id of ['zu', 'zv']) {
      const z = socle(s, id);
      expect(z.placee, id).toBe(false);
      expect(z.contour, id).toBeNull();
      expect(z.batimentId, id).toBeNull();
      expect(z.angle, id).toBe(0);
      expect(z.largeur).toBeGreaterThan(0);
      expect(z.profondeur).toBeGreaterThan(0);
    }
  });

  it('elle est rangée à côté de la partie placée : hors de sa boîte englobante, sans recouvrement', () => {
    const s = scene();
    const zone_placee = aabb(placees(s));
    for (const id of ['zu', 'zv']) {
      const b = aabb(formeSocle(socle(s, id)));
      const separe = b.x1 <= zone_placee.x0 + TOL || b.x0 >= zone_placee.x1 - TOL || b.z1 <= zone_placee.z0 + TOL || b.z0 >= zone_placee.z1 - TOL;
      expect(separe, `${id} dans la partie placée`).toBe(true);
    }
    expect(recouvre(formeSocle(socle(s, 'zu')), formeSocle(socle(s, 'zv')))).toBe(false);
  });

  it('ses planches sont rangées sur son socle, sans angle, même si elles portent un placement (sans repère, il n’a pas de sens)', () => {
    const s = scene();
    const u = socle(s, 'zu');
    for (const id of ['u1', 'u2', 'u3']) {
      const v = vol(s, id);
      expect(v.placee, id).toBe(false);
      expect(v.angle, id).toBe(0);
      expect(dansRect(coinsVolume(v), coinsSocle(u)), `${id} hors du socle`).toBe(true);
    }
    // Le placement ignoré ne change rien : mêmes positions que sans placement.
    const sans: PlanJumeau = { ...PLAN, lignes: PLAN.lignes.map((l) => (l.sorte === 'emplacement' && l.id === 'u1' ? { ...l, placement: null } : l)) };
    expect(vol(scene(sans), 'u1')).toEqual(vol(s, 'u1'));
  });

  it('aucune planche ne recouvre une autre, et chacune est dans le socle de sa zone', () => {
    const s = scene();
    for (const a of s.volumes) {
      for (const b of s.volumes) {
        if (a.id < b.id) expect(recouvre(coinsVolume(a), coinsVolume(b)), `${a.id} recouvre ${b.id}`).toBe(false);
      }
      const z = socle(s, a.zoneId);
      expect(dansRect(coinsVolume(a), formeSocle(z)), `${a.id} hors du socle ${z.id}`).toBe(true);
    }
  });

  it('aucun socle ne recouvre un autre socle ni un bâtiment hors de sa propre serre', () => {
    const s = scene();
    for (const a of s.socles) {
      for (const b of s.socles) {
        if (a.id < b.id) expect(recouvre(formeSocle(a), formeSocle(b)), `${a.id} recouvre ${b.id}`).toBe(false);
      }
      for (const b of s.batiments) {
        if (a.batimentId === b.id) continue;
        expect(recouvre(formeSocle(a), coinsBatiment(b)), `${a.id} recouvre le bâtiment ${b.id}`).toBe(false);
      }
    }
    for (const a of s.batiments) {
      for (const b of s.batiments) {
        if (a.id < b.id) expect(recouvre(coinsBatiment(a), coinsBatiment(b)), `${a.id} recouvre ${b.id}`).toBe(false);
      }
    }
  });

  it('un plan sans aucun placement donne la scène de T27 : rien de placé, aucun bâtiment, aucun angle', () => {
    const base = { saison: PLAN.saison, semaines: PLAN.semaines, semaineCourante: PLAN.semaineCourante };
    const nu: PlanJumeau = {
      ...base,
      lignes: PLAN.lignes.map((l) => (l.sorte === 'zone' ? zone(l.id, l.nom) : l.sorte === 'emplacement' ? { ...l, placement: null } : l)),
    };
    const s = scene(nu);
    expect(s.batiments).toEqual([]);
    expect(s.socles.every((z) => !z.placee && z.angle === 0 && z.contour === null && z.batimentId === null)).toBe(true);
    expect(s.volumes.every((v) => !v.placee && v.angle === 0)).toBe(true);
    // Les champs absents (plan de la 2D d’avant T28c) valent les champs nuls.
    const ancien: PlanJumeau = {
      ...nu,
      lignes: nu.lignes.map((l) => {
        if (l.sorte === 'zone') return { sorte: 'zone' as const, id: l.id, nom: l.nom };
        if (l.sorte === 'emplacement') return { sorte: l.sorte, id: l.id, code: l.code, zoneId: l.zoneId, chapelleId: l.chapelleId, barres: l.barres, conflits: l.conflits, longueurM: l.longueurM, largeurM: l.largeurM };
        return l;
      }),
    };
    expect(scene(ancien)).toEqual(s);
  });

  it('un placement partiel est traité comme non placé', () => {
    const casse = (placement: unknown): PlanJumeau => ({ ...PLAN, lignes: PLAN.lignes.map((l) => (l.sorte === 'emplacement' && l.id === 'q1' ? ({ ...l, placement } as typeof l) : l)) });
    for (const p of [{ x: 1, y: 2 }, { x: 1, y: null, orientationDeg: 0 }]) {
      expect(vol(scene(casse(p)), 'q1').placee).toBe(false);
    }
  });
});

// ── Bâtiments ────────────────────────────────────────────────────────────────────────────────

describe('T28c : bâtiments', () => {
  it('un par bâtiment du plan, dans l’ordre du plan, abrité ou non ; aucun si le plan n’en a pas', () => {
    expect(scene().batiments.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']);
    expect(scene({ ...PLAN, batiments: [] }).batiments).toEqual([]);
  });

  it('un bâtiment sans zone (magasin) est posé à sa place : centre, dimensions, hauteur, angle', () => {
    const b = bat(scene(), 'b3');
    expect(b.zoneId).toBeNull();
    expect(b.x).toBeCloseTo(-100, 6);
    expect(b.z).toBeCloseTo(60, 6);
    expect(b.largeur).toBeCloseTo(6, 6);
    expect(b.profondeur).toBeCloseTo(12, 6);
    expect(b.hauteur).toBeCloseTo(4, 6);
    expect(memeAngle(b.angle, -45 * RAD)).toBe(true);
    expect(b.nom).toBe('Magasin');
    expect(b.type).toBe('magasin');
  });

  it('un bâtiment qui abrite une zone la nomme, et son rectangle est celui du socle', () => {
    const s = scene();
    const b = bat(s, 'b1');
    expect(b.zoneId).toBe('zt');
    const z = socle(s, 'zt');
    expect([b.x, b.z, b.largeur, b.profondeur].map((n) => n.toFixed(6))).toEqual([z.x, z.z, z.largeur, z.profondeur].map((n) => n.toFixed(6)));
    expect(memeAngle(b.angle, z.angle, Math.PI)).toBe(true);
  });

  it('hangar, magasin, autre : volumes simples, sans arceaux ni bâche', () => {
    for (const id of ['b3', 'b4', 'b5']) {
      const b = bat(scene(), id);
      expect(b.forme, id).toBe('volume');
      expect(b.arceaux, id).toEqual([]);
      expect(b.nefs, id).toBe(1);
      expect(b.opacite, id).toBe(1);
      expect(Object.values(COULEURS), `${id} : couleur d’un jeton`).toContain(b.couleur);
    }
  });

  it('serre tunnel : des arceaux régulièrement espacés d’environ 2 m, des extrémités de la serre', () => {
    const s = scene();
    for (const [id, longueur] of [
      ['b1', 40],
      ['b6', 10],
      ['b7', 60],
    ] as const) {
      const b = bat(s, id);
      expect(b.forme, id).toBe('tunnel');
      expect(b.nefs, id).toBe(1);
      expect(b.arceaux.length, id).toBeGreaterThanOrEqual(2);
      expect(b.arceaux[0], id).toBeCloseTo(-longueur / 2, 6);
      expect(b.arceaux.at(-1), id).toBeCloseTo(longueur / 2, 6);
      const pas = b.arceaux.slice(1).map((a, i) => a - (b.arceaux[i] ?? 0));
      for (const p of pas) {
        expect(p, `${id} : pas`).toBeGreaterThanOrEqual(1.5);
        expect(p, `${id} : pas`).toBeLessThanOrEqual(2.5);
        expect(p, `${id} : régulier`).toBeCloseTo(pas[0] ?? 0, 6);
      }
    }
  });

  it('plus la serre est longue, plus elle a d’arceaux', () => {
    const s = scene();
    expect(bat(s, 'b6').arceaux.length).toBeLessThan(bat(s, 'b1').arceaux.length);
    expect(bat(s, 'b1').arceaux.length).toBeLessThan(bat(s, 'b7').arceaux.length);
    // Ordre de grandeur : un arceau tous les 2 m environ.
    expect(bat(s, 'b1').arceaux.length).toBeGreaterThanOrEqual(17);
    expect(bat(s, 'b1').arceaux.length).toBeLessThanOrEqual(28);
  });

  it('serre très courte : deux arceaux au moins, aux extrémités', () => {
    const court = batiment('bc', 'Abri', 'serre_tunnel', { x: 0, y: 0 }, 0, 1.5, 2, 2, null);
    const b = bat(scene({ ...PLAN, batiments: [court] }), 'bc');
    expect(b.arceaux).toHaveLength(2);
    expect(b.arceaux[0]).toBeCloseTo(-0.75, 6);
    expect(b.arceaux[1]).toBeCloseTo(0.75, 6);
  });

  it('serre chapelle : des chapelles accolées de 4 à 10 m de large, mêmes arceaux que le tunnel', () => {
    const s = scene();
    const b = bat(s, 'b2');
    expect(b.forme).toBe('chapelles');
    expect(Number.isInteger(b.nefs)).toBe(true);
    expect(b.nefs).toBeGreaterThanOrEqual(2);
    expect(b.largeur / b.nefs).toBeGreaterThanOrEqual(4);
    expect(b.largeur / b.nefs).toBeLessThanOrEqual(10);
    expect(b.arceaux.length).toBeGreaterThanOrEqual(2);
    expect(b.arceaux[0]).toBeCloseTo(-15, 6);
    expect(b.arceaux.at(-1)).toBeCloseTo(15, 6);
  });

  it('une serre est translucide (bâche entre 0 et 0,4 d’opacité), les cultures restent visibles à travers', () => {
    for (const id of ['b1', 'b2', 'b6', 'b7']) {
      const o = bat(scene(), id).opacite;
      expect(o, id).toBeGreaterThan(0);
      expect(o, id).toBeLessThanOrEqual(0.4);
      expect(Object.values(COULEURS), `${id} : couleur d’un jeton`).toContain(bat(scene(), id).couleur);
    }
  });

  it('une chapelle étroite compte une seule chapelle', () => {
    const etroite = batiment('be', 'Étroite', 'serre_chapelle', { x: 0, y: 0 }, 0, 20, 5, 3, null);
    expect(bat(scene({ ...PLAN, batiments: [etroite] }), 'be').nefs).toBe(1);
  });
});

// ── Invariants : semaine, pureté ─────────────────────────────────────────────────────────────

describe('T28c : invariants', () => {
  it('la géométrie ne dépend pas de la semaine (seules les cultures changent)', () => {
    const a = scene(PLAN, 0);
    const b = scene(PLAN, 2);
    expect(b.batiments).toEqual(a.batiments);
    expect(b.socles).toEqual(a.socles);
    expect(b.volumes.map(({ x, z, angle, longueur, largeur, hauteur, placee }) => [x, z, angle, longueur, largeur, hauteur, placee])).toEqual(
      a.volumes.map(({ x, z, angle, longueur, largeur, hauteur, placee }) => [x, z, angle, longueur, largeur, hauteur, placee]),
    );
    expect(vol(a, 'p1').culture).toBe('Tomate');
  });

  it('un volume par planche et un socle par zone, dans l’ordre du plan, comme en T27', () => {
    const s = scene();
    expect(s.socles.map((z) => z.id)).toEqual(['zt', 'zc', 'zl', 'zr', 'zu', 'zv']);
    expect(s.volumes.map((v) => v.id)).toEqual(['p1', 'p2', 'p3', 'pa', 'q1', 'q2', 'q3', 'qc', 'l1', 'l2', 'l3', 'r1', 'u1', 'u2', 'u3']);
  });

  it('pure : l’entrée figée n’est pas modifiée, deux appels donnent le même résultat', () => {
    const fige = <T>(o: T): T => {
      if (typeof o === 'object' && o !== null) for (const v of Object.values(o)) fige(v);
      return Object.freeze(o);
    };
    const plan = fige(structuredClone(PLAN));
    expect(m.versScene(plan, 1)).toEqual(m.versScene(plan, 1));
    expect(plan).toEqual(PLAN);
  });

  it('l’adaptateur n’appelle ni Date ni Math.random et n’importe ni three ni React', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL(CHEMIN_SCENE, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bnew Date\b|\bDate\.now\b|Math\.random/);
    expect(source).not.toMatch(/from\s+['"](three|react|@react-three)/);
  });
});

// ── Filtres de T27b ──────────────────────────────────────────────────────────────────────────

type SceneFiltreeJumeau = Omit<SceneJumeau, 'volumes'> & { readonly volumes: readonly (VolumeJumeau & { readonly estompe: boolean })[] };
const filtrer = (s: SceneJumeau, filtres: FiltresScene): SceneFiltreeJumeau => m.appliquerFiltres(s, filtres) as unknown as SceneFiltreeJumeau;

describe('T28c : les filtres de T27b restent valides sur une ferme placée', () => {
  it('appliquerFiltres ne touche ni la géométrie, ni les angles, ni les bâtiments', () => {
    const s = scene();
    const f = filtrer(s, { familles: new Set<string>(), cultures: new Set<string>(), zones: new Set<string>() });
    expect(s.batiments.length, 'la scène a des bâtiments').toBeGreaterThan(0);
    expect(f.batiments).toEqual(s.batiments);
    expect(f.socles).toEqual(s.socles);
    f.volumes.forEach((v, i) => {
      const o = s.volumes[i];
      if (o === undefined) throw new Error('volume manquant');
      expect([v.id, v.x, v.z, v.angle, v.longueur, v.largeur, v.hauteur, v.placee]).toEqual([o.id, o.x, o.z, o.angle, o.longueur, o.largeur, o.hauteur, o.placee]);
      expect(v.estompe).toBe(true);
    });
  });

  it('la zone d’une serre est une zone comme les autres pour le filtre « zones »', () => {
    const s = scene();
    expect(m.optionsFiltres(s).zones.map((z) => z.id)).toEqual(['zt', 'zc', 'zl', 'zr', 'zu', 'zv']);
    const f = filtrer(s, { familles: null, cultures: null, zones: new Set(['zt']) });
    expect(f.volumes.filter((v) => !v.estompe).map((v) => v.zoneId)).toEqual(['zt', 'zt', 'zt', 'zt']);
  });

  it('une planche filtrée garde sa couleur estompée : la serre ne porte pas de couleur de culture', () => {
    const s = scene();
    for (const b of s.batiments) expect(Object.values(COULEURS)).toContain(b.couleur);
    const f = filtrer(s, { familles: new Set(['rosacees']), cultures: null, zones: null });
    expect(f.volumes.find((v) => v.id === 'p1')?.couleur).not.toBe(vol(s, 'p1').couleur);
  });
});

// ── Vol de T29 ───────────────────────────────────────────────────────────────────────────────

type CibleVol = CibleT29 | { readonly sorte: 'batiment'; readonly id: string };
const boiteDe = (s: SceneJumeau, cible: CibleVol) => (cadrage.boiteDe as (s: SceneJumeau, c: CibleVol) => ReturnType<ModuleCadrage['boiteDe']>)(s, cible);

describe('T28c : le vol de T29 vise aussi une serre', () => {
  it('zone abritée : la boîte est le rectangle de la serre, avec son angle, de 0 à la hauteur de la serre', () => {
    const s = scene();
    const b = boiteDe(s, { sorte: 'zone', id: 'zt' });
    if (b === null) throw new Error('boîte nulle');
    const z = socle(s, 'zt');
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(z.x, 6);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(z.z, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(z.largeur, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(z.profondeur, 6);
    expect(memeAngle(b.angle ?? 0, z.angle, Math.PI)).toBe(true);
    expect(b.min.y).toBe(0);
    expect(b.max.y).toBeCloseTo(3.5, 6); // la serre est plus haute que ses planches (0,3 m)
    // Les coins de la boîte tournée sont ceux de la serre.
    const a = aabb(coinsDe(b).map((p) => ({ x: p.x, z: p.z })));
    const e = aabb(coinsSocle(z));
    expect([a.x0, a.x1, a.z0, a.z1].map((n) => n.toFixed(5))).toEqual([e.x0, e.x1, e.z0, e.z1].map((n) => n.toFixed(5)));
  });

  it('zone à contour : la boîte du socle, sans angle ; zone non placée : inchangé (socle et planches)', () => {
    const s = scene();
    const l = boiteDe(s, { sorte: 'zone', id: 'zl' });
    if (l === null) throw new Error('boîte nulle');
    expect(l.angle ?? 0).toBe(0);
    expect(l.max.x - l.min.x).toBeCloseTo(20, 6);
    expect(l.max.z - l.min.z).toBeCloseTo(30, 6);
    const u = boiteDe(s, { sorte: 'zone', id: 'zu' });
    if (u === null) throw new Error('boîte nulle');
    expect(u.angle ?? 0).toBe(0);
    expect(u.max.y).toBeCloseTo(vol(s, 'u1').hauteur, 6);
  });

  it('bâtiment sans zone : sa boîte, avec son angle ; identifiant inconnu → RangeError', () => {
    const s = scene();
    const b = boiteDe(s, { sorte: 'batiment', id: 'b3' });
    if (b === null) throw new Error('boîte nulle');
    expect(b.max.x - b.min.x).toBeCloseTo(6, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(12, 6);
    expect(b.max.y).toBeCloseTo(4, 6);
    expect(memeAngle(b.angle ?? 0, -45 * RAD)).toBe(true);
    expect(() => boiteDe(s, { sorte: 'batiment', id: 'inconnu' })).toThrow(RangeError);
    expect(() => boiteDe(s, { sorte: 'zone', id: 'inconnue' })).toThrow(RangeError);
  });

  it('toute la ferme : la boîte contient les coins de chaque socle, bâtiment et volume, sans marge inutile', () => {
    const s = scene();
    const b = boiteDe(s, { sorte: 'ferme' });
    if (b === null) throw new Error('boîte nulle');
    const tous = [...s.socles.flatMap(formeSocle), ...s.batiments.flatMap(coinsBatiment), ...s.volumes.flatMap(coinsVolume)];
    const e = aabb(tous);
    expect(b.min.x).toBeCloseTo(e.x0, 5);
    expect(b.max.x).toBeCloseTo(e.x1, 5);
    expect(b.min.z).toBeCloseTo(e.z0, 5);
    expect(b.max.z).toBeCloseTo(e.z1, 5);
    expect(b.max.y).toBeCloseTo(Math.max(...s.batiments.map((x) => x.hauteur), ...s.volumes.map((v) => v.hauteur)), 6);
    expect(b.angle ?? 0).toBe(0);
  });

  it('le cadrage d’une serre tournée la tient entière à l’écran', () => {
    const s = scene();
    const b = boiteDe(s, { sorte: 'zone', id: 'zc' });
    if (b === null) throw new Error('boîte nulle');
    expect(memeAngle(b.angle ?? 0, -30 * RAD, Math.PI)).toBe(true);
    const pose = cadrage.cadrage(b, 40, 16 / 9, { x: 0, z: 1 });
    for (const n of [pose.position.x, pose.position.y, pose.position.z, pose.cible.x, pose.cible.y, pose.cible.z]) expect(Number.isFinite(n)).toBe(true);
    expect(pose.cible.x).toBeCloseTo(socle(s, 'zc').x, 6);
    expect(pose.cible.z).toBeCloseTo(socle(s, 'zc').z, 6);
  });

  it('une scène écrite à la main, sans bâtiments ni angles (T29), se cadre toujours', () => {
    const ancienne = {
      semaine: 0,
      libelleSemaine: 'S01',
      socles: [{ id: 'z', nom: 'Z', x: 0, z: 0, largeur: 10, profondeur: 6 }],
      volumes: [{ id: 'v', code: 'V', zoneId: 'z', x: 0, z: 0, longueur: 4, largeur: 1, hauteur: 0.3, couleur: '#000000', cleFamille: null, culture: null, occupationId: null }],
    };
    const boite = (c: CibleVol) => (cadrage.boiteDe as (s: unknown, c: CibleVol) => ReturnType<ModuleCadrage['boiteDe']>)(ancienne, c);
    expect(boite({ sorte: 'ferme' })).not.toBeNull();
    expect(boite({ sorte: 'zone', id: 'z' })).not.toBeNull();
    expect(() => boite({ sorte: 'batiment', id: 'b' })).toThrow(RangeError);
  });
});

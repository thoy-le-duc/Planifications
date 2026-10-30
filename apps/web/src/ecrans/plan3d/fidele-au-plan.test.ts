/**
 * Tests d'acceptation T91 — la 3D montre exactement le plan, rien d'inventé (docs/backlog/
 * T91-3d-fidele-au-plan.md). Scène PURE (`versScene`) : ni three ni DOM.
 *
 *   1. Seul ce qui est placé est dans la scène : une zone sans contour ni serre n'y est plus (plus de
 *      grille inventée) ; elle est listée dans `scene.aPlacer`, dans l'ordre du plan.
 *   2. Une planche d'une sous-zone hors serre est lue dans le repère de la sous-zone si elle a un
 *      contour, sinon dans celui de la racine (le même que dans l'éditeur : voir
 *      placement/repere-sous-zone-editeur.test.tsx).
 *   3. Une sous-zone avec contour hors serre a son socle, comme une zone.
 *
 * Repères attendus calculés avec le moteur (`repereZone`, `depuisRepereZone`) : x_scène = x_ferme,
 * z_scène = −y_ferme.
 */
import { depuisRepereZone, repereZone } from '@planif/core/placement';
import { describe, expect, it } from 'vitest';
import type { LigneEmplacementPlan, LigneZonePlan, Plan, PointPlan, SemainePlan, SousZonePlan } from '../plan/calculs.ts';
import { sceneDeLaSemaine, versScene, type Scene } from './scene.ts';

// Les champs de T91, déclarés ici pour que le fichier se lise sans dépendre de l'ordre d'écriture du code.
interface ZoneAPlacer {
  readonly id: string;
  readonly nom: string;
}
type SceneT91 = Scene & { readonly aPlacer?: readonly ZoneAPlacer[] };
type SousZoneT91 = SousZonePlan & { readonly contour?: readonly PointPlan[] | null };
type PlancheT91 = LigneEmplacementPlan & { readonly zoneDirecteId?: string };

const semaines: SemainePlan[] = [0, 1].map((i) => ({ annee: 2026, semaine: i + 1, libelle: `S0${String(i + 1)}`, lundi: `2026-01-${String(5 + 7 * i).padStart(2, '0')}` }));

const rect = (x0: number, y0: number, x1: number, y1: number): PointPlan[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
/** Racine A (placée), sous-zone S (contour, loin d'A), racine B (rien de placé). */
const CONTOUR_A = rect(0, 0, 20, 10);
const CONTOUR_S = rect(100, 40, 110, 80);

const zone = (id: string, nom: string, contour?: PointPlan[]): LigneZonePlan => ({ sorte: 'zone', id, nom, ...(contour === undefined ? {} : { contour }) });
function planche(id: string, zoneId: string, placement: { x: number; y: number; orientationDeg: number } | null, directe?: string): PlancheT91 {
  return {
    sorte: 'emplacement',
    id,
    code: id.toUpperCase(),
    zoneId,
    chapelleId: directe !== undefined && directe !== zoneId ? directe : null,
    ...(directe === undefined ? {} : { zoneDirecteId: directe }),
    longueurM: 6,
    largeurM: 1,
    barres: [],
    conflits: [],
    ...(placement === null ? {} : { placement }),
  };
}
const plan = (lignes: Plan['lignes'], sousZones: readonly SousZoneT91[] = [], batiments: Plan['batiments'] = []): Plan =>
  ({
    saison: { id: 's', nom: '2026', debut: '2026-01-05', fin: '2026-01-18' },
    semaines,
    semaineCourante: 0,
    lignes,
    ...(batiments.length === 0 ? {} : { batiments }),
    ...(sousZones.length === 0 ? {} : { sousZones }),
  });

const scene = (p: Plan): SceneT91 => versScene(p, 0);
const volume = (s: Scene, id: string) => {
  const v = s.volumes.find((x) => x.id === id);
  if (v === undefined) throw new Error(`volume ${id} absent`);
  return v;
};
/** Où le moteur met la planche (x, y du placement) dans le repère du contour : en repère de scène. */
function attendu(contour: readonly PointPlan[], x: number, y: number): { x: number; z: number } {
  const repere = repereZone({ contour });
  if (repere === null) throw new Error('contour sans repère');
  const p = depuisRepereZone(repere, { x, y });
  return { x: p.x, z: -p.y };
}

describe('T91 : la scène ne contient que ce qui est placé', () => {
  const PLAN = plan([
    zone('zA', 'Plein champ', CONTOUR_A),
    planche('pA', 'zA', { x: 1, y: 2, orientationDeg: 0 }),
    zone('zB', 'Verger'),
    planche('pB1', 'zB', null),
    planche('pB2', 'zB', { x: 1, y: 1, orientationDeg: 0 }),
  ]);

  it('une zone placée et une non placée : un seul socle, seules les planches de la première, « À placer (1) »', () => {
    const s = scene(PLAN);
    expect(s.socles.map((z) => z.id)).toEqual(['zA']);
    expect(s.volumes.map((v) => v.id)).toEqual(['pA']);
    expect(s.aPlacer).toEqual([{ id: 'zB', nom: 'Verger' }]);
  });

  it('la zone placée reste à sa vraie place, la zone non placée ne la déplace pas', () => {
    const v = volume(scene(PLAN), 'pA');
    const a = attendu(CONTOUR_A, 1, 2);
    expect(v.x).toBeCloseTo(a.x, 6);
    expect(v.z).toBeCloseTo(a.z, 6);
    expect(v.placee).toBe(true);
  });

  it('rien de placé : scène vide, toutes les zones à placer dans l’ordre du plan', () => {
    const s = scene(plan([zone('zB', 'Verger'), planche('pB1', 'zB', null), zone('zC', 'Tunnel'), planche('pC1', 'zC', null)]));
    expect(s.socles).toEqual([]);
    expect(s.volumes).toEqual([]);
    expect(s.aPlacer?.map((z) => z.id)).toEqual(['zB', 'zC']);
  });

  it('tout est placé : rien à placer (liste vide)', () => {
    expect(scene(plan([zone('zA', 'Plein champ', CONTOUR_A), planche('pA', 'zA', null)])).aPlacer ?? []).toEqual([]);
  });

  it('la scène d’une autre semaine garde la liste « À placer »', () => {
    const base = scene(PLAN);
    expect((sceneDeLaSemaine(base, PLAN, 1) as SceneT91).aPlacer).toEqual(base.aPlacer);
  });

  it('une zone abritée par une serre est placée (socle et planches), pas « à placer »', () => {
    const p = plan(
      [zone('zS', 'Tunnel 1'), planche('pS', 'zS', { x: 0, y: 1, orientationDeg: 0 })],
      [],
      [{ id: 'b1', nom: 'Tunnel 1', type: 'serre_tunnel', longueurM: 30, largeurM: 8, hauteurM: 3.5, centre: { x: 50, y: 20 }, orientationDeg: 0, zoneId: 'zS' }],
    );
    const s = scene(p);
    expect(s.socles.map((z) => z.id)).toEqual(['zS']);
    expect(s.volumes.map((v) => v.id)).toEqual(['pS']);
    expect(s.aPlacer ?? []).toEqual([]);
  });
});

describe('T91 : planches d’une sous-zone hors serre, un seul repère', () => {
  const SOUS_AVEC: SousZoneT91 = { id: 'sz', nom: 'Rang 3', parenteId: 'zA', contour: CONTOUR_S };
  const SOUS_SANS: SousZoneT91 = { id: 'sz', nom: 'Rang 3', parenteId: 'zA', contour: null };

  it('sous-zone avec contour : la planche est dans le repère de la sous-zone, pas dans celui de la racine', () => {
    const s = scene(
      plan([zone('zA', 'Plein champ', CONTOUR_A), planche('pA', 'zA', { x: 1, y: 2, orientationDeg: 0 }), planche('pS', 'zA', { x: 2, y: 3, orientationDeg: 90 }, 'sz')], [SOUS_AVEC]),
    );
    const a = attendu(CONTOUR_S, 2, 3);
    expect(volume(s, 'pS').x).toBeCloseTo(a.x, 6);
    expect(volume(s, 'pS').z).toBeCloseTo(a.z, 6);
    const racine = attendu(CONTOUR_A, 2, 3);
    expect(Math.hypot(volume(s, 'pS').x - racine.x, volume(s, 'pS').z - racine.z)).toBeGreaterThan(50);
    // La planche directe de la racine ne bouge pas.
    const b = attendu(CONTOUR_A, 1, 2);
    expect(volume(s, 'pA').x).toBeCloseTo(b.x, 6);
    expect(volume(s, 'pA').z).toBeCloseTo(b.z, 6);
  });

  it('sous-zone sans contour : la planche est dans le repère de la racine', () => {
    const s = scene(plan([zone('zA', 'Plein champ', CONTOUR_A), planche('pS', 'zA', { x: 2, y: 3, orientationDeg: 0 }, 'sz')], [SOUS_SANS]));
    const a = attendu(CONTOUR_A, 2, 3);
    expect(volume(s, 'pS').x).toBeCloseTo(a.x, 6);
    expect(volume(s, 'pS').z).toBeCloseTo(a.z, 6);
    expect(s.socles.map((z) => z.id)).toEqual(['zA']);
  });

  it('une sous-zone avec contour a son socle (sommets en repère de scène), après sa racine', () => {
    const s = scene(plan([zone('zA', 'Plein champ', CONTOUR_A), planche('pA', 'zA', null)], [SOUS_AVEC]));
    expect(s.socles.map((z) => z.id)).toEqual(['zA', 'sz']);
    const sz = s.socles.find((z) => z.id === 'sz');
    expect(sz?.nom).toBe('Rang 3');
    expect(sz?.placee).toBe(true);
    expect(sz?.contour).toEqual(CONTOUR_S.map((p) => ({ x: p.x, z: -p.y })));
  });

  it('une sous-zone avec contour sans aucune planche a son socle quand même', () => {
    const s = scene(plan([zone('zA', 'Plein champ', CONTOUR_A), planche('pA', 'zA', null)], [SOUS_AVEC]));
    expect(s.volumes.filter((v) => v.zoneId === 'sz')).toEqual([]);
    expect(s.socles.some((z) => z.id === 'sz')).toBe(true);
  });

  it('une planche non placée d’une sous-zone avec contour se range dans cette sous-zone', () => {
    const s = scene(plan([zone('zA', 'Plein champ', CONTOUR_A), planche('pS', 'zA', null, 'sz')], [SOUS_AVEC]));
    const v = volume(s, 'pS');
    expect(v.placee).toBe(false);
    expect(v.x).toBeGreaterThanOrEqual(100);
    expect(v.x).toBeLessThanOrEqual(110);
    expect(-v.z).toBeGreaterThanOrEqual(40);
    expect(-v.z).toBeLessThanOrEqual(80);
  });

  it('racine sans contour mais sous-zone placée : la sous-zone se dessine, la racine n’est « à placer » que si elle a ses propres planches', () => {
    const racine = zone('zA', 'Plein champ');
    const seule = scene(plan([racine, planche('pS', 'zA', { x: 2, y: 3, orientationDeg: 0 }, 'sz')], [SOUS_AVEC]));
    expect(seule.socles.map((z) => z.id)).toEqual(['sz']);
    expect(seule.volumes.map((v) => v.id)).toEqual(['pS']);
    expect(seule.aPlacer ?? []).toEqual([]);

    const avecDirecte = scene(plan([racine, planche('pA', 'zA', { x: 1, y: 1, orientationDeg: 0 }, 'zA'), planche('pS', 'zA', { x: 2, y: 3, orientationDeg: 0 }, 'sz')], [SOUS_AVEC]));
    expect(avecDirecte.volumes.map((v) => v.id)).toEqual(['pS']);
    expect(avecDirecte.aPlacer).toEqual([{ id: 'zA', nom: 'Plein champ' }]);
  });

  it('racine abritée par une serre : le contour de la sous-zone est ignoré, la planche reste dans le repère de la serre, pas de socle de sous-zone', () => {
    const serre = { id: 'b1', nom: 'Tunnel 1', type: 'serre_tunnel' as const, longueurM: 30, largeurM: 8, hauteurM: 3.5, centre: { x: 50, y: 20 }, orientationDeg: 0, zoneId: 'zA' };
    const s = scene(plan([zone('zA', 'Tunnel 1'), planche('pS', 'zA', { x: 1, y: 2, orientationDeg: 0 }, 'sz')], [SOUS_AVEC], [serre]));
    expect(s.socles.map((z) => z.id)).toEqual(['zA']);
    expect(volume(s, 'pS').x).toBeCloseTo(51, 6);
    expect(volume(s, 'pS').z).toBeCloseTo(-22, 6);
  });
});

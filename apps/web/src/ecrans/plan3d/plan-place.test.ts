/**
 * Tests d'acceptation T28c — le plan de la 2D porte le placement réel (contour des zones, placement
 * des planches, bâtiments), recopié de la base locale sans calcul, pour que la 3D n'ait rien à
 * lire d'autre. Contrat : ./test/contrat-jumeau.ts (« Ce que T28c demande au plan 2D »).
 * Deux étages : `construirePlan` sur des lignes écrites à la main, puis `chargerPlan` sur la grande
 * ferme de T07 placée (packages/sync/src/test/placement-t07.ts), et la scène qui en sort.
 */
import { validerContour, validerPlacement } from '@planif/core';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { beforeAll, describe, expect, it } from 'vitest';
import { creerBaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../../../packages/sync/src/test/jeu-t07.ts';
import { placerJeuT07 } from '../../../../../packages/sync/src/test/placement-t07.ts';
import type { ModuleCalculsPlan } from '../plan/test/contrat.ts';
import { PETITE_FERME, SAISON_2026, Z, E } from '../plan/test/petite-ferme.ts';
import type { ModuleScene } from './test/contrat.ts';
import type { BatimentPlan, LigneEmplacementPlan3d, LigneZonePlan3d, ModuleJumeau, PlanJumeau } from './test/contrat-jumeau.ts';

const CHEMIN_CALCULS = '../plan/calculs.ts';
const CHEMIN_SCENE = './scene.ts';

let calculs: ModuleCalculsPlan;
let m: ModuleJumeau & ModuleScene;

beforeAll(async () => {
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  m = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleJumeau & ModuleScene;
});

const OPTIONS = { saison: SAISON_2026, aujourdhui: '2026-06-10' };
const CONTOUR = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 30 },
  { x: 0, y: 30 },
];
const C = '2026-01-15T08:00:00.000Z';
const LIGNE_BATIMENT = {
  id: '0192f0c1-0000-7000-8000-00000000b001',
  ferme_id: '0192f0c1-0000-7000-8000-00000000f001',
  nom: 'Tunnel 2',
  type: 'serre_tunnel',
  longueur_m: 40,
  largeur_m: 8,
  hauteur_m: 3.5,
  centre_x_m: 50,
  centre_y_m: 30,
  orientation_deg: 90,
  zone_id: Z.tunnel2,
  cree_le: C,
  modifie_le: C,
  supprime_le: null,
};

function planPlace(): PlanJumeau {
  const donnees = {
    ...PETITE_FERME,
    zone: PETITE_FERME.zone.map((z) => (z.id === Z.tunnel10 ? { ...z, contour: JSON.stringify(CONTOUR) } : z)),
    emplacement: PETITE_FERME.emplacement.map((e) => (e.id === E.t10p1 ? { ...e, placement_x_m: -2.5, placement_y_m: 4, orientation_deg: 90 } : e)),
    batiment: [LIGNE_BATIMENT, { ...LIGNE_BATIMENT, id: '0192f0c1-0000-7000-8000-00000000b002', nom: 'Ancien magasin', type: 'magasin', zone_id: null, supprime_le: C }],
  };
  return calculs.construirePlan(donnees, OPTIONS) as unknown as PlanJumeau;
}

describe('T28c : construirePlan recopie le placement', () => {
  it('une zone à contour porte ses points (repère de la ferme), les autres un contour nul', () => {
    const lignes = planPlace().lignes.filter((l): l is LigneZonePlan3d => l.sorte === 'zone');
    const t10 = lignes.find((l) => l.id === Z.tunnel10);
    expect(t10?.contour).toEqual(CONTOUR);
    for (const l of lignes.filter((x) => x.id !== Z.tunnel10)) expect(l.contour ?? null, l.nom).toBeNull();
  });

  it('une planche placée porte x, y et son orientation ; les autres un placement nul', () => {
    const planches = planPlace().lignes.filter((l): l is LigneEmplacementPlan3d => l.sorte === 'emplacement');
    expect(planches.find((l) => l.id === E.t10p1)?.placement).toEqual({ x: -2.5, y: 4, orientationDeg: 90 });
    expect(planches.length).toBeGreaterThan(1);
    for (const l of planches.filter((x) => x.id !== E.t10p1)) expect(l.placement ?? null, l.code).toBeNull();
  });

  it('les bâtiments du plan sont ceux de la ferme non supprimés, avec leur zone abritée', () => {
    const batiments: readonly BatimentPlan[] = planPlace().batiments ?? [];
    expect(batiments).toEqual([
      {
        id: LIGNE_BATIMENT.id,
        nom: 'Tunnel 2',
        type: 'serre_tunnel',
        longueurM: 40,
        largeurM: 8,
        hauteurM: 3.5,
        centre: { x: 50, y: 30 },
        orientationDeg: 90,
        zoneId: Z.tunnel2,
      },
    ]);
  });

  it('sans ligne de bâtiment, ni contour, ni placement : le plan est celui d’avant (aucun bâtiment, rien de placé)', () => {
    const plan = calculs.construirePlan(PETITE_FERME, OPTIONS) as unknown as PlanJumeau;
    expect(plan.batiments ?? []).toEqual([]);
    for (const l of plan.lignes) {
      if (l.sorte === 'zone') expect(l.contour ?? null).toBeNull();
      if (l.sorte === 'emplacement') expect(l.placement ?? null).toBeNull();
    }
  });

  it('le placement fait passer la scène de la zone abritée et de la zone à contour à « placée »', () => {
    const s = m.versScene(planPlace(), 0);
    expect(s.batiments.map((b) => b.id)).toEqual([LIGNE_BATIMENT.id]);
    const socles = new Map(s.socles.map((z) => [z.id, z]));
    expect((socles.get(Z.tunnel2) as { placee?: boolean } | undefined)?.placee).toBe(true);
    expect((socles.get(Z.tunnel10) as { placee?: boolean } | undefined)?.placee).toBe(true);
    expect((socles.get(Z.serre) as { placee?: boolean } | undefined)?.placee).toBe(false);
  });
});

describe('T28c : chargerPlan sur la grande ferme de T07 placée', () => {
  it('lit contours, placements et bâtiments dans la base locale ; tout est valide pour le moteur de T28a', { timeout: 120_000 }, async () => {
    const base = creerBaseMemoire(SCHEMA_LOCAL);
    try {
      const jeu = await remplirJeuT07(base);
      const fermeId = jeu.principale.fermeId;
      const bilan = await placerJeuT07(base, fermeId);
      expect(bilan.serres).toBe(12);
      expect(bilan.zonesAContour).toBe(14);
      expect(bilan.zonesNonPlacees).toBe(4);
      expect(bilan.batiments).toBe(14);
      expect(bilan.planchesPlacees).toBeGreaterThan(200);
      expect(bilan.planchesNonPlacees).toBeGreaterThan(50);

      const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: fermeId as Id<'Ferme'> });
      const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, fermeId), '2026-06-10');
      if (saison === null) throw new Error('jeu de T07 sans saison');
      const plan = (await calculs.chargerPlan(porte, fermeId, { saison, aujourdhui: '2026-06-10' })) as unknown as PlanJumeau;

      expect(plan.batiments?.length).toBe(bilan.batiments);
      const zones = plan.lignes.filter((l): l is LigneZonePlan3d => l.sorte === 'zone');
      expect(zones.filter((z) => (z.contour ?? null) !== null)).toHaveLength(bilan.zonesAContour);
      const planches = plan.lignes.filter((l): l is LigneEmplacementPlan3d => l.sorte === 'emplacement');
      expect(planches.filter((p) => (p.placement ?? null) !== null)).toHaveLength(bilan.planchesPlacees);

      for (const z of zones) if (z.contour) expect(validerContour(z.contour).ok, z.nom).toBe(true);
      for (const b of plan.batiments ?? []) {
        const r = validerPlacement({
          table: 'batiment',
          ligne: { longueur_m: b.longueurM, largeur_m: b.largeurM, hauteur_m: b.hauteurM, centre_x_m: b.centre.x, centre_y_m: b.centre.y, orientation_deg: b.orientationDeg },
        });
        expect(r.ok, b.nom).toBe(true);
      }
      for (const p of planches) {
        if (p.placement == null) continue;
        const r = validerPlacement({ table: 'emplacement', ligne: { placement_x_m: p.placement.x, placement_y_m: p.placement.y, orientation_deg: p.placement.orientationDeg } });
        expect(r.ok, p.code).toBe(true);
      }

      // La scène : une serre par bâtiment abrité, arceaux dessinés, planches placées comptées.
      const s = m.versScene(plan, 0);
      expect(s.batiments).toHaveLength(bilan.batiments);
      expect(s.batiments.filter((b) => b.forme !== 'volume')).toHaveLength(12);
      expect(s.batiments.reduce((n, b) => n + b.arceaux.length, 0)).toBeGreaterThan(200);
      expect(s.volumes.filter((v) => v.placee)).toHaveLength(bilan.planchesPlacees);
      expect(s.socles.filter((z) => z.placee)).toHaveLength(bilan.zonesAbritees + bilan.zonesAContour);
    } finally {
      base.fermer();
    }
  });
});

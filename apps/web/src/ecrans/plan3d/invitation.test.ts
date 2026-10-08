/**
 * Tests d'acceptation T28f — `fermeSansPlacement(plan)` : quand la 3D invite à placer la ferme
 * (encart « Placez votre ferme sur la photo aérienne »). Contrat : ./test/contrat-editeur.ts.
 * Plan construit par `construirePlan` sur la petite ferme de T11, avec ou sans placement.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DonneesPlan } from '../plan/calculs.ts';
import type { ModuleCalculsPlan } from '../plan/test/contrat.ts';
import { PETITE_FERME, SAISON_2026, Z, E } from '../plan/test/petite-ferme.ts';
import type { PlanJumeau } from './test/contrat-jumeau.ts';
import type { ModuleInvitation } from './test/contrat-editeur.ts';

const CHEMIN_CALCULS = '../plan/calculs.ts';
const CHEMIN_INVITATION = './invitation.ts';

let calculs: ModuleCalculsPlan;
let m: ModuleInvitation;

beforeAll(async () => {
  calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  m = (await import(/* @vite-ignore */ CHEMIN_INVITATION)) as ModuleInvitation;
});

const OPTIONS = { saison: SAISON_2026, aujourdhui: '2026-06-10' };
const C = '2026-01-15T08:00:00.000Z';
const CONTOUR = JSON.stringify([
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
]);
const BATIMENT = {
  id: '0192f0c1-0000-7000-8000-00000000b001',
  ferme_id: '0192f0c1-0000-7000-8000-00000000f001',
  nom: 'Hangar',
  type: 'hangar',
  longueur_m: 20,
  largeur_m: 12,
  hauteur_m: 6,
  centre_x_m: -10,
  centre_y_m: 15,
  orientation_deg: 0,
  zone_id: null,
  cree_le: C,
  modifie_le: C,
  supprime_le: null,
};

function plan(modifier: (d: DonneesPlan) => Partial<DonneesPlan> = () => ({})): PlanJumeau {
  const donnees: DonneesPlan = { ...PETITE_FERME, ...modifier(PETITE_FERME) };
  return calculs.construirePlan(donnees, OPTIONS) as unknown as PlanJumeau;
}

describe('T28f : fermeSansPlacement', () => {
  it('la petite ferme de T11 n’a rien de placé : vrai', () => {
    expect(m.fermeSansPlacement(plan())).toBe(true);
  });

  it('un seul bâtiment placé suffit : faux', () => {
    expect(m.fermeSansPlacement(plan(() => ({ batiment: [BATIMENT] })))).toBe(false);
  });

  it('un bâtiment supprimé ne compte pas : vrai', () => {
    expect(m.fermeSansPlacement(plan(() => ({ batiment: [{ ...BATIMENT, supprime_le: C }] })))).toBe(true);
  });

  it('une seule zone à contour suffit : faux', () => {
    const p = plan((d) => ({ zone: d.zone.map((z) => (z.id === Z.tunnel10 ? { ...z, contour: CONTOUR } : z)) }));
    expect(m.fermeSansPlacement(p)).toBe(false);
  });

  it('un contour vide (« [] ») ou nul ne compte pas : vrai', () => {
    const p = plan((d) => ({ zone: d.zone.map((z) => (z.id === Z.tunnel10 ? { ...z, contour: '[]' } : z)) }));
    expect(m.fermeSansPlacement(p)).toBe(true);
  });

  it('une seule planche positionnée suffit : faux', () => {
    const p = plan((d) => ({ emplacement: d.emplacement.map((e) => (e.id === E.t10p1 ? { ...e, placement_x_m: 1, placement_y_m: 2, orientation_deg: 0 } : e)) }));
    expect(m.fermeSansPlacement(p)).toBe(false);
  });

  it('un plan sans aucune zone ni planche est sans placement : vrai', () => {
    const vide = { ...plan(), lignes: [] } as PlanJumeau;
    expect(m.fermeSansPlacement(vide)).toBe(true);
  });

  it('pure : le plan n’est pas modifié, deux appels donnent la même réponse', () => {
    const p = plan(() => ({ batiment: [BATIMENT] }));
    const avant = JSON.stringify(p);
    expect(m.fermeSansPlacement(p)).toBe(m.fermeSansPlacement(p));
    expect(JSON.stringify(p)).toBe(avant);
  });
});

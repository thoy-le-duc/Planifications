/**
 * T59 — `sceneDeLaSemaine(base, plan, semaine)` : la scène d'une semaine sans refaire la géométrie
 * (lecture fluide de la saison). Elle doit donner exactement `versScene(plan, semaine)`.
 */
import { describe, expect, it } from 'vitest';
import { construirePlan, type BarrePlan, type Plan, type SemainePlan } from '../plan/calculs.ts';
import { PETITE_FERME, SAISON_2026 } from '../plan/test/petite-ferme.ts';
import { sceneDeLaSemaine, versScene } from './scene.ts';

const semaines: SemainePlan[] = [0, 1, 2, 3].map((i) => ({ annee: 2026, semaine: i + 1, libelle: `S0${String(i + 1)}`, lundi: `2026-01-${String(5 + 7 * i).padStart(2, '0')}` }));

const barre = (occupationId: string, libelle: string, cleFamille: BarrePlan['cleFamille'], debutJour: number, finJour: number): BarrePlan => ({
  occupationId,
  serieId: null,
  plantationId: null,
  libelle,
  famille: null,
  cleFamille,
  etat: 'prevu',
  du: '2026-01-05',
  au: null,
  debutJour,
  finJour,
  enConflit: false,
});

const PLAN: Plan = {
  saison: { id: 's', nom: '2026', debut: '2026-01-05', fin: '2026-02-01' },
  semaines,
  semaineCourante: 0,
  lignes: [
    { sorte: 'zone', id: 'z1', nom: 'Tunnel 1' },
    { sorte: 'emplacement', id: 'p1', code: 'P1', zoneId: 'z1', chapelleId: null, longueurM: 30, largeurM: 0.8, barres: [barre('o1', 'Tomate', 'solanacees', 0, 14), barre('o2', 'Laitue', 'salades', 14, 28)], conflits: [] },
    { sorte: 'emplacement', id: 'p2', code: 'P2', zoneId: 'z1', chapelleId: null, longueurM: 20, largeurM: null, barres: [barre('o3', 'Radis', 'racines', 7, 10), barre('o4', 'Chou', 'cruciferes', 8, 14), barre('o5', 'Courge', null, 21, 28)], conflits: [] },
    { sorte: 'zone', id: 'z2', nom: 'Serre', contour: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 8 }, { x: 0, y: 8 }] },
    { sorte: 'emplacement', id: 'c1', code: 'C1', zoneId: 'z2', chapelleId: null, longueurM: 12, largeurM: 1, placement: { x: 0, y: 0, orientationDeg: 0 }, barres: [barre('o6', 'Tomate Roma', 'solanacees', 3, 6)], conflits: [] },
    { sorte: 'emplacement', id: 'c2', code: 'C2', zoneId: 'z2', chapelleId: null, longueurM: 12, largeurM: 1, barres: [], conflits: [] },
  ],
};

describe('T59 : la scène d’une semaine sans refaire la géométrie', () => {
  it('plan écrit à la main : identique à versScene pour chaque semaine, depuis n’importe quelle semaine de base', () => {
    for (let b = 0; b < semaines.length; b += 1) {
      const base = versScene(PLAN, b);
      for (let i = 0; i < semaines.length; i += 1) expect(sceneDeLaSemaine(base, PLAN, i), `base ${String(b)}, semaine ${String(i)}`).toEqual(versScene(PLAN, i));
    }
  });

  it('petite ferme (construirePlan) : identique à versScene pour chaque semaine de la saison', () => {
    const plan = construirePlan(PETITE_FERME, { saison: SAISON_2026, aujourdhui: '2026-06-10' });
    const base = versScene(plan, 0);
    for (let i = 0; i < plan.semaines.length; i += 1) expect(sceneDeLaSemaine(base, plan, i)).toEqual(versScene(plan, i));
  });

  it('socles et bâtiments partagés avec la scène de base (aucun recalcul)', () => {
    const base = versScene(PLAN, 0);
    const s = sceneDeLaSemaine(base, PLAN, 2);
    expect(s.socles).toBe(base.socles);
    expect(s.batiments).toBe(base.batiments);
  });

  it('semaine hors du plan : la même erreur que versScene', () => {
    const base = versScene(PLAN, 0);
    expect(() => sceneDeLaSemaine(base, PLAN, 4)).toThrow(RangeError);
    expect(() => sceneDeLaSemaine(base, PLAN, -1)).toThrow(RangeError);
    expect(() => sceneDeLaSemaine(base, PLAN, 1.5)).toThrow(RangeError);
  });
});

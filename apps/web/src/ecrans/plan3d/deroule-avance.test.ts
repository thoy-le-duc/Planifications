/**
 * T59 — les plants de la semaine suivante, calculés d'avance pendant la lecture : repris tels quels
 * s'ils concordent, jamais calculés deux fois, oubliés une fois repris.
 */
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut } from '@planif/core/croissance';
import { describe, expect, it } from 'vitest';
import type { BarrePlan, Plan, SemainePlan } from '../plan/calculs.ts';
import { AvancePlants, occupationsParPlanche, plantsDeLaSemaine, type EntreePlantsSemaine, type ModeDates } from './deroule-plants.ts';
import type { CulturesLues } from './donnees-plants.ts';
import { sceneDeLaSemaine, versScene } from './scene.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const LUNDIS = ['2027-03-01', '2027-03-08', '2027-03-15', '2027-03-22'];
const semaines: SemainePlan[] = LUNDIS.map((lundi, i) => ({ annee: 2027, semaine: 9 + i, libelle: `S${String(9 + i).padStart(2, '0')}`, lundi }));
const barre = (occupationId: string, debutJour: number, finJour: number): BarrePlan => ({ occupationId, serieId: occupationId, plantationId: null, libelle: 'Laitue', famille: null, cleFamille: null, etat: 'reel', du: '2027-03-01', au: null, debutJour, finJour, enConflit: false });
const PLAN: Plan = {
  saison: { id: 's', nom: '2027', debut: '2027-03-01', fin: '2027-03-28' },
  semaines,
  semaineCourante: 0,
  lignes: [
    { sorte: 'zone', id: 'z', nom: 'Tunnel' },
    { sorte: 'emplacement', id: 'p1', code: 'P1', zoneId: 'z', chapelleId: null, longueurM: 10, largeurM: 0.8, barres: [barre('o1', 0, 28)], conflits: [] },
  ],
};
const CULTURES: CulturesLues = {
  parOccupation: new Map([
    [
      'o1',
      {
        espece: 'Laitue',
        profil: profilParDefaut('Laitue').profil,
        ecartementM: 0.3,
        annuelle: { miseEnPlace: { prevue: d('2027-03-01'), reelle: null }, debutRecolte: { prevue: d('2027-03-20'), reelle: null }, finRecolte: { prevue: d('2027-03-27'), reelle: null }, arrachage: { prevue: d('2027-03-28'), reelle: null } },
        perenne: null,
      },
    ],
  ]),
  horsSol: new Set(),
};

const GEOMETRIE = versScene(PLAN, 0);
const OCCUPATIONS = occupationsParPlanche(PLAN);
const entree = (semaine: number, mode: ModeDates = 'realise'): EntreePlantsSemaine => ({ scene: sceneDeLaSemaine(GEOMETRIE, PLAN, semaine), occupations: OCCUPATIONS, cultures: CULTURES, jour: d(LUNDIS[semaine] ?? ''), mode });

describe('T59 : plants de la semaine suivante calculés d’avance', () => {
  it('préparés puis repris : les mêmes plants qu’un calcul direct, calculés une seule fois', () => {
    const a = new AvancePlants();
    a.preparer(entree(2));
    a.preparer(entree(2));
    expect(a.calculs, 'préparer deux fois la même semaine ne recalcule pas').toBe(1);
    const pris = a.prendre(entree(2));
    expect(pris).not.toBeNull();
    expect(pris).toEqual(plantsDeLaSemaine(entree(2)));
    expect(a.calculs).toBe(1);
  });

  it('repris une fois, ils sont oubliés', () => {
    const a = new AvancePlants();
    a.preparer(entree(1));
    expect(a.prendre(entree(1))).not.toBeNull();
    expect(a.prendre(entree(1))).toBeNull();
  });

  it('autre semaine, autre option de dates, autres occupations ou autre géométrie : rien à reprendre', () => {
    const a = new AvancePlants();
    a.preparer(entree(1));
    expect(a.prendre(entree(2))).toBeNull();
    expect(a.prendre(entree(1, 'prevu'))).toBeNull();
    expect(a.prendre({ ...entree(1), occupations: occupationsParPlanche(PLAN) })).toBeNull();
    expect(a.prendre({ ...entree(1), scene: sceneDeLaSemaine(versScene(PLAN, 0), PLAN, 1) })).toBeNull();
    expect(a.prendre(entree(1)), 'la préparation reste disponible').not.toBeNull();
  });

  it('rien de préparé : nul', () => {
    expect(new AvancePlants().prendre(entree(0))).toBeNull();
  });
});

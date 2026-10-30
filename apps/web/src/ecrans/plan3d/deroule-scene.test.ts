/**
 * T59 (relecture) — « Prévu seul » : les planches (couleur, culture, occupation) et la liste texte
 * suivent la même source que les plants ; l'avance se consulte sans effet de bord et compte tous les
 * calculs de plants.
 */
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut, type DatesCroissance } from '@planif/core/croissance';
import { describe, expect, it } from 'vitest';
import { FAMILLES } from '../../ui/jetons.ts';
import type { BarrePlan, Plan, SemainePlan } from '../plan/calculs.ts';
import { AvancePlants, occupationsParPlanche, plantsDeLaSemaine, sceneSelonMode, type ModeDates } from './deroule-plants.ts';
import type { CultureLue, CulturesLues } from './donnees-plants.ts';
import { COULEUR_NEUTRE, sceneDeLaSemaine, versScene } from './scene.ts';
import { avecZonesPlacees } from './test/zones-placees.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const LUNDIS = ['2027-03-01', '2027-03-08', '2027-03-15', '2027-03-22', '2027-03-29', '2027-04-05'];
const semaines: SemainePlan[] = LUNDIS.map((lundi, i) => ({ annee: 2027, semaine: 9 + i, libelle: `S${String(9 + i).padStart(2, '0')}`, lundi }));
const barre = (occupationId: string, libelle: string, cleFamille: BarrePlan['cleFamille'], debutJour: number, finJour: number): BarrePlan => ({ occupationId, serieId: occupationId, plantationId: null, libelle, famille: null, cleFamille, etat: 'reel', du: '2027-03-01', au: null, debutJour, finJour, enConflit: false });

/**
 * p1 : laitue mise en place en vrai le 1er mars, prévue le 15 mars (semaine 2) ; arrachée comme prévu le 29 mars.
 * Puis tomate, prévue le 29 mars (semaine 4), mise en place en vrai le 5 avril (semaine 5).
 * Les barres du plan suivent le réel.
 */
const PLAN: Plan = {
  saison: { id: 's', nom: '2027', debut: '2027-03-01', fin: '2027-04-11' },
  semaines,
  semaineCourante: 0,
  lignes: [
    { sorte: 'zone', id: 'z', nom: 'Tunnel' },
    { sorte: 'emplacement', id: 'p1', code: 'P1', zoneId: 'z', chapelleId: null, longueurM: 10, largeurM: 0.8, barres: [barre('o1', 'Laitue', 'salades', 0, 28), barre('o2', 'Tomate', 'solanacees', 35, 42)], conflits: [] },
  ],
};
const dates = (mise: [string, string | null], arrachage: string): DatesCroissance => ({
  miseEnPlace: { prevue: d(mise[0]), reelle: mise[1] === null ? null : d(mise[1]) },
  debutRecolte: { prevue: null, reelle: null },
  finRecolte: { prevue: null, reelle: null },
  arrachage: { prevue: d(arrachage), reelle: null },
});
const annuelle = (espece: string, dc: DatesCroissance): CultureLue => ({ espece, profil: profilParDefaut(espece).profil, ecartementM: 0.3, annuelle: dc, perenne: null });
const CULTURES: CulturesLues = {
  parOccupation: new Map<string, CultureLue>([
    ['o1', annuelle('Laitue', dates(['2027-03-15', '2027-03-01'], '2027-03-29'))],
    ['o2', annuelle('Tomate', dates(['2027-03-29', '2027-04-05'], '2027-09-15'))],
  ]),
  horsSol: new Set(),
};
// T91 : la scène ne contient que ce qui est placé : la zone du plan écrit à la main reçoit un contour.
const PLAN_PLACE = avecZonesPlacees(PLAN);
const GEOMETRIE = versScene(PLAN_PLACE, 0);
const OCCUPATIONS = occupationsParPlanche(PLAN_PLACE);
const sceneDe = (semaine: number, mode: ModeDates) => sceneSelonMode(sceneDeLaSemaine(GEOMETRIE, PLAN, semaine), PLAN, OCCUPATIONS, CULTURES, d(LUNDIS[semaine] ?? ''), mode);
const entree = (semaine: number, mode: ModeDates) => ({ scene: sceneDe(semaine, mode), occupations: OCCUPATIONS, cultures: CULTURES, jour: d(LUNDIS[semaine] ?? ''), mode });

describe('T59 (relecture) : « Prévu seul » colore les planches comme les plants', () => {
  it('réalisé : la scène telle quelle', () => {
    const brute = sceneDeLaSemaine(GEOMETRIE, PLAN, 0);
    expect(sceneSelonMode(brute, PLAN, OCCUPATIONS, CULTURES, d(LUNDIS[0] ?? ''), 'realise')).toBe(brute);
  });

  it('prévu seul : planche nue (couleur neutre, sans culture) avant la mise en place prévue, alors que le réel la montre cultivée', () => {
    const realise = sceneDe(0, 'realise').volumes[0];
    expect(realise?.culture).toBe('Laitue');
    const prevu = sceneDe(0, 'prevu').volumes[0];
    expect(prevu).toMatchObject({ couleur: COULEUR_NEUTRE, cleFamille: null, culture: null, occupationId: null });
    expect(plantsDeLaSemaine(entree(0, 'prevu'))[0], 'pas de plants non plus').toBeNull();
  });

  it('prévu seul : planche colorée selon la culture prévue (tomate la semaine 4, nue en réalisé)', () => {
    expect(sceneDe(4, 'realise').volumes[0]).toMatchObject({ culture: null, occupationId: null, couleur: COULEUR_NEUTRE });
    const prevu = sceneDe(4, 'prevu').volumes[0];
    expect(prevu).toMatchObject({ culture: 'Tomate', cleFamille: 'solanacees', occupationId: 'o2', couleur: FAMILLES.solanacees.bande });
    expect(plantsDeLaSemaine(entree(4, 'prevu'))[0]?.stade, 'les plants disent la même chose : jeunes plants').toBe('levee');
  });

  it('chaque semaine, en prévu : une planche a des plants seulement si elle porte une culture, et la même géométrie', () => {
    for (let i = 0; i < semaines.length; i += 1) {
      const s = sceneDe(i, 'prevu');
      const v = s.volumes[0];
      const p = plantsDeLaSemaine(entree(i, 'prevu'))[0] ?? null;
      if (p !== null) expect(v?.occupationId, `semaine ${String(i)}`).not.toBeNull();
      expect(s.socles).toBe(GEOMETRIE.socles);
      expect({ ...v, couleur: 0, cleFamille: 0, culture: 0, occupationId: 0 }).toEqual({ ...GEOMETRIE.volumes[0], couleur: 0, cleFamille: 0, culture: 0, occupationId: 0 });
    }
  });
});

describe('T59 (relecture) : l’avance se consulte sans effet de bord et compte tous les calculs', () => {
  it('consulter deux fois (StrictMode) rend le même tableau, sans recalcul', () => {
    const a = new AvancePlants();
    a.preparer(entree(2, 'realise'));
    const x = a.consulter(entree(2, 'realise'));
    expect(x).not.toBeNull();
    expect(a.consulter(entree(2, 'realise'))).toBe(x);
    expect(a.plantsPour(entree(2, 'realise'))).toBe(x);
    expect(a.total).toBe(1);
  });

  it('plantsPour sans préparation : calcul sur place, compté ; deux appels = deux calculs', () => {
    const a = new AvancePlants();
    expect(a.plantsPour(entree(1, 'realise'))).toEqual(plantsDeLaSemaine(entree(1, 'realise')));
    expect(a.total).toBe(1);
    a.plantsPour(entree(1, 'realise'));
    expect(a.total, 'un double calcul se voit').toBe(2);
    a.preparer(entree(3, 'realise'));
    expect(a.total).toBe(3);
  });
});

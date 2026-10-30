/**
 * Tests d'acceptation T59 — successions et option « Prévu / Réalisé » pendant le déroulé de la
 * saison : arrachage (les plants disparaissent), planche nue, puis la culture suivante en jeunes
 * plants ; « Prévu seul » montre le plan sans les écarts. Contrat : ./test/contrat-deroule.ts.
 * Chaîne réelle : `versScene` (scène de la semaine) puis le moteur de croissance de T32a.
 */
import type { DateCalendaire } from '@planif/core';
import { profilParDefaut, type DatesCroissance } from '@planif/core/croissance';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BarrePlan, Plan, SemainePlan } from '../plan/calculs.ts';
import type { CultureLue, CulturesLues } from './donnees-plants.ts';
import type { PlantsPlanche } from './plants.ts';
import { versScene } from './scene.ts';
import { avecZonesPlacees } from './test/zones-placees.ts';
import type { ModeDates, ModuleDeroulePlants } from './test/contrat-deroule.ts';

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN = './deroule-plants.ts';
let m: ModuleDeroulePlants;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleDeroulePlants;
});

const d = (s: string): DateCalendaire => s as DateCalendaire;

/** Douze semaines à partir du lundi 1er mars 2027. */
const LUNDIS = ['03-01', '03-08', '03-15', '03-22', '03-29', '04-05', '04-12', '04-19', '04-26', '05-03', '05-10', '05-17'].map((j) => `2027-${j}`);
const semaines: SemainePlan[] = LUNDIS.map((lundi, i) => ({ annee: 2027, semaine: 9 + i, libelle: `S${String(9 + i).padStart(2, '0')}`, lundi }));
const JOURS_TOTAL = 7 * semaines.length;

function barre(occupationId: string, libelle: string, debutJour: number, finJour: number): BarrePlan {
  return { occupationId, serieId: occupationId, plantationId: null, libelle, famille: null, cleFamille: null, etat: 'reel', du: '2027-03-01', au: null, debutJour, finJour, enConflit: false };
}

const planche = (id: string, barres: BarrePlan[]) => ({ sorte: 'emplacement' as const, id, code: id.toUpperCase(), zoneId: 'z', chapelleId: null, longueurM: 10, largeurM: 0.8, barres, conflits: [] });

/**
 * p1 (succession, sans écart) : laitue du 1er au 25 mars (arrachée le jeudi de la semaine 3), planche
 * nue la semaine 4, tomate mise en place le lundi 5 avril (semaine 5).
 * p2 (écarts) : laitue prévue jusqu'au 25 mars, arrachée en vrai le 10 mars ; laitue suivante prévue
 * le 29 mars (semaine 4), mise en place en vrai le 12 avril (semaine 6). Les barres du plan suivent le réel.
 * p3 : un kiwi (pérenne) toute la saison.
 */
const PLAN: Plan = {
  saison: { id: 's', nom: '2027', debut: '2027-03-01', fin: '2027-05-23' },
  semaines,
  semaineCourante: 0,
  lignes: [
    { sorte: 'zone', id: 'z', nom: 'Tunnel' },
    planche('p1', [barre('o1', 'Laitue', 0, 24), barre('o2', 'Tomate', 35, JOURS_TOTAL)]),
    planche('p2', [barre('o3', 'Laitue', 0, 9), barre('o4', 'Laitue', 42, 70)]),
    planche('p3', [{ ...barre('o5', 'Kiwi', 0, JOURS_TOTAL), serieId: null, plantationId: 'pl5' }]),
  ],
};

const dates = (mise: [string, string | null], debut: string, fin: string, arrachage: [string, string | null]): DatesCroissance => ({
  miseEnPlace: { prevue: d(mise[0]), reelle: mise[1] === null ? null : d(mise[1]) },
  debutRecolte: { prevue: d(debut), reelle: null },
  finRecolte: { prevue: d(fin), reelle: null },
  arrachage: { prevue: d(arrachage[0]), reelle: arrachage[1] === null ? null : d(arrachage[1]) },
});

const annuelle = (espece: string, dc: DatesCroissance): CultureLue => ({ espece, profil: profilParDefaut(espece).profil, ecartementM: 0.3, annuelle: dc, perenne: null });

const CULTURES: CulturesLues = {
  parOccupation: new Map<string, CultureLue>([
    ['o1', annuelle('Laitue', dates(['2027-03-01', null], '2027-03-15', '2027-03-22', ['2027-03-25', null]))],
    ['o2', annuelle('Tomate', dates(['2027-04-05', null], '2027-06-01', '2027-08-31', ['2027-09-15', null]))],
    ['o3', annuelle('Laitue', dates(['2027-03-01', '2027-03-01'], '2027-03-15', '2027-03-22', ['2027-03-25', '2027-03-10']))],
    ['o4', annuelle('Laitue', dates(['2027-03-29', '2027-04-12'], '2027-04-26', '2027-05-03', ['2027-05-10', null]))],
    ['o5', { espece: 'Kiwi', profil: profilParDefaut('Kiwi').profil, ecartementM: 0.3, annuelle: null, perenne: { datePlantation: d('2020-03-01'), dateArrachage: null, campagnes: new Map() } }],
  ]),
  horsSol: new Set<string>(),
};

function plantsDe(semaine: number, mode: ModeDates): readonly (PlantsPlanche | null)[] {
  // T91 : la scène ne contient que ce qui est placé : la zone du plan écrit à la main reçoit un contour.
  const scene = versScene(avecZonesPlacees(PLAN), semaine);
  return m.plantsDeLaSemaine({ scene, occupations: m.occupationsParPlanche(PLAN), cultures: CULTURES, jour: d(LUNDIS[semaine] ?? ''), mode });
}

/** Les plants d'une planche (indice de volume : p1 = 0, p2 = 1, p3 = 2), semaine après semaine. */
const planchePar = (indice: number, mode: ModeDates) => semaines.map((_, i) => plantsDe(i, mode)[indice] ?? null);

const ROSETTE = profilParDefaut('Laitue').profil.forme;
const TUTEUREE = profilParDefaut('Tomate').profil.forme;

describe('T59 : occupations de chaque planche', () => {
  it('dans l’ordre du plan', () => {
    const o = m.occupationsParPlanche(PLAN);
    expect(o.get('p1')).toEqual(['o1', 'o2']);
    expect(o.get('p2')).toEqual(['o3', 'o4']);
    expect(o.get('p3')).toEqual(['o5']);
  });

  it('option par défaut : les dates réelles remplacent les prévues', () => {
    expect(m.MODE_DATES_PAR_DEFAUT).toBe('realise');
  });
});

describe('T59 : une planche avec deux séries successives montre l’arrachage, puis la nouvelle culture', () => {
  it('banc : deux formes différentes (laitue en rosette, tomate tuteurée)', () => {
    expect(ROSETTE).not.toBe(TUTEUREE);
  });

  it('laitue semaines 0 à 3, planche nue semaine 4, tomate en jeunes plants semaine 5, qui grandit ensuite', () => {
    const p1 = planchePar(0, 'realise');
    expect(p1.map((p) => p?.forme ?? 'nue')).toEqual([ROSETTE, ROSETTE, ROSETTE, ROSETTE, 'nue', ...Array<string>(7).fill(TUTEUREE)]);
    expect(p1.every((p) => p === null || p.nombre > 0), 'une planche cultivée a des plants').toBe(true);
    // Arrachage : la semaine 3 montre encore la laitue (arrachée le jeudi), la semaine 4 plus rien.
    expect(p1[3]?.stade).toBe('fin');
    expect(p1[4], 'planche nue après l’arrachage').toBeNull();
    // Mise en place : de jeunes plants.
    expect(p1[5]?.stade).toBe('levee');
    const h5 = p1[5]?.hauteurM ?? Number.NaN;
    const h8 = p1[8]?.hauteurM ?? Number.NaN;
    expect(h5).toBeLessThan(0.3);
    expect(h8).toBeGreaterThan(h5);
  });
});

describe('T59 : option « Prévu / Réalisé »', () => {
  it('réalisé : laitue arrachée le 10 mars, nue jusqu’à la mise en place réelle du 12 avril', () => {
    const p2 = planchePar(1, 'realise');
    expect(p2[1], 'semaine du 8 mars : avant l’arrachage réel').not.toBeNull();
    expect(p2[2], 'semaine du 15 mars : arrachée en vrai').toBeNull();
    expect(p2[4], 'semaine du 29 mars : la suivante n’est pas encore en place en vrai').toBeNull();
    expect(p2[5]).toBeNull();
    expect(p2[6]?.stade, 'semaine du 12 avril : jeunes plants').toBe('levee');
  });

  it('prévu seul : le plan sans les écarts (laitue jusqu’au 25 mars, suivante dès le 29 mars)', () => {
    const p2 = planchePar(1, 'prevu');
    expect(p2[2], 'semaine du 15 mars : encore en place selon le plan').not.toBeNull();
    expect(p2[3]?.stade, 'semaine du 22 mars : fin de récolte prévue').toBe('fin');
    expect(p2[4]?.stade, 'semaine du 29 mars : mise en place prévue').toBe('levee');
    expect(p2[4]?.forme).toBe(ROSETTE);
  });

  it('prévu seul : la croissance part de la mise en place prévue, pas de la réelle', () => {
    const realise = planchePar(1, 'realise')[6]?.hauteurM ?? Number.NaN;
    const prevu = planchePar(1, 'prevu')[6]?.hauteurM ?? Number.NaN;
    expect(prevu).toBeGreaterThan(realise);
  });

  it('sans écart, les deux options montrent la même chose', () => {
    expect(planchePar(0, 'prevu')).toEqual(planchePar(0, 'realise'));
  });

  it('une pérenne garde sa plantation dans les deux options', () => {
    expect(planchePar(2, 'prevu')).toEqual(planchePar(2, 'realise'));
  });
});

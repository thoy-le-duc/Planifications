/**
 * T11e — puces de zone, surtitre, carte d'alerte et places des lignes (zones.ts).
 */
import { describe, expect, it } from 'vitest';
import type { BarrePlan, LigneEmplacementPlan, LignePlan } from './calculs.ts';
import { alerteRetard, attribuerPlaces, surtitreZone, zonesDuPlan } from './zones.ts';

function barre(occupationId: string, etat: 'reel' | 'prevu', du: string): BarrePlan {
  return { occupationId, serieId: null, plantationId: null, libelle: `Culture ${occupationId}`, famille: null, cleFamille: null, etat, du, au: null, debutJour: 0, finJour: 7, enConflit: false };
}

function planche(id: string, zoneId: string, longueurM: number, barres: BarrePlan[] = [], chapelleId: string | null = null): LigneEmplacementPlan {
  return { sorte: 'emplacement', id, code: id.toUpperCase(), zoneId, chapelleId, longueurM, largeurM: null, barres, conflits: [] };
}

const LIGNES: readonly LignePlan[] = [
  { sorte: 'zone', id: 'z1', nom: 'Tunnel 1' },
  planche('t1-p1', 'z1', 30),
  planche('t1-p2', 'z1', 30),
  { sorte: 'chapelle', id: 'c1', nom: 'Chapelle A' },
  planche('t1-p3', 'z1', 30, [], 'c1'),
  { sorte: 'zone', id: 'z2', nom: 'Plein champ' },
  planche('pc-p1', 'z2', 25),
  planche('pc-p2', 'z2', 30.25),
  { sorte: 'zone', id: 'z3', nom: 'Verger' },
];

describe('zonesDuPlan', () => {
  it('une zone par zone racine, dans l’ordre du plan, avec ses planches (sous-zones comprises) et ses longueurs', () => {
    const { zones } = zonesDuPlan(LIGNES);
    expect(zones.map((z) => [z.id, z.nom, z.ligne, z.planches, z.longueurMin, z.longueurMax])).toEqual([
      ['z1', 'Tunnel 1', 0, 3, 30, 30],
      ['z2', 'Plein champ', 5, 2, 25, 30.25],
      ['z3', 'Verger', 8, 0, null, null],
    ]);
  });

  it('chaque ligne connaît sa zone racine ; -1 avant la première zone', () => {
    expect([...zonesDuPlan(LIGNES).zoneDeLigne]).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 2]);
    expect([...zonesDuPlan([planche('x', 'inconnue', 10), ...LIGNES]).zoneDeLigne][0]).toBe(-1);
  });
});

describe('surtitreZone', () => {
  const [tunnel, champ, verger] = zonesDuPlan(LIGNES).zones;
  it('longueur commune des planches', () => {
    expect(tunnel && surtitreZone(tunnel)).toBe('Tunnel 1 · 3 planches · 30 m');
  });
  it('longueurs différentes : l’intervalle, au plus une décimale, à la française', () => {
    expect(champ && surtitreZone(champ)).toBe('Plein champ · 2 planches · 25–30,3 m');
  });
  it('sans planche : ni longueur ; une seule : au singulier', () => {
    expect(verger && surtitreZone(verger)).toBe('Verger · 0 planche');
    expect(surtitreZone({ id: 'z', nom: 'Serre', ligne: 0, planches: 1, longueurMin: 12.5, longueurMax: 12.5 })).toBe('Serre · 1 planche · 12,5 m');
  });
  it('deux longueurs qui s’écrivent pareil : une seule', () => {
    expect(surtitreZone({ id: 'z', nom: 'Serre', ligne: 0, planches: 2, longueurMin: 30, longueurMax: 30.01 })).toBe('Serre · 2 planches · 30 m');
  });
});

describe('alerteRetard', () => {
  const lignes: readonly LignePlan[] = [
    { sorte: 'zone', id: 'z1', nom: 'Tunnel 1' },
    planche('a', 'z1', 30, [barre('o1', 'prevu', '2026-04-20'), barre('o2', 'reel', '2026-01-02')]),
    planche('b', 'z1', 30, [barre('o3', 'prevu', '2026-04-12'), barre('o4', 'prevu', '2026-05-01')]),
    planche('c', 'z1', 30, [barre('o5', 'prevu', '2026-04-12')]),
  ];

  it('la culture prévue la plus en retard d’abord ; à date égale, la première du plan ; et combien d’autres', () => {
    const a = alerteRetard(lignes, '2026-04-25');
    expect(a?.barre.occupationId).toBe('o3');
    expect(a?.ligne.id).toBe('b');
    expect(a?.autres).toBe(2);
  });

  it('ni un réel, ni une culture prévue aujourd’hui ou plus tard', () => {
    expect(alerteRetard(lignes, '2026-04-12')).toBeNull();
    expect(alerteRetard(lignes, '2026-04-13')?.autres).toBe(1);
  });
});

describe('attribuerPlaces', () => {
  it('première fenêtre : places 0 à n-1', () => {
    expect([...attribuerPlaces(new Map(), 3, 7)]).toEqual([
      [3, 0],
      [4, 1],
      [5, 2],
      [6, 3],
    ]);
  });

  it('au défilement, la ligne qui entre reprend la place de celle qui sort ; les autres gardent la leur', () => {
    const avant = attribuerPlaces(new Map(), 0, 4);
    const apres = attribuerPlaces(avant, 1, 5);
    expect(apres.get(1)).toBe(1);
    expect(apres.get(4)).toBe(0);
    expect(new Set(apres.values()).size).toBe(4);
  });

  it('fenêtre plus grande : places nouvelles, jamais en double ; saut lointain : toutes reprises', () => {
    const avant = attribuerPlaces(new Map(), 0, 3);
    const plus = attribuerPlaces(avant, 0, 6);
    expect([...plus.values()].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const loin = attribuerPlaces(plus, 100, 104);
    expect([...loin.values()].sort()).toEqual([0, 1, 2, 3]);
  });

  it('la ligne gardée (focus) sortie de la fenêtre garde sa place, que personne ne reprend', () => {
    const avant = attribuerPlaces(new Map(), 0, 4);
    const garde = avant.get(0);
    const apres = attribuerPlaces(avant, 1, 5, 0);
    expect(apres.get(0)).toBe(garde);
    expect(apres.get(4)).not.toBe(garde);
    expect(new Set(apres.values()).size).toBe(5);
    expect(attribuerPlaces(apres, 1, 5, 2).has(0), 'gardée dans la fenêtre : rien de plus').toBe(false);
  });
});

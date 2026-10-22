/**
 * Tests d'acceptation T58 — règle 3, côté pur (plan3d/abris.ts) : de l'état des équipements aux
 * bâtiments de la scène (ouvrants relevés, porte ouverte, chauffage, voile) et au filtre « Serres »
 * qui montre tout ce qui est ouvert en couleur vive. Contrat : ./test/contrat-abris.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { appliquerFiltres, COULEUR_ESTOMPEE, FILTRES_TOUT, type BatimentScene, type Scene, type VolumeScene } from './scene.ts';
import { CHEMIN_ABRIS, type EquipementAbri, type EvenementEtatAbri, type ModuleAbris, type ZoneAbri } from './test/contrat-abris.ts';

let m: ModuleAbris;
beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_ABRIS)) as ModuleAbris;
});

const S1 = 'zone-serre-1';
const S2 = 'zone-serre-2';
const T3 = 'zone-tunnel-3';
const PC = 'zone-plein-champ';
const ZONES: readonly ZoneAbri[] = [
  { id: S1, nom: 'Serre 1', typeAbri: 'serre', equipementsAbri: null },
  { id: S2, nom: 'Serre 2', typeAbri: 'serre', equipementsAbri: ['portes', 'chauffage'] },
  { id: T3, nom: 'Tunnel 3', typeAbri: 'tunnel', equipementsAbri: null },
  { id: PC, nom: 'Plein champ', typeAbri: 'plein_champ', equipementsAbri: null },
];

const batiment = (id: string, nom: string, zoneId: string | null, type: BatimentScene['type'], x: number): BatimentScene => ({
  id,
  nom,
  type,
  zoneId,
  x,
  z: 0,
  largeur: 8,
  profondeur: 40,
  hauteur: 3.5,
  angle: 0,
  forme: type === 'hangar' ? 'volume' : 'tunnel',
  arceaux: [],
  nefs: 1,
  opacite: type === 'hangar' ? 1 : 0.4,
  couleur: '#cccccc',
});
const B1 = batiment('b1', 'Serre 1', S1, 'serre_chapelle', 0);
const B2 = batiment('b2', 'Serre 2', S2, 'serre_chapelle', 20);
const B3 = batiment('b3', 'Tunnel 3', T3, 'serre_tunnel', 40);
const HANGAR = batiment('b4', 'Hangar', null, 'hangar', 60);
const B_CHAMP = batiment('b5', 'Abri de jardin', PC, 'autre', 80);
const B_VOISIN = batiment('b6', 'Serre du voisin', 'zone-d-une-autre-ferme', 'serre_chapelle', 100);
const BATIMENTS = [B1, B2, B3, HANGAR, B_CHAMP, B_VOISIN];

let n = 0;
function ev(zoneId: string, equipement: EquipementAbri, actif: boolean, heureUtc: string, autres: Partial<EvenementEtatAbri> = {}): EvenementEtatAbri {
  n += 1;
  return { id: `e${String(1000 + n)}`, zoneId, equipement, actif, horodatage: `2026-10-22T${heureUtc}:00.000Z`, remplaceSorte: null, remplaceEvenementId: null, ...autres };
}

const EVENEMENTS: readonly EvenementEtatAbri[] = [
  ev(S1, 'ouvrants_lateraux', true, '07:00'),
  ev(S1, 'ouvrants_faitage', true, '07:00'),
  ev(S1, 'chauffage', true, '05:00'),
  ev(S2, 'portes', true, '07:30'),
  ev(S2, 'portes', false, '09:00'),
  ev(T3, 'voile', true, '06:00'),
];
const MIDI = '2026-10-22T10:00:00.000Z';

describe('T58 : état des bâtiments d’après les équipements', () => {
  it('un état par abri (serres et tunnel) ; ni hangar, ni abri de jardin en plein champ, ni bâtiment d’une zone inconnue', () => {
    const etats = m.etatsBatiments(BATIMENTS, ZONES, EVENEMENTS, MIDI);
    expect([...etats.keys()].sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('Serre 1 : ouvrants latéraux et de faîtage ouverts, chauffage allumé ; les portes restent fermées', () => {
    const e = m.etatsBatiments(BATIMENTS, ZONES, EVENEMENTS, MIDI).get('b1');
    expect(e).toEqual({
      zoneId: S1,
      nom: 'Serre 1',
      ouvert: true,
      ouverts: ['ouvrants_lateraux', 'ouvrants_faitage'],
      ouvertures: { lateraux: true, faitage: true, portes: false, chauffage: true, voile: false },
    });
  });

  it('Serre 2 : portes ouvertes puis refermées à 9 h → fermée ; à 8 h elle était ouverte', () => {
    expect(m.etatsBatiments(BATIMENTS, ZONES, EVENEMENTS, MIDI).get('b2')).toMatchObject({ ouvert: false, ouverts: [], ouvertures: { portes: false } });
    expect(m.etatsBatiments(BATIMENTS, ZONES, EVENEMENTS, '2026-10-22T08:00:00.000Z').get('b2')).toMatchObject({ ouvert: true, ouverts: ['portes'], ouvertures: { portes: true } });
  });

  it('le voile du tunnel est posé mais n’ouvre rien : fermé, voile vrai', () => {
    expect(m.etatsBatiments(BATIMENTS, ZONES, EVENEMENTS, MIDI).get('b3')).toMatchObject({ ouvert: false, ouverts: [], ouvertures: { voile: true, lateraux: false, portes: false } });
  });

  it('avant le premier événement : tout est fermé (état inconnu)', () => {
    const etats = m.etatsBatiments(BATIMENTS, ZONES, EVENEMENTS, '2026-10-22T04:00:00.000Z');
    expect([...etats.values()].every((e) => !e.ouvert)).toBe(true);
  });

  it('un équipement non déclaré ne dessine rien : portes ouvertes dans une zone dont la liste n’a que le chauffage', () => {
    const zones: readonly ZoneAbri[] = [{ id: S1, nom: 'Serre 1', typeAbri: 'serre', equipementsAbri: ['chauffage'] }];
    const e = m.etatsBatiments([B1], zones, [ev(S1, 'portes', true, '07:00')], MIDI).get('b1');
    expect(e).toMatchObject({ ouvert: false, ouvertures: { portes: false } });
  });

  it('annulation : l’ouverture annulée ne se dessine plus', () => {
    const ouvert = ev(S1, 'portes', true, '07:00');
    const annule = ev(S1, 'portes', true, '07:01', { remplaceSorte: 'annulation', remplaceEvenementId: ouvert.id });
    expect(m.etatsBatiments([B1], ZONES, [ouvert, annule], MIDI).get('b1')).toMatchObject({ ouvert: false, ouvertures: { portes: false } });
  });
});

const vol = (id: string, zoneId: string, x: number): VolumeScene => ({ id, code: id.toUpperCase(), zoneId, x, z: 0, longueur: 30, largeur: 0.8, hauteur: 0.3, angle: 0, placee: true, couleur: '#336633', cleFamille: null, culture: 'Fraise', occupationId: null });
const SCENE: Scene = { semaine: 0, libelleSemaine: 'S43', socles: [], batiments: BATIMENTS, volumes: [vol('p1', S1, 0), vol('p2', S2, 20), vol('p3', T3, 40), vol('p4', PC, 80)] };

describe('T58 : ouvrants dessinés dans la scène', () => {
  it('chaque abri gagne ses ouvertures ; le hangar et les autres bâtiments ne changent pas', () => {
    const etats = m.etatsBatiments(BATIMENTS, ZONES, EVENEMENTS, MIDI);
    const scene = m.poserOuvertures(SCENE, etats);
    const parId = new Map(scene.batiments.map((b) => [b.id, b as BatimentScene & { ouvertures?: unknown }]));
    expect(parId.get('b1')?.ouvertures).toEqual({ lateraux: true, faitage: true, portes: false, chauffage: true, voile: false });
    expect(parId.get('b2')?.ouvertures).toEqual({ lateraux: false, faitage: false, portes: false, chauffage: false, voile: false });
    expect(parId.get('b4')).toEqual(HANGAR);
    expect(parId.get('b5')).toEqual(B_CHAMP);
    expect(scene.volumes).toBe(SCENE.volumes);
    expect(scene.batiments.map((b) => b.id)).toEqual(BATIMENTS.map((b) => b.id));
  });

  it('sans abri : la scène elle-même', () => {
    expect(m.poserOuvertures(SCENE, new Map())).toBe(SCENE);
  });
});

describe('T58 : filtre « Serres »', () => {
  const filtree = appliquerFiltres(SCENE, FILTRES_TOUT);
  const etats = () => m.etatsBatiments(BATIMENTS, ZONES, EVENEMENTS, MIDI);

  it('deux couleurs distinctes, au format #rrggbb ; la vive est celle des abris ouverts', () => {
    expect(m.COULEURS_SERRES.ouverte).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.COULEURS_SERRES.fermee).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.COULEURS_SERRES.ouverte.toLowerCase()).not.toBe(m.COULEURS_SERRES.fermee.toLowerCase());
    expect(m.COULEURS_SERRES.ouverte.toLowerCase()).not.toBe(COULEUR_ESTOMPEE.toLowerCase());
  });

  it('filtre éteint : rien ne change (même objet)', () => {
    expect(m.colorerSerres(filtree, etats(), false)).toBe(filtree);
  });

  it('filtre allumé : Serre 1 (ouverte) en couleur vive, Serre 2 et Tunnel 3 fermés, le reste estompé', () => {
    const f = m.colorerSerres(filtree, etats(), true);
    const c = Object.fromEntries(f.batiments.map((b) => [b.id, b.couleur]));
    expect(c.b1).toBe(m.COULEURS_SERRES.ouverte);
    expect(c.b2).toBe(m.COULEURS_SERRES.fermee);
    expect(c.b3).toBe(m.COULEURS_SERRES.fermee);
    expect([c.b4, c.b5, c.b6]).toEqual([COULEUR_ESTOMPEE, COULEUR_ESTOMPEE, COULEUR_ESTOMPEE]);
  });

  it('filtre allumé : les planches de la serre ouverte gardent leur couleur, les autres sont estompées', () => {
    const f = m.colorerSerres(filtree, etats(), true);
    const v = Object.fromEntries(f.volumes.map((x) => [x.id, [x.estompe, x.couleur]]));
    expect(v.p1).toEqual([false, '#336633']);
    expect(v.p2).toEqual([true, COULEUR_ESTOMPEE]);
    expect(v.p3).toEqual([true, COULEUR_ESTOMPEE]);
    expect(v.p4).toEqual([true, COULEUR_ESTOMPEE]);
  });

  it('tout est fermé : plus aucune couleur vive (le soir, on voit d’un coup d’œil que tout est fermé)', () => {
    const fermes = m.etatsBatiments(BATIMENTS, ZONES, [], MIDI);
    const f = m.colorerSerres(filtree, fermes, true);
    expect(f.batiments.some((b) => b.couleur === m.COULEURS_SERRES.ouverte)).toBe(false);
    expect(f.volumes.every((x) => x.estompe)).toBe(true);
  });

  it('ne modifie pas la scène reçue', () => {
    const avant = JSON.stringify(filtree);
    m.colorerSerres(filtree, etats(), true);
    expect(JSON.stringify(filtree)).toBe(avant);
  });
});

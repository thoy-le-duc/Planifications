/**
 * Tests d'acceptation T57 — les vannes dans la vue 3D, partie pure (plan3d/vannes.ts) : repère de
 * chaque vanne (placée, ou en tête de sa première planche), planches mises en évidence au tap,
 * filtre « Irrigation » selon la date de la dernière irrigation, phrase de la fiche.
 * Contrat : ./test/contrat-vannes.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { COULEUR_ESTOMPEE, type SceneFiltree, type VolumeFiltre } from './scene.ts';
import { CHEMIN_VANNES_3D, type IrrigationLue, type LienLu, type ModuleVannes3d, type VanneLue } from './test/contrat-vannes.ts';

let m: ModuleVannes3d;

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN_VANNES_3D)) as ModuleVannes3d;
});

const AUJOURDHUI = '2026-10-19';
const proche = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

const volume = (id: string, code: string, x: number, z: number, angle: number, autres: Partial<VolumeFiltre> = {}): VolumeFiltre => ({
  id,
  code,
  zoneId: 'z',
  x,
  z,
  longueur: 30,
  largeur: 0.8,
  hauteur: 0.3,
  angle,
  placee: true,
  couleur: '#aa0000',
  cleFamille: null,
  culture: 'Tomate',
  occupationId: null,
  estompe: false,
  hauteurRendue: 0.3,
  ...autres,
});

// P10 avant P3 dans la scène : l'ordre des codes, pas celui de la scène, décide de la « première planche ».
const VOLUMES = [volume('p10', 'P10', 0, 0, 0), volume('p3', 'P3', 10, 5, 0), volume('p4', 'P4', 10, 7, Math.PI / 2), volume('pc1', 'PC-01', 50, 50, 0)];
const vanne = (id: string, numero: number, x: number | null = null, y: number | null = null): VanneLue => ({ id, numero, nom: `V${String(numero)}`, x, y });
const lien = (id: string, secteurId: string, emplacementId: string, du = '2026-01-01', au: string | null = null): LienLu => ({ id, secteurId, emplacementId, du, au });

describe('T57 : repère de chaque vanne dans la scène', () => {
  const liens = [lien('a', 'v12', 'p10'), lien('b', 'v12', 'p3'), lien('c', 'v12', 'p4'), lien('d', 'v13', 'pc1'), lien('e', 'v14', 'p3', '2026-01-01', '2026-06-30')];

  it('vanne placée : à sa position (x, −y), avec ses planches dans l’ordre des codes', () => {
    const [r] = m.reperesVannes([vanne('v12', 12, 120.5, 16)], liens, VOLUMES, AUJOURDHUI);
    expect(r).toMatchObject({ id: 'v12', numero: 12, nom: 'V12', x: 120.5, z: -16 });
    expect(r?.codes).toEqual(['P3', 'P4', 'P10']);
    expect(r?.planches).toEqual(['p3', 'p4', 'p10']);
  });

  it('vanne non placée : en tête de sa première planche (P3, pas P10), au bout de départ', () => {
    const [r] = m.reperesVannes([vanne('v12', 12)], liens, VOLUMES, AUJOURDHUI);
    // P3 : centre (10, 5), angle 0, longueur 30 → départ en (10 − 15, 5).
    expect(proche(r?.x ?? Number.NaN, -5) && proche(r?.z ?? Number.NaN, 5)).toBe(true);
  });

  it('planche tournée (angle π/2) : le départ est le long de z', () => {
    const [r] = m.reperesVannes([vanne('v20', 20)], [lien('x', 'v20', 'p4')], VOLUMES, AUJOURDHUI);
    // P4 : centre (10, 7), angle π/2 → départ (10 − cos·15, 7 + sin·15) = (10, 22).
    expect(proche(r?.x ?? Number.NaN, 10) && proche(r?.z ?? Number.NaN, 22)).toBe(true);
  });

  it('vanne sans planche aujourd’hui ni placement : pas de repère ; repères triés par numéro', () => {
    const r = m.reperesVannes([vanne('v14', 14), vanne('v13', 13), vanne('v12', 12, 1, 1)], liens, VOLUMES, AUJOURDHUI);
    expect(r.map((x) => x.nom)).toEqual(['V12', 'V13']);
  });
});

describe('T57 : tap sur un repère, ses planches mises en évidence', () => {
  const filtree: SceneFiltree = { semaine: 0, libelleSemaine: 'S43', socles: [], batiments: [], volumes: VOLUMES };

  it('les planches de la vanne gardent leur couleur, les autres sont estompées ; rien d’autre ne change', () => {
    const r = m.colorer(filtree, { irrigation: null, evidence: new Set(['p3', 'p4']) });
    expect(r.volumes.map((v) => [v.id, v.estompe, v.couleur])).toEqual([
      ['p10', true, COULEUR_ESTOMPEE],
      ['p3', false, '#aa0000'],
      ['p4', false, '#aa0000'],
      ['pc1', true, COULEUR_ESTOMPEE],
    ]);
    const sans = (v: VolumeFiltre): Record<string, unknown> => Object.fromEntries(Object.entries(v).filter(([c]) => c !== 'couleur' && c !== 'estompe'));
    expect(r.volumes.map(sans)).toEqual(VOLUMES.map(sans));
  });

  it('ni filtre ni vanne choisie : la scène filtrée est rendue telle quelle', () => {
    expect(m.colorer(filtree, { irrigation: null, evidence: null })).toBe(filtree);
  });
});

describe('T57 : filtre « Irrigation » selon la date de la dernière irrigation', () => {
  const irr = (id: string, date: string): IrrigationLue => ({ id, secteurId: 'v12', date, horodatage: `${date}T05:00:00.000Z`, dureeMinutes: 20 });
  const dernieres = new Map([
    ['p3', irr('a', '2026-10-19')],
    ['p4', irr('b', '2026-10-18')],
    ['p10', irr('c', '2026-10-02')],
  ]);

  it('aujourd’hui, hier, plus ancienne, jamais', () => {
    const c = m.classesIrrigation(VOLUMES, dernieres, AUJOURDHUI);
    expect(Object.fromEntries(c)).toEqual({ p3: 'aujourdhui', p4: 'hier', p10: 'ancienne', pc1: 'jamais' });
  });

  it('quatre couleurs distinctes, posées sur les planches, aucune estompée', () => {
    const couleurs = Object.values(m.COULEURS_IRRIGATION);
    expect(new Set(couleurs).size).toBe(4);
    for (const c of couleurs) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    const filtree: SceneFiltree = { semaine: 0, libelleSemaine: 'S43', socles: [], batiments: [], volumes: VOLUMES.map((v) => ({ ...v, estompe: true })) };
    const r = m.colorer(filtree, { irrigation: m.classesIrrigation(VOLUMES, dernieres, AUJOURDHUI), evidence: null });
    expect(r.volumes.map((v) => v.couleur)).toEqual([m.COULEURS_IRRIGATION.ancienne, m.COULEURS_IRRIGATION.aujourdhui, m.COULEURS_IRRIGATION.hier, m.COULEURS_IRRIGATION.jamais]);
    expect(r.volumes.every((v) => !v.estompe)).toBe(true);
  });

  it('filtre et vanne choisie ensemble : couleurs de l’irrigation sur ses planches, les autres estompées', () => {
    const filtree: SceneFiltree = { semaine: 0, libelleSemaine: 'S43', socles: [], batiments: [], volumes: VOLUMES };
    const r = m.colorer(filtree, { irrigation: m.classesIrrigation(VOLUMES, dernieres, AUJOURDHUI), evidence: new Set(['p3']) });
    expect(r.volumes.map((v) => v.couleur)).toEqual([COULEUR_ESTOMPEE, m.COULEURS_IRRIGATION.aujourdhui, COULEUR_ESTOMPEE, COULEUR_ESTOMPEE]);
  });
});

describe('T57 : la fiche d’une vanne', () => {
  const locale = (jour: string, h: number, min: number): string => {
    const [a, mo, j] = jour.split('-').map(Number);
    return new Date(a ?? 2026, (mo ?? 1) - 1, j ?? 1, h, min).toISOString();
  };
  const derniere = (date: string, h: number, min: number, duree: number): IrrigationLue => ({ id: 'e', secteurId: 'v12', date, horodatage: locale(date, h, min), dureeMinutes: duree });

  it('« V12 — arrose P3, P4, P5 — dernière irrigation : aujourd’hui 7 h, 20 min »', () => {
    expect(m.phraseVanne({ nom: 'V12', codes: ['P3', 'P4', 'P5'] }, derniere('2026-10-19', 7, 0, 20), AUJOURDHUI)).toBe('V12 — arrose P3, P4, P5 — dernière irrigation : aujourd’hui 7 h, 20 min');
  });

  it('hier, à la demi-heure, plus d’une heure', () => {
    expect(m.phraseVanne({ nom: 'V3', codes: ['PC-01'] }, derniere('2026-10-18', 18, 30, 90), AUJOURDHUI)).toBe('V3 — arrose PC-01 — dernière irrigation : hier 18 h 30, 1 h 30');
    expect(m.phraseVanne({ nom: 'V3', codes: ['PC-01'] }, derniere('2026-10-18', 6, 5, 60), AUJOURDHUI)).toBe('V3 — arrose PC-01 — dernière irrigation : hier 6 h 05, 1 h');
  });

  it('plus ancienne : la date en toutes lettres', () => {
    expect(m.phraseVanne({ nom: 'V3', codes: ['P1'] }, derniere('2026-10-12', 7, 0, 15), AUJOURDHUI)).toBe('V3 — arrose P1 — dernière irrigation : le 12 octobre 7 h, 15 min');
  });

  it('sans planche, sans irrigation', () => {
    expect(m.phraseVanne({ nom: 'V14', codes: [] }, null, AUJOURDHUI)).toBe('V14 — n’arrose aucune planche — dernière irrigation : aucune');
  });
});

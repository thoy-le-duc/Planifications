/**
 * T90 (relecture) : règles pures de la duplication (./duplication.tsx), en plus des tests d'acceptation (dupliquer-editeur.test.tsx) :
 * la copie reprend TOUS les emplacements en service de la zone et de ses sous-zones (toutes sortes, placés ou non, les non placés
 * restent non placés), et les sous-zones gardent leur ordre naturel (« Z 9 » avant « Z 10 ») dans la copie.
 */
import { describe, expect, it } from 'vitest';
import { analyserSource, preparerDuplication, type ContexteDuplication, type LigneEmplacement } from './duplication.tsx';
import type { Batiment, Planche, Zone } from './donnees.ts';

const serre: Batiment = {
  id: 'b1',
  nom: 'Serre Z',
  type: 'serre_tunnel',
  centre: { x: 100, y: 50 },
  orientationDeg: 0,
  longueurM: 40,
  largeurM: 19.2,
  hauteurM: 3.5,
  zoneId: 'r',
  nouveau: false,
  ligne: { nb_chapelles: 2, nb_troncons: 1, largeur_allee_m: null, cree_le: 'x' },
};
const zone = (id: string, nom: string, parenteId: string | null): Zone => ({ id, nom, contour: null, parenteId, typeAbri: 'tunnel' });
const emp = (id: string, zoneId: string, code: string, sorte: string, placement: LigneEmplacement['placement']): LigneEmplacement => ({ id, zoneId, code, sorte, longueurM: 38, largeurM: sorte === 'rang' ? null : 0.75, placement });
const planche = (id: string, zoneId: string, code: string, x: number): Planche => ({ id, zoneId, code, longueurM: 38, largeurM: 0.75, placement: { x, y: 0, orientation_deg: 0 } });

/** Ordre de lecture SQL (nom, id) : « Z 10 » avant « Z 9 ». */
const zones = [zone('r', 'Serre Z', null), zone('z10', 'Z 10', 'r'), zone('z9', 'Z 9', 'r')];
const contexte = (extra: Partial<ContexteDuplication> = {}): ContexteDuplication => ({
  racineId: 'r',
  batiments: [serre],
  planches: [planche('p9', 'z9', 'P1', -5), planche('p10', 'z10', 'P1', 5)],
  infos: new Map(zones.map((z) => [z.id, { zone: z, abritee: true, affiche: null }])),
  emplacements: [
    emp('p9', 'z9', 'P1', 'planche', { x: -5, y: 0, orientation_deg: 0 }),
    emp('n9', 'z9', 'P2', 'planche', null),
    emp('r9', 'z9', 'R1', 'rang', null),
    emp('p10', 'z10', 'P1', 'planche', { x: 5, y: 0, orientation_deg: 0 }),
    emp('n10', 'z10', 'P2', 'planche', null),
    emp('direct', 'r', 'T-1', 'planche', null),
    emp('ailleurs', 'autre', 'X', 'planche', null),
  ],
  ...extra,
});
const ids = (): (() => string) => {
  let n = 0;
  return () => `id${String((n += 1))}`;
};
const demande = { nombre: 1, ecartM: 1.5 };

function copie(c: ContexteDuplication) {
  const s = analyserSource(c);
  if (typeof s === 'string') throw new Error(s);
  return { s, r: preparerDuplication(c, s, demande, ids()) };
}

describe('T90 : tous les emplacements sont repris', () => {
  it('les 6 emplacements de la zone et de ses sous-zones, placés ou non, de toutes sortes ; pas ceux d’une autre zone', () => {
    const { r } = copie(contexte());
    expect(r.creation.planches).toHaveLength(6);
    expect(r.creation.planches.map((p) => p.code).sort()).toEqual(['P1', 'P1', 'P2', 'P2', 'R1', 'T-1']);
  });

  it('la sorte est gardée (un rang reste un rang, sa largeur absente reste absente)', () => {
    const { r } = copie(contexte());
    const rang = r.creation.planches.find((p) => p.code === 'R1');
    expect(rang).toMatchObject({ sorte: 'rang', largeurM: null, longueurM: 38 });
  });

  it('les non placés restent non placés : seuls les 2 placés ont une place au brouillon, la même que l’original', () => {
    const { r } = copie(contexte());
    expect(r.planches).toHaveLength(2);
    expect(r.planches.map((p) => p.placement.x).sort((a, b) => a - b)).toEqual([-5, 5]);
  });

  it('les écritures d’une copie comptent tous les emplacements : 3 zones + 6 emplacements + 1 bâtiment', () => {
    const { s } = copie(contexte());
    expect(typeof s !== 'string' && s.ecrituresParCopie).toBe(10);
  });

  it('un emplacement d’une sorte qui ne se crée pas (gouttière) : la duplication est refusée avec une phrase', () => {
    const s = analyserSource(contexte({ emplacements: [emp('g', 'z9', 'G1', 'gouttiere', null)] }));
    expect(typeof s).toBe('string');
  });

  it('un emplacement du brouillon (absent de la base) mais affiché est repris comme planche placée', () => {
    const { r } = copie(contexte({ emplacements: [], planches: [planche('neuve', 'z9', 'P7', 1)] }));
    expect(r.creation.planches).toHaveLength(1);
    expect(r.planches).toHaveLength(1);
  });
});

describe('T90 : l’ordre des sous-zones est gardé (« Z 9 » avant « Z 10 »)', () => {
  it('les copies s’appellent « Z 11 » (de « Z 9 ») et « Z 12 » (de « Z 10 »), malgré l’ordre de lecture', () => {
    const { r } = copie(contexte());
    const zoneDe = (x: number) => r.creation.zones.find((z) => z.id === r.planches.find((p) => p.placement.x === x)?.zoneId)?.nom;
    expect(zoneDe(-5)).toBe('Z 11');
    expect(zoneDe(5)).toBe('Z 12');
  });

  it('l’ordre naturel des noms de la copie est celui de l’original (9 avant 10), pour 2 copies aussi', () => {
    const c = contexte();
    const s = analyserSource(c);
    if (typeof s === 'string') throw new Error(s);
    const r = preparerDuplication(c, s, { nombre: 2, ecartM: 1.5 }, ids());
    const filles = r.creation.zones.filter((z) => z.parenteId !== 'r' && z.parenteId !== null);
    expect(filles.map((z) => z.nom)).toEqual(['Z 11', 'Z 12', 'Z 13', 'Z 14']);
    const zoneDe = (x: number, k: number) => r.creation.zones.find((z) => z.id === r.planches.filter((p) => p.placement.x === x)[k]?.zoneId)?.nom;
    expect([zoneDe(-5, 0), zoneDe(5, 0), zoneDe(-5, 1), zoneDe(5, 1)]).toEqual(['Z 11', 'Z 12', 'Z 13', 'Z 14']);
  });
});

describe('T90 : le brouillon fait foi sur les planches placées', () => {
  it('une planche placée en base mais absente de l’affichage (retirée au brouillon) n’est pas copiée', () => {
    const { r } = copie(contexte({ planches: [planche('p10', 'z10', 'P1', 5)] }));
    expect(r.creation.planches.map((p) => p.code).sort()).toEqual(['P1', 'P2', 'P2', 'R1', 'T-1']);
    expect(r.planches).toHaveLength(1);
  });

  it('une planche changée de zone au brouillon est copiée dans la copie de sa zone du brouillon', () => {
    const { r } = copie(contexte({ planches: [planche('p9', 'z10', 'P1', -5), planche('p10', 'z10', 'P1', 5)] }));
    const zoneDe = (x: number) => r.creation.zones.find((z) => z.id === r.planches.find((p) => p.placement.x === x)?.zoneId)?.nom;
    expect(zoneDe(-5)).toBe('Z 12');
    expect(zoneDe(5)).toBe('Z 12');
  });

  it('une planche déplacée hors de la zone dupliquée n’est pas copiée', () => {
    const { r } = copie(contexte({ planches: [planche('p9', 'autre', 'P1', -5), planche('p10', 'z10', 'P1', 5)] }));
    expect(r.creation.planches.map((p) => p.code).sort()).toEqual(['P1', 'P2', 'P2', 'R1', 'T-1']);
  });
});

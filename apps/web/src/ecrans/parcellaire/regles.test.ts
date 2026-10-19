/**
 * Tests d'acceptation T49 — règles pures de « Ma ferme » (saisons, zones, planches) : les mêmes
 * que le serveur (apps/api/src/sync/structure-lignes.ts), avec des refus lisibles.
 * Contrat : ./test/contrat.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModuleRegles } from './test/contrat.ts';

const CHEMIN = './regles.ts';
let r: ModuleRegles;

beforeAll(async () => {
  r = (await import(/* @vite-ignore */ CHEMIN)) as ModuleRegles;
});

describe('T49 : saisons', () => {
  it('saison proposée : l’année du jour, du 1er janvier au 31 décembre ; l’année suivante si le nom est pris', () => {
    expect(r.saisonProposee('2026-10-19', [])).toEqual({ nom: '2026', debut: '2026-01-01', fin: '2026-12-31' });
    expect(r.saisonProposee('2026-10-19', ['2026'])).toEqual({ nom: '2027', debut: '2027-01-01', fin: '2027-12-31' });
    expect(r.saisonProposee('2026-10-19', [' 2026 ', '2027'])).toEqual({ nom: '2028', debut: '2028-01-01', fin: '2028-12-31' });
  });

  it('saison valide : nom rogné', () => {
    expect(r.verifierSaison({ nom: '  2026 ', debut: '2026-01-01', fin: '2026-12-31' })).toEqual({ ok: true, valeur: { nom: '2026', debut: '2026-01-01', fin: '2026-12-31' } });
    // Une saison d'un jour est permise (le serveur refuse seulement fin < début).
    expect(r.verifierSaison({ nom: 'Un jour', debut: '2026-05-01', fin: '2026-05-01' }).ok).toBe(true);
  });

  it('refus lisibles : nom vide, dates dans le désordre, date invalide, hors 1900–2100, nom trop long', () => {
    const vide = r.verifierSaison({ nom: '   ', debut: '2026-01-01', fin: '2026-12-31' });
    expect(vide).toMatchObject({ ok: false, champ: 'nom' });
    if (!vide.ok) expect(vide.message).toMatch(/nom/i);

    const desordre = r.verifierSaison({ nom: '2026', debut: '2026-12-31', fin: '2026-01-01' });
    expect(desordre).toMatchObject({ ok: false, champ: 'fin' });
    if (!desordre.ok) expect(desordre.message).toMatch(/finit avant de commencer/);

    for (const [debut, fin, champ] of [
      ['', '2026-12-31', 'debut'],
      ['2026-02-30', '2026-12-31', 'debut'],
      ['2026-01-01', 'demain', 'fin'],
      ['1899-12-31', '2026-12-31', 'debut'],
      ['2026-01-01', '2101-01-01', 'fin'],
    ] as const) {
      const v = r.verifierSaison({ nom: '2026', debut, fin });
      expect(v, `${debut} → ${fin}`).toMatchObject({ ok: false, champ });
      if (!v.ok) expect(v.message.length).toBeGreaterThan(5);
    }
    expect(r.verifierSaison({ nom: 'x'.repeat(201), debut: '2026-01-01', fin: '2026-12-31' })).toMatchObject({ ok: false, champ: 'nom' });
    expect(r.verifierSaison({ nom: 'x'.repeat(200), debut: '2026-01-01', fin: '2026-12-31' }).ok).toBe(true);
  });
});

describe('T49 : zones', () => {
  it('zone valide (nom rogné, parente facultative) ; refus du nom vide et d’un type d’abri inconnu', () => {
    expect(r.verifierZone({ nom: ' Tunnel 1 ', typeAbri: 'tunnel', parenteId: null })).toEqual({ ok: true, valeur: { nom: 'Tunnel 1', typeAbri: 'tunnel', parenteId: null } });
    for (const t of ['plein_champ', 'tunnel', 'serre', 'hors_sol']) expect(r.verifierZone({ nom: 'Z', typeAbri: t, parenteId: null }).ok, t).toBe(true);
    expect(r.verifierZone({ nom: '', typeAbri: 'tunnel', parenteId: null })).toMatchObject({ ok: false, champ: 'nom' });
    expect(r.verifierZone({ nom: 'Z', typeAbri: 'verger', parenteId: null })).toMatchObject({ ok: false, champ: 'typeAbri' });
  });
});

describe('T49 : planches en lot', () => {
  it('10 planches « P » : P1…P10 ; à la suite des codes déjà pris (sans casse ni espaces)', () => {
    expect(r.codesDuLot('P', 10, [])).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']);
    expect(r.codesDuLot('P', 3, ['p1', ' P2 ', 'P10', 'T1-P4', 'Pa'])).toEqual(['P11', 'P12', 'P13']);
    expect(r.codesDuLot('T1-P', 2, ['P1'])).toEqual(['T1-P1', 'T1-P2']);
    // Sans préfixe : des numéros.
    expect(r.codesDuLot('', 3, ['2'])).toEqual(['3', '4', '5']);
  });

  it('lot vérifié : nombre, longueur et largeur lus (virgule acceptée)', () => {
    expect(r.verifierLot({ nombre: '10', prefixe: 'P', longueur: '30', largeur: '0,8' }, [])).toEqual({
      ok: true,
      valeur: { codes: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'], longueurM: 30, largeurM: 0.8 },
    });
  });

  it('refus lisibles : nombre hors 1–200, longueur ou largeur nulle, illisible ou trop grande', () => {
    for (const [l, champ] of [
      [{ nombre: '0', prefixe: 'P', longueur: '30', largeur: '0,8' }, 'nombre'],
      [{ nombre: '201', prefixe: 'P', longueur: '30', largeur: '0,8' }, 'nombre'],
      [{ nombre: '2,5', prefixe: 'P', longueur: '30', largeur: '0,8' }, 'nombre'],
      [{ nombre: '10', prefixe: 'P', longueur: '0', largeur: '0,8' }, 'longueur'],
      [{ nombre: '10', prefixe: 'P', longueur: 'trente', largeur: '0,8' }, 'longueur'],
      [{ nombre: '10', prefixe: 'P', longueur: '10001', largeur: '0,8' }, 'longueur'],
      [{ nombre: '10', prefixe: 'P', longueur: '30', largeur: '' }, 'largeur'],
      [{ nombre: '10', prefixe: 'P', longueur: '30', largeur: '1001' }, 'largeur'],
      [{ nombre: '10', prefixe: 'x'.repeat(199), longueur: '30', largeur: '0,8' }, 'prefixe'],
    ] as const) {
      const v = r.verifierLot(l, []);
      expect(v, JSON.stringify(l)).toMatchObject({ ok: false, champ });
      if (!v.ok) expect(v.message.length).toBeGreaterThan(5);
    }
  });
});

describe('T49 : une planche', () => {
  const planche = { code: 'P3', sorte: 'planche', longueur: '30', largeur: '0,8', nombrePains: '' } as const;

  it('valide : code rogné, largeur facultative, gouttière avec son nombre de pains', () => {
    expect(r.verifierEmplacement({ ...planche, code: ' P3 ' }, ['P1'])).toEqual({ ok: true, valeur: { code: 'P3', sorte: 'planche', longueurM: 30, largeurM: 0.8, nombrePains: null } });
    expect(r.verifierEmplacement({ ...planche, largeur: '' }, [])).toMatchObject({ ok: true, valeur: { largeurM: null } });
    expect(r.verifierEmplacement({ ...planche, sorte: 'gouttiere', nombrePains: '30' }, [])).toMatchObject({ ok: true, valeur: { sorte: 'gouttiere', nombrePains: 30 } });
    expect(r.verifierEmplacement({ ...planche, sorte: 'rang', nombrePains: '' }, [])).toMatchObject({ ok: true, valeur: { sorte: 'rang', nombrePains: null } });
  });

  it('refus d’un code en double dans la zone (sans casse ni espaces autour)', () => {
    const v = r.verifierEmplacement({ ...planche, code: ' p1 ' }, ['P1', 'P2']);
    expect(v).toMatchObject({ ok: false, champ: 'code' });
    if (!v.ok) expect(v.message).toMatch(/existe déjà dans cette zone/);
  });

  it('refus lisibles : code vide, longueur nulle, gouttière sans pains, pains hors gouttière, sorte inconnue', () => {
    expect(r.verifierEmplacement({ ...planche, code: ' ' }, [])).toMatchObject({ ok: false, champ: 'code' });
    expect(r.verifierEmplacement({ ...planche, longueur: '0' }, [])).toMatchObject({ ok: false, champ: 'longueur' });
    expect(r.verifierEmplacement({ ...planche, sorte: 'gouttiere', nombrePains: '' }, [])).toMatchObject({ ok: false, champ: 'nombrePains' });
    expect(r.verifierEmplacement({ ...planche, sorte: 'gouttiere', nombrePains: '1,5' }, [])).toMatchObject({ ok: false, champ: 'nombrePains' });
    expect(r.verifierEmplacement({ ...planche, sorte: 'planche', nombrePains: '12' }, [])).toMatchObject({ ok: false, champ: 'nombrePains' });
    expect(r.verifierEmplacement({ ...planche, sorte: 'bac' }, [])).toMatchObject({ ok: false, champ: 'sorte' });
  });

  it('lireNombre : virgule ou point, espaces ; vide ou illisible → null', () => {
    expect(r.lireNombre('0,8')).toBe(0.8);
    expect(r.lireNombre(' 30 ')).toBe(30);
    expect(r.lireNombre('1.25')).toBe(1.25);
    expect(r.lireNombre('')).toBeNull();
    expect(r.lireNombre('abc')).toBeNull();
    expect(r.lireNombre('1,2,3')).toBeNull();
  });
});

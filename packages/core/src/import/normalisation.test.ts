/**
 * Tests d'acceptation T14 — normalisation des cellules : nombres, mesures avec unités, dates
 * (JJ/MM/AAAA, AAAA-MM-JJ, date Excel, semaine). Contrat : ./test/contrat.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerImport, type Cellule, type CodeErreurImport, type ModuleImport, type UniteMesure } from './test/contrat.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

const ok = <T>(valeur: T) => ({ ok: true, valeur });
const ko = (code: CodeErreurImport) => ({ ok: false, code });

describe('lireNombre : virgule ou point', () => {
  it.each([
    ['12,5', 12.5],
    ['12.5', 12.5],
    [' 12,5 ', 12.5],
    ['30', 30],
    ['-3,25', -3.25],
    ['0,1', 0.1],
    ['1 234,5', 1234.5],
    ['1\u00a0234,5', 1234.5],
    ['1\u202f234', 1234],
    [12.5, 12.5],
    [0, 0],
  ] as [Cellule, number][])('%j → %d', (cellule, attendu) => {
    expect(m.lireNombre(cellule)).toStrictEqual(ok(attendu));
  });

  it.each([null, '', '   '] as Cellule[])('%j → null (cellule vide)', (cellule) => {
    expect(m.lireNombre(cellule)).toStrictEqual(ok(null));
  });

  it.each(['abc', '1,2,3', '12,5 kg', '12..5', '1e3', ',', '-', Number.NaN, Number.POSITIVE_INFINITY] as Cellule[])('%j → nombre_invalide', (cellule) => {
    expect(m.lireNombre(cellule)).toStrictEqual(ko('nombre_invalide'));
  });
});

describe('lireMesure : unité dans la cellule ou dans l’en-tête, conversion exacte', () => {
  it.each([
    ['30', 'm', null, 30],
    ['30 m', 'm', null, 30],
    ['30m', 'm', null, 30],
    ['30 M', 'm', null, 30],
    ['1500 cm', 'm', null, 15],
    ['1500cm', 'm', 'm', 15],
    ['32,5', 'm', 'cm', 0.325],
    ['12,3', 'm', 'cm', 0.123],
    ['80', 'm', 'cm', 0.8],
    ['25,5 m', 'm', 'cm', 25.5],
    [25.5, 'cm', 'm', 2550],
    [0.3, 'cm', 'm', 30],
    ['0,3 m', 'cm', null, 30],
    ['250 g', 'g', null, 250],
    ['1,2 kg', 'g', null, 1200],
    ['1,2', 'g', 'kg', 1200],
    ['0,9', 'g', 'g', 0.9],
    ['1500 g', 'kg', null, 1.5],
    ['2,5 kg', 'kg', 'g', 2.5],
  ] as [Cellule, UniteMesure, UniteMesure | null, number][])('%j vers %s (en-tête : %s) → %d', (cellule, cible, parDefaut, attendu) => {
    expect(m.lireMesure(cellule, cible, parDefaut)).toStrictEqual(ok(attendu));
  });

  it('cellule vide → null', () => {
    expect(m.lireMesure('', 'm', 'cm')).toStrictEqual(ok(null));
    expect(m.lireMesure(null, 'g', null)).toStrictEqual(ok(null));
  });

  it.each([
    ['3 kg', 'm'],
    ['30 cm', 'g'],
    ['30 pieds', 'm'],
    ['30 ha', 'm'],
  ] as [string, UniteMesure][])('%s vers %s → unite_inconnue', (cellule, cible) => {
    expect(m.lireMesure(cellule, cible, null)).toStrictEqual(ko('unite_inconnue'));
  });

  it('nombre illisible → nombre_invalide', () => {
    expect(m.lireMesure('abc', 'm', null)).toStrictEqual(ko('nombre_invalide'));
    expect(m.lireMesure('trente m', 'm', null)).toStrictEqual(ko('nombre_invalide'));
  });
});

describe('lireDate', () => {
  it.each([
    ['03/04/2027', '2027-04-03'],
    ['3/4/2027', '2027-04-03'],
    [' 15/03/2027 ', '2027-03-15'],
    ['29/02/2028', '2028-02-29'],
    ['2027-04-03', '2027-04-03'],
  ] as [string, string][])('%j → %s', (cellule, attendu) => {
    expect(m.lireDate(cellule, null)).toStrictEqual(ok(attendu));
  });

  it.each(['31/02/2027', '29/02/2027', '2027-13-01', '32/01/2027', 'demain', '03/04', '2027'] as string[])('%j → date_invalide', (cellule) => {
    expect(m.lireDate(cellule, 2027)).toStrictEqual(ko('date_invalide'));
  });

  it('cellule vide → null', () => {
    expect(m.lireDate('', 2027)).toStrictEqual(ok(null));
    expect(m.lireDate(null, null)).toStrictEqual(ok(null));
  });

  describe('date Excel (numéro de jour, système 1900)', () => {
    it.each([
      [1, '1900-01-01'],
      [59, '1900-02-28'],
      [61, '1900-03-01'],
      [46461, '2027-03-15'],
      [46480, '2027-04-03'],
      [46480.75, '2027-04-03'],
      [46517, '2027-05-10'],
    ] as [number, string][])('%d → %s', (n, attendu) => {
      expect(m.lireDate(n, null)).toStrictEqual(ok(attendu));
    });

    it('60 : le 29/02/1900 d’Excel n’existe pas → date_invalide', () => {
      expect(m.lireDate(60, null)).toStrictEqual(ko('date_invalide'));
    });

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('%d → date_invalide', (n) => {
      expect(m.lireDate(n, null)).toStrictEqual(ko('date_invalide'));
    });
  });

  describe('semaine, avec l’année de la saison : lundi de la semaine ISO', () => {
    it.each([
      ['S14', '2027-04-05'],
      ['s14', '2027-04-05'],
      ['S 14', '2027-04-05'],
      ['sem 14', '2027-04-05'],
      ['Sem. 14', '2027-04-05'],
      ['semaine 14', '2027-04-05'],
      ['Semaine 14', '2027-04-05'],
      ['S1', '2027-01-04'],
      ['S01', '2027-01-04'],
      ['S10', '2027-03-08'],
      ['S52', '2027-12-27'],
    ] as [string, string][])('%j en 2027 → %s', (cellule, attendu) => {
      expect(m.lireDate(cellule, 2027)).toStrictEqual(ok(attendu));
    });

    it('S53 existe en 2026 (lundi 28/12/2026), pas en 2027', () => {
      expect(m.lireDate('S53', 2026)).toStrictEqual(ok('2026-12-28'));
      expect(m.lireDate('S53', 2027)).toStrictEqual(ko('date_invalide'));
    });

    it('S0 → date_invalide', () => {
      expect(m.lireDate('S0', 2027)).toStrictEqual(ko('date_invalide'));
    });

    it('sans année de saison → annee_manquante', () => {
      expect(m.lireDate('S14', null)).toStrictEqual(ko('annee_manquante'));
      expect(m.lireDate('sem 14', null)).toStrictEqual(ko('annee_manquante'));
    });
  });
});

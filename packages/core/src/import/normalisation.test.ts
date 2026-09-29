/**
 * Tests d'acceptation T14 — normalisation des cellules : nombres, mesures avec unités, dates
 * (JJ/MM/AAAA, AAAA-MM-JJ, date Excel, semaine). Contrat : ./test/contrat.ts.
 *
 * Relecture du chef : numéros de série hors de la plage de la saison (ou avant 1950) refusés,
 * système de dates 1904, ordre MM/JJ, cellules de plus de 200 caractères refusées. Les temps
 * linéaires sur 100 Kio sont vérifiés dans robustesse.test.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerImport, type Cellule, type CodeErreurImport, type ModuleImport, type OptionsDate, type UniteMesure } from './test/contrat.ts';

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

describe('cellules de plus de 200 caractères (relecture, point 3)', () => {
  it('lireNombre : 200 chiffres se lisent, 201 → nombre_invalide ; les espaces autour ne comptent pas', () => {
    expect(m.lireNombre('1'.repeat(200))).toStrictEqual(ok(Number('1'.repeat(200))));
    expect(m.lireNombre('1'.repeat(201))).toStrictEqual(ko('nombre_invalide'));
    expect(m.lireNombre(`${' '.repeat(300)}12,5${' '.repeat(300)}`)).toStrictEqual(ok(12.5));
  });

  it('lireMesure : plus de 200 caractères → nombre_invalide', () => {
    expect(m.lireMesure(`${'1'.repeat(198)} m`, 'm', null)).toStrictEqual(ok(Number('1'.repeat(198))));
    expect(m.lireMesure(`${'1'.repeat(199)} m`, 'm', null)).toStrictEqual(ko('nombre_invalide'));
    expect(m.lireMesure('a'.repeat(250), 'm', null)).toStrictEqual(ko('nombre_invalide'));
  });

  it('lireDate : plus de 200 caractères → date_invalide', () => {
    expect(m.lireDate(`S${' '.repeat(250)}14`, 2027)).toStrictEqual(ko('date_invalide'));
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
      [18264, '1950-01-01'],
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

    // Relecture, point 5 : ces numéros donnaient 1900-01-01, 1900-02-28 et 1900-03-01. Une date
    // d'avant 1950 dans un import de ferme est une quantité tombée dans une colonne date :
    // refusée désormais. Le décalage du 29/02/1900 reste vérifié par 46461 → 2027-03-15.
    it.each([1, 59, 61, 18263])('%d : avant 1950 sans année de saison → date_invalide', (n) => {
      expect(m.lireDate(n, null)).toStrictEqual(ko('date_invalide'));
    });

    it('avec l’année de la saison : de anneeSaison − 5 à anneeSaison + 5, sinon date_invalide', () => {
      expect(m.lireDate(44562, 2027)).toStrictEqual(ok('2022-01-01'));
      expect(m.lireDate(48579, 2027)).toStrictEqual(ok('2032-12-31'));
      expect(m.lireDate(44561, 2027)).toStrictEqual(ko('date_invalide'));
      expect(m.lireDate(48580, 2027)).toStrictEqual(ko('date_invalide'));
      expect(m.lireDate(18264, 2027)).toStrictEqual(ko('date_invalide'));
      expect(m.lireDate(12, 2027)).toStrictEqual(ko('date_invalide'));
    });

    it('la plage ne vaut que pour les numéros de série, pas pour les dates écrites', () => {
      expect(m.lireDate('03/04/2019', 2027)).toStrictEqual(ok('2019-04-03'));
      expect(m.lireDate('1949-06-01', null)).toStrictEqual(ok('1949-06-01'));
    });

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('%d → date_invalide', (n) => {
      expect(m.lireDate(n, null)).toStrictEqual(ko('date_invalide'));
    });
  });

  describe('système de dates 1904 (classeurs Mac anciens)', () => {
    it.each([
      [44999, 2027, '2027-03-15'],
      [43100, 2027, '2022-01-01'],
      [46461, 2027, '2031-03-16'],
      [44999.5, null, '2027-03-15'],
    ] as [number, number | null, string][])('%d (saison %s) → %s', (n, annee, attendu) => {
      expect(m.lireDate(n, annee, { systemeDates: 1904 })).toStrictEqual(ok(attendu));
    });

    it('1900 explicite = défaut ; 1904 : 0 est le 1904-01-01, avant 1950 → date_invalide', () => {
      expect(m.lireDate(46461, 2027, { systemeDates: 1900 })).toStrictEqual(ok('2027-03-15'));
      expect(m.lireDate(0, null, { systemeDates: 1904 })).toStrictEqual(ko('date_invalide'));
      expect(m.lireDate(43099, 2027, { systemeDates: 1904 })).toStrictEqual(ko('date_invalide'));
    });
  });

  describe('ordre du jour et du mois', () => {
    const MM_JJ: OptionsDate = { ordre: 'mm_jj' };

    it.each([
      ['04/15/2027', '2027-04-15'],
      ['4/5/2027', '2027-04-05'],
      ['12/31/2027', '2027-12-31'],
      ['2027-04-03', '2027-04-03'],
    ] as [string, string][])('MM/JJ : %j → %s', (cellule, attendu) => {
      expect(m.lireDate(cellule, 2027, MM_JJ)).toStrictEqual(ok(attendu));
    });

    it('MM/JJ : « 15/04/2027 » → date_invalide ; JJ/MM (défaut ou explicite) : « 04/15/2027 » → date_invalide', () => {
      expect(m.lireDate('15/04/2027', 2027, MM_JJ)).toStrictEqual(ko('date_invalide'));
      expect(m.lireDate('04/15/2027', 2027)).toStrictEqual(ko('date_invalide'));
      expect(m.lireDate('04/15/2027', 2027, { ordre: 'jj_mm' })).toStrictEqual(ko('date_invalide'));
      expect(m.lireDate('15/04/2027', 2027, { ordre: 'jj_mm' })).toStrictEqual(ok('2027-04-15'));
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

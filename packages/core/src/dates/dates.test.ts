/**
 * Tests d'acceptation T01 — dates calendaires.
 *
 * API attendue, exportée par `packages/core/src/dates/index.ts`
 * (et ré-exportée par `packages/core/src/index.ts`) :
 *
 *   type DateCalendaire              chaîne 'AAAA-MM-JJ' marquée (string & { marque }),
 *                                    assignable à string, mais une string ne l'est pas.
 *   type SemaineIso = { readonly annee: number; readonly semaine: number }
 *   type ErreurDate = { readonly code: 'format_invalide' | 'date_inexistante'; readonly saisie: string }
 *   type ResultatAnalyseDate =
 *     | { readonly ok: true; readonly date: DateCalendaire }
 *     | { readonly ok: false; readonly erreur: ErreurDate }
 *
 *   analyserDate(saisie: string): ResultatAnalyseDate      ne lève jamais d'exception
 *   estDateValide(saisie: string): saisie is DateCalendaire garde de type
 *   jourAbsolu(d: DateCalendaire): number                  jours entiers depuis 1970-01-01 (négatif avant)
 *   dateDepuisJourAbsolu(n: number): DateCalendaire        inverse de jourAbsolu ; RangeError si n non entier
 *   ajouterJours(d: DateCalendaire, n: number): DateCalendaire   RangeError si n non entier
 *   ecartEnJours(a: DateCalendaire, b: DateCalendaire): number   b − a, en jours (négatif si b < a)
 *   semaineIso(d: DateCalendaire): SemaineIso              ISO 8601 : semaine 1 = celle du premier jeudi
 *   formaterSemaineIso(s: SemaineIso): string              '2026-S53', '2027-S01'
 *   nombreSemainesIso(annee: number): number               52 ou 53
 *   lundiDeSemaine(annee: number, semaine: number): DateCalendaire
 *                                    RangeError si la semaine n'existe pas (0, 53 d'une année à 52
 *                                    semaines, non entier) : c'est une erreur de programmation,
 *                                    l'interface ne propose que des semaines existantes.
 *
 * Règles de format de analyserDate : exactement 'AAAA-MM-JJ' (4 chiffres, tiret, 2 chiffres,
 * tiret, 2 chiffres), années 0001 à 9999, aucun espace ni heure toléré.
 *   - forme non conforme            → code 'format_invalide'
 *   - forme conforme, date absente  → code 'date_inexistante' (mois 13, 30 février, année 0000…)
 * `saisie` recopie la chaîne reçue telle quelle.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ajouterJours,
  analyserDate,
  dateDepuisJourAbsolu,
  ecartEnJours,
  estDateValide,
  formaterSemaineIso,
  jourAbsolu,
  lundiDeSemaine,
  nombreSemainesIso,
  semaineIso,
} from './index.ts';
import type { DateCalendaire, ErreurDate, ResultatAnalyseDate, SemaineIso } from './index.ts';
import * as racine from '../index.ts';

/** Fabrique une DateCalendaire pour les tests ; échoue si la chaîne est invalide. */
function d(saisie: string): DateCalendaire {
  const resultat = analyserDate(saisie);
  if (!resultat.ok) {
    throw new Error(`date de test invalide : ${saisie}`);
  }
  return resultat.date;
}

/** Semaine au format lisible, pour des attentes courtes. */
function sem(saisie: string): string {
  return formaterSemaineIso(semaineIso(d(saisie)));
}

/** 1970-01-01 était un jeudi : un lundi a (jourAbsolu + 3) multiple de 7. */
function estUnLundi(date: DateCalendaire): boolean {
  return (((jourAbsolu(date) + 3) % 7) + 7) % 7 === 0;
}

describe('exemples chiffrés du ticket T01', () => {
  it.each([
    ['2026-12-31', '2026-S53'],
    ['2027-01-01', '2026-S53'],
    ['2027-01-03', '2026-S53'],
    ['2027-01-04', '2027-S01'],
    ['2024-12-30', '2025-S01'],
    ['2026-01-01', '2026-S01'],
  ])('semaineIso(%s) = %s', (date, attendu) => {
    expect(sem(date)).toBe(attendu);
  });

  it('semaineIso renvoie une forme structurée { annee, semaine }', () => {
    expect(semaineIso(d('2026-12-31'))).toEqual({ annee: 2026, semaine: 53 });
    expect(semaineIso(d('2027-01-04'))).toEqual({ annee: 2027, semaine: 1 });
    expect(semaineIso(d('2024-12-30'))).toEqual({ annee: 2025, semaine: 1 });
  });

  it('lundiDeSemaine(2027, 22) = 2027-05-31', () => {
    expect(lundiDeSemaine(2027, 22)).toBe('2027-05-31');
  });

  it('ecartEnJours(2024-02-28, 2024-03-01) = 2 (année bissextile)', () => {
    expect(ecartEnJours(d('2024-02-28'), d('2024-03-01'))).toBe(2);
  });

  it('ajouterJours(2027-04-05, -28) = 2027-03-08', () => {
    expect(ajouterJours(d('2027-04-05'), -28)).toBe('2027-03-08');
  });

  it('analyserDate(2027-02-30) renvoie une erreur, sans lever', () => {
    expect(() => analyserDate('2027-02-30')).not.toThrow();
    expect(analyserDate('2027-02-30')).toEqual({
      ok: false,
      erreur: { code: 'date_inexistante', saisie: '2027-02-30' },
    });
  });
});

describe('analyserDate et estDateValide', () => {
  it('accepte une date valide et renvoie la même chaîne', () => {
    expect(analyserDate('2027-02-28')).toEqual({ ok: true, date: '2027-02-28' });
    expect(analyserDate('0001-01-01')).toEqual({ ok: true, date: '0001-01-01' });
    expect(analyserDate('9999-12-31')).toEqual({ ok: true, date: '9999-12-31' });
  });

  it.each([
    '',
    'abc',
    '2027-1-05',
    '2027-01-5',
    '27-01-05',
    '02027-01-05',
    '2027/01/05',
    '05/01/2027',
    '20270105',
    ' 2027-01-05',
    '2027-01-05 ',
    '2027-01-05T00:00',
    '2027-01-05Z',
    '+2027-01-05',
    '-2027-01-05',
    '2027-0a-05',
    '２０２７-01-05',
  ])('format invalide : %j', (saisie) => {
    expect(() => analyserDate(saisie)).not.toThrow();
    expect(analyserDate(saisie)).toEqual({ ok: false, erreur: { code: 'format_invalide', saisie } });
    expect(estDateValide(saisie)).toBe(false);
  });

  it.each([
    '2027-13-01',
    '2027-00-10',
    '2027-01-00',
    '2027-01-32',
    '2027-04-31',
    '2027-02-29',
    '2027-02-30',
    '1900-02-29',
    '2100-02-29',
    '0000-01-01',
  ])('date inexistante : %s', (saisie) => {
    expect(analyserDate(saisie)).toEqual({ ok: false, erreur: { code: 'date_inexistante', saisie } });
    expect(estDateValide(saisie)).toBe(false);
  });

  it.each(['2000-02-29', '2024-02-29', '2028-02-29', '1600-02-29', '2027-12-31', '2027-01-31'])(
    'date valide : %s',
    (saisie) => {
      expect(estDateValide(saisie)).toBe(true);
      expect(analyserDate(saisie)).toEqual({ ok: true, date: saisie });
    },
  );

  it('29 février : règle grégorienne complète (4, 100, 400)', () => {
    expect(estDateValide('1900-02-29')).toBe(false);
    expect(estDateValide('2000-02-29')).toBe(true);
    expect(estDateValide('2024-02-29')).toBe(true);
    expect(estDateValide('2027-02-29')).toBe(false);
    expect(estDateValide('2100-02-29')).toBe(false);
  });

  it('estDateValide est une garde de type vers DateCalendaire', () => {
    function enDate(saisie: string): DateCalendaire | undefined {
      if (estDateValide(saisie)) {
        expectTypeOf(saisie).toEqualTypeOf<DateCalendaire>();
        return saisie;
      }
      return undefined;
    }
    expect(enDate('2027-03-08')).toBe('2027-03-08');
    expect(enDate('2027-02-30')).toBeUndefined();
  });

  it("le résultat est une union discriminée par 'ok'", () => {
    expectTypeOf(analyserDate).returns.toEqualTypeOf<ResultatAnalyseDate>();
    expectTypeOf<ErreurDate['code']>().toEqualTypeOf<'format_invalide' | 'date_inexistante'>();
    const resultat = analyserDate('2027-02-30');
    if (resultat.ok) {
      expectTypeOf(resultat.date).toEqualTypeOf<DateCalendaire>();
      expect.unreachable('2027-02-30 ne doit pas être accepté');
    } else {
      expectTypeOf(resultat.erreur).toEqualTypeOf<ErreurDate>();
      expect(resultat.erreur.code).toBe('date_inexistante');
    }
  });
});

describe('jour absolu', () => {
  it('compte les jours depuis 1970-01-01', () => {
    expect(jourAbsolu(d('1970-01-01'))).toBe(0);
    expect(jourAbsolu(d('1970-01-02'))).toBe(1);
    expect(jourAbsolu(d('1969-12-31'))).toBe(-1);
    expect(jourAbsolu(d('2000-01-01'))).toBe(10957);
    expect(jourAbsolu(d('2000-03-01'))).toBe(11017);
    expect(jourAbsolu(d('0001-01-01'))).toBe(-719162);
  });

  it('dateDepuisJourAbsolu est l’inverse exact', () => {
    expect(dateDepuisJourAbsolu(0)).toBe('1970-01-01');
    expect(dateDepuisJourAbsolu(-1)).toBe('1969-12-31');
    expect(dateDepuisJourAbsolu(11017)).toBe('2000-03-01');
    expect(dateDepuisJourAbsolu(-719162)).toBe('0001-01-01');
  });

  it('refuse un nombre de jours non entier', () => {
    expect(() => dateDepuisJourAbsolu(0.5)).toThrow(RangeError);
    expect(() => dateDepuisJourAbsolu(Number.NaN)).toThrow(RangeError);
  });

  it('aller-retour jour par jour de 1899-12-01 à 2101-01-31, dates toujours valides et consécutives', () => {
    let precedent = jourAbsolu(d('1899-12-01'));
    const fin = jourAbsolu(d('2101-01-31'));
    for (let n = precedent + 1; n <= fin; n++) {
      const date = dateDepuisJourAbsolu(n);
      if (!estDateValide(date) || jourAbsolu(date) !== n || n !== precedent + 1) {
        expect.unreachable(`jour absolu ${String(n)} → ${date}`);
      }
      precedent = n;
    }
    expect(dateDepuisJourAbsolu(fin)).toBe('2101-01-31');
  });
});

describe('ajouterJours', () => {
  it.each([
    ['2027-04-05', 0, '2027-04-05'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2023-02-28', 1, '2023-03-01'],
    ['2000-02-28', 1, '2000-02-29'],
    ['1900-02-28', 1, '1900-03-01'],
    ['2100-02-28', 1, '2100-03-01'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2027-03-01', -1, '2027-02-28'],
    ['2027-01-01', 365, '2028-01-01'],
    ['2028-01-01', 366, '2029-01-01'],
    ['2027-05-31', -147, '2027-01-04'],
    ['2027-03-13', 1, '2027-03-14'],
    ['2027-03-27', 1, '2027-03-28'],
    ['2027-10-30', 2, '2027-11-01'],
    ['1970-01-01', -1, '1969-12-31'],
  ] as const)('ajouterJours(%s, %i) = %s', (depart, n, attendu) => {
    expect(ajouterJours(d(depart), n)).toBe(attendu);
  });

  it('refuse un nombre de jours non entier', () => {
    expect(() => ajouterJours(d('2027-04-05'), 1.5)).toThrow(RangeError);
    expect(() => ajouterJours(d('2027-04-05'), Number.NaN)).toThrow(RangeError);
    expect(() => ajouterJours(d('2027-04-05'), Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('ecartEnJours', () => {
  it.each([
    ['2024-02-28', '2024-03-01', 2],
    ['2023-02-28', '2023-03-01', 1],
    ['2027-03-08', '2027-04-05', 28],
    ['2027-04-05', '2027-03-08', -28],
    ['2027-04-05', '2027-04-05', 0],
    ['2026-01-01', '2027-01-01', 365],
    ['2024-01-01', '2025-01-01', 366],
    ['2026-12-31', '2027-01-01', 1],
    ['1969-12-31', '1970-01-01', 1],
    ['2000-01-01', '2100-01-01', 36525],
  ] as const)('ecartEnJours(%s, %s) = %i', (a, b, attendu) => {
    expect(ecartEnJours(d(a), d(b))).toBe(attendu);
  });

  it('aller-retour avec ajouterJours', () => {
    const depart = d('2027-04-05');
    for (let n = -800; n <= 800; n += 7) {
      const arrivee = ajouterJours(depart, n);
      expect(ecartEnJours(depart, arrivee)).toBe(n);
      expect(ecartEnJours(arrivee, depart)).toBe(-n);
      expect(ajouterJours(arrivee, -n)).toBe(depart);
    }
  });
});

describe('semaineIso', () => {
  it.each([
    ['2021-01-03', '2020-S53'],
    ['2021-01-04', '2021-S01'],
    ['2020-12-31', '2020-S53'],
    ['2008-12-29', '2009-S01'],
    ['2010-01-03', '2009-S53'],
    ['2027-05-31', '2027-S22'],
    ['2027-06-06', '2027-S22'],
    ['2027-06-07', '2027-S23'],
    ['2027-12-31', '2027-S52'],
    ['2028-01-02', '2027-S52'],
    ['2028-01-03', '2028-S01'],
    ['1970-01-01', '1970-S01'],
  ])('semaineIso(%s) = %s', (date, attendu) => {
    expect(sem(date)).toBe(attendu);
  });

  it('formaterSemaineIso met la semaine sur deux chiffres', () => {
    const s: SemaineIso = { annee: 2027, semaine: 1 };
    expect(formaterSemaineIso(s)).toBe('2027-S01');
    expect(formaterSemaineIso({ annee: 2026, semaine: 53 })).toBe('2026-S53');
    expect(formaterSemaineIso({ annee: 2027, semaine: 22 })).toBe('2027-S22');
  });

  it('chaque jour de 2020 à 2030 appartient à la semaine de son lundi', () => {
    const debut = d('2020-01-01');
    const nbJours = ecartEnJours(debut, d('2030-12-31'));
    for (let i = 0; i <= nbJours; i++) {
      const jour = ajouterJours(debut, i);
      const s = semaineIso(jour);
      const lundi = lundiDeSemaine(s.annee, s.semaine);
      const ecart = ecartEnJours(lundi, jour);
      if (ecart < 0 || ecart > 6) {
        expect.unreachable(`${jour} tombe hors de sa semaine ${formaterSemaineIso(s)}`);
      }
    }
  });
});

describe('nombreSemainesIso', () => {
  it.each([
    [2015, 53],
    [2020, 53],
    [2024, 52],
    [2025, 52],
    [2026, 53],
    [2027, 52],
    [2032, 53],
  ])('%i compte %i semaines', (annee, attendu) => {
    expect(nombreSemainesIso(annee)).toBe(attendu);
  });
});

describe('lundiDeSemaine', () => {
  it.each([
    [2027, 22, '2027-05-31'],
    [2027, 1, '2027-01-04'],
    [2027, 52, '2027-12-27'],
    [2026, 1, '2025-12-29'],
    [2026, 53, '2026-12-28'],
    [2025, 1, '2024-12-30'],
    [2020, 53, '2020-12-28'],
    [2009, 53, '2009-12-28'],
  ])('lundiDeSemaine(%i, %i) = %s', (annee, semaine, attendu) => {
    expect(lundiDeSemaine(annee, semaine)).toBe(attendu);
  });

  it('refuse une semaine qui n’existe pas (RangeError)', () => {
    expect(nombreSemainesIso(2027)).toBe(52);
    expect(() => lundiDeSemaine(2027, 53)).toThrow(RangeError);
    expect(() => lundiDeSemaine(2027, 0)).toThrow(RangeError);
    expect(() => lundiDeSemaine(2027, -1)).toThrow(RangeError);
    expect(() => lundiDeSemaine(2027, 1.5)).toThrow(RangeError);
    expect(() => lundiDeSemaine(2027.5, 10)).toThrow(RangeError);
  });

  it('de 1990 à 2060 : toujours un lundi, aller-retour exact avec semaineIso, semaines contiguës', () => {
    let lundiPrecedent: DateCalendaire | undefined;
    for (let annee = 1990; annee <= 2060; annee++) {
      const nb = nombreSemainesIso(annee);
      for (let semaine = 1; semaine <= nb; semaine++) {
        const lundi = lundiDeSemaine(annee, semaine);
        const retour = semaineIso(lundi);
        const dimanche = semaineIso(ajouterJours(lundi, 6));
        const ok =
          estUnLundi(lundi) &&
          retour.annee === annee &&
          retour.semaine === semaine &&
          dimanche.annee === annee &&
          dimanche.semaine === semaine &&
          (lundiPrecedent === undefined || ecartEnJours(lundiPrecedent, lundi) === 7);
        if (!ok) {
          expect.unreachable(`semaine ${String(annee)}-S${String(semaine)} → ${lundi}`);
        }
        lundiPrecedent = lundi;
      }
    }
  });
});

describe('type DateCalendaire', () => {
  it('est une chaîne marquée : lisible comme string, mais une string ne suffit pas', () => {
    expectTypeOf<DateCalendaire>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<DateCalendaire>();
    expectTypeOf<'2027-01-01'>().not.toExtend<DateCalendaire>();
    expectTypeOf(ajouterJours).parameter(0).toEqualTypeOf<DateCalendaire>();
    expectTypeOf(ajouterJours).returns.toEqualTypeOf<DateCalendaire>();
    expectTypeOf(ecartEnJours).returns.toEqualTypeOf<number>();
    expectTypeOf(semaineIso).returns.toEqualTypeOf<SemaineIso>();
    expectTypeOf(lundiDeSemaine).returns.toEqualTypeOf<DateCalendaire>();
  });

  it('refuse un littéral non vérifié à la compilation', () => {
    // @ts-expect-error une chaîne brute n'est pas une DateCalendaire : passer par analyserDate.
    const brute: DateCalendaire = '2027-01-01';
    expect(typeof brute).toBe('string');
  });
});

describe('ré-export depuis la racine du paquet', () => {
  it('packages/core/src/index.ts expose les fonctions de dates', () => {
    expect(racine.ajouterJours).toBe(ajouterJours);
    expect(racine.ecartEnJours).toBe(ecartEnJours);
    expect(racine.semaineIso).toBe(semaineIso);
    expect(racine.formaterSemaineIso).toBe(formaterSemaineIso);
    expect(racine.lundiDeSemaine).toBe(lundiDeSemaine);
    expect(racine.nombreSemainesIso).toBe(nombreSemainesIso);
    expect(racine.estDateValide).toBe(estDateValide);
    expect(racine.analyserDate).toBe(analyserDate);
    expect(racine.jourAbsolu).toBe(jourAbsolu);
    expect(racine.dateDepuisJourAbsolu).toBe(dateDepuisJourAbsolu);
  });
});

describe('bornes du calendrier (années 0001 à 9999)', () => {
  it('ajouterJours refuse de sortir des années 0001 à 9999 (RangeError)', () => {
    expect(() => ajouterJours(d('9999-12-31'), 1)).toThrow(RangeError);
    expect(() => ajouterJours(d('0001-01-01'), -1)).toThrow(RangeError);
    expect(ajouterJours(d('9999-12-30'), 1)).toBe('9999-12-31');
    expect(ajouterJours(d('0001-01-02'), -1)).toBe('0001-01-01');
  });

  it('semaineIso aux deux bornes', () => {
    expect(sem('0001-01-01')).toBe('0001-S01');
    expect(sem('9999-12-31')).toBe('9999-S52');
  });

  it('lundiDeSemaine(1, 1) = 0001-01-01 (un lundi du calendrier grégorien proleptique)', () => {
    expect(lundiDeSemaine(1, 1)).toBe('0001-01-01');
  });
});

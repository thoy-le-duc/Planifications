/**
 * Tests d'acceptation T32j — pérennes : repousse continue au tournant de l'année (relecture T32i).
 *
 * Règle fixée ici :
 * - La rampe de Q41 (J−28 inclus à 0 m, puis montée régulière, pas quotidien ≤ hauteur max / 20,
 *   pleine hauteur au premier jour de récolte) s'applique aussi quand J−28 tombe l'année précédente
 *   (campagne rattachée à l'année de la récolte, récolte au plus tard le 28 janvier).
 * - Aucune chute à 0 m au 1er janvier : une plante en végétation le 31 décembre l'est encore le
 *   1er janvier (campagne rattachée à l'année d'avant, récolte l'année suivante).
 * - Seuil : J−28 égal au débourrement du profil ; la rampe ne vaut que si J−28 le précède
 *   strictement (T32i inchangé), sinon la pousse suit la courbe du profil dès le débourrement.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours } from '../dates/index.ts';
import { chargerCroissance, d, enS, profil, type DateCalendaire, type EntreePerenne, type ModuleCroissance, type ProfilCroissance } from './test/contrat.ts';

let m: ModuleCroissance;
let KIWI: ProfilCroissance;
beforeAll(async () => {
  m = await chargerCroissance();
  KIWI = m.profilParDefaut('Kiwi').profil;
});

/** Fraisier d'hiver de T32f : 0,25 m, débourrement le 1er mars, repos le 30 novembre. */
const FRAISIER = profil({ forme: 'touffe', hauteurMaxM: 0.25, duree: { en: 'jours', jours: 30 }, cycleAnnuel: { debourrement: '03-01', repos: '11-30' } });
const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };
const avec = (annee: number, debut: string, fin: string): EntreePerenne => ({ plantation: PLANTATION, campagne: { annee, debutRecolte: d(debut), finRecolte: d(fin) } });
const jours = (de: string, a: string): DateCalendaire[] => {
  const r: DateCalendaire[] = [];
  for (let j = d(de); j <= d(a); j = ajouterJours(j, 1)) r.push(j);
  return r;
};

/** Rampe de Q41 de `j28` (0 m, débourrement) à `debut` (pleine hauteur), stricte et au pas ≤ hauteur max / 20. */
function rampe(e: EntreePerenne, p: ProfilCroissance, veille: string, j28: string, debut: string): void {
  expect(m.croissancePerenneA(e, p, d(veille)), veille).toEqual({ stade: 'repos', hauteurM: 0, fraction: 0 });
  expect(m.croissancePerenneA(e, p, d(j28)), j28).toEqual({ stade: 'debourrement', hauteurM: 0, fraction: 0 });
  const pas = p.hauteurMaxM / 20;
  let avant = 0;
  for (const jour of jours(ajouterJours(d(j28), 1), debut)) {
    const etat = m.croissancePerenneA(e, p, jour);
    expect(etat.hauteurM, jour).toBeGreaterThan(avant);
    expect(etat.hauteurM - avant, jour).toBeLessThanOrEqual(pas + 1e-12);
    if (jour < d(debut)) expect(etat.stade, jour).toBe('debourrement');
    avant = etat.hauteurM;
  }
  expect(m.croissancePerenneA(e, p, d(debut)), debut).toEqual({ stade: 'pleine_vegetation', hauteurM: p.hauteurMaxM, fraction: 1 });
}

describe('T32j (a) : campagne rattachée à l’année de la récolte, J−28 en décembre de l’année précédente', () => {
  it('fraisier d’hiver récolté dès le 10 janvier 2027 : repos le 12 décembre, rampe du 13 décembre (0 m) au 10 janvier (0,25 m)', () => {
    rampe(avec(2027, '2027-01-10', '2027-03-20'), FRAISIER, '2026-12-12', '2026-12-13', '2027-01-10');
  });

  it('fraisier d’hiver : pleine hauteur tenue pendant la récolte, du 10 janvier au 19 mars', () => {
    const e = avec(2027, '2027-01-10', '2027-03-20');
    for (const jour of jours('2027-01-10', '2027-03-19')) {
      expect(m.croissancePerenneA(e, FRAISIER, jour), jour).toEqual({ stade: 'pleine_vegetation', hauteurM: 0.25, fraction: 1 });
    }
  });

  it('kiwi récolté dès le 28 janvier 2027 (J−28 = 31 décembre) : repos le 30 décembre, rampe du 31 décembre au 28 janvier (2,5 m)', () => {
    expect(ajouterJours(d('2027-01-28'), -28)).toBe('2026-12-31');
    rampe(avec(2027, '2027-01-28', '2027-03-20'), KIWI, '2026-12-30', '2026-12-31', '2027-01-28');
  });

  it('pas de saut au 1er janvier : la hauteur du 1er janvier suit celle du 31 décembre d’un pas de rampe au plus', () => {
    for (const [debut, p] of [
      ['2027-01-10', FRAISIER],
      ['2027-01-20', KIWI],
      ['2027-01-28', KIWI],
    ] as const) {
      const e = avec(2027, debut, '2027-03-20');
      const veille = m.croissancePerenneA(e, p, d('2026-12-31')).hauteurM;
      const lendemain = m.croissancePerenneA(e, p, d('2027-01-01')).hauteurM;
      expect(lendemain, debut).toBeGreaterThan(veille);
      expect(lendemain - veille, debut).toBeLessThanOrEqual(p.hauteurMaxM / 20 + 1e-12);
    }
  });
});

describe('T32j (b) : campagne rattachée à l’année d’avant, récolte l’année suivante', () => {
  it('kiwi rattaché à 2026, récolté du 15 février au 1er avril 2027 : jamais 0 m au 1er janvier s’il était en végétation le 31 décembre', () => {
    const e = avec(2026, '2027-02-15', '2027-04-01');
    const le31 = m.croissancePerenneA(e, KIWI, d('2026-12-31'));
    const le1er = m.croissancePerenneA(e, KIWI, d('2027-01-01'));
    if (le31.hauteurM > 0) {
      expect(le1er.hauteurM).toBeGreaterThan(0);
      expect(le1er.stade).not.toBe('repos');
    }
  });

  it('kiwi rattaché à 2026, récolte de février ou de mars 2027 : aucune chute à 0 m du 31 décembre au 1er janvier', () => {
    for (const [debut, fin] of [
      ['2027-02-01', '2027-03-15'],
      ['2027-02-15', '2027-04-01'],
      ['2027-02-28', '2027-04-15'],
      ['2027-03-20', '2027-05-15'],
    ] as const) {
      const e = avec(2026, debut, fin);
      if (m.croissancePerenneA(e, KIWI, d('2026-12-31')).hauteurM > 0) {
        expect(m.croissancePerenneA(e, KIWI, d('2027-01-01')).hauteurM, debut).toBeGreaterThan(0);
      }
    }
  });

  it('kiwi rattaché à 2026, récolte de février 2027 : pleine hauteur au premier jour de récolte et pendant la récolte', () => {
    const e = avec(2026, '2027-02-15', '2027-04-01');
    for (const jour of jours('2027-02-15', '2027-03-31')) {
      expect(m.croissancePerenneA(e, KIWI, jour), jour).toEqual({ stade: 'pleine_vegetation', hauteurM: KIWI.hauteurMaxM, fraction: 1 });
    }
  });
});

describe('T32j (c) : seuil J−28 = débourrement du profil (kiwi, débourrement le 1er avril)', () => {
  it('récolte le 29 avril (J−28 = 1er avril = débourrement) : pas de rampe, pousse sur la courbe du profil dès le 1er avril', () => {
    expect(KIWI.cycleAnnuel?.debourrement).toBe('04-01');
    expect(KIWI.allure).toBe('en-s');
    expect(KIWI.duree).toEqual({ en: 'jours', jours: 75 });
    const e = avec(2027, '2027-04-29', '2027-06-15');
    expect(ajouterJours(d('2027-04-29'), -28)).toBe('2027-04-01');
    expect(m.croissancePerenneA(e, KIWI, d('2027-03-31'))).toEqual({ stade: 'repos', hauteurM: 0, fraction: 0 });
    expect(m.croissancePerenneA(e, KIWI, d('2027-04-01'))).toEqual({ stade: 'debourrement', hauteurM: 0, fraction: 0 });
    const le29 = m.croissancePerenneA(e, KIWI, d('2027-04-29'));
    expect(le29.stade).toBe('debourrement');
    expect(le29.hauteurM).toBeCloseTo(KIWI.hauteurMaxM * enS(28 / 75), 9);
  });

  it('récolte le 28 avril (J−28 = 31 mars, la veille du débourrement) : rampe de Q41, pleine hauteur le 28 avril', () => {
    rampe(avec(2027, '2027-04-28', '2027-06-15'), KIWI, '2027-03-30', '2027-03-31', '2027-04-28');
  });
});

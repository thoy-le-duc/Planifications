/**
 * Tests d'acceptation T32i (Q41) — une pérenne au repos repousse en douceur pendant les 28 jours
 * qui précèdent son début de récolte (J−28 = début de récolte − JOURS_FORMATION_FRUITS), au lieu
 * de surgir d'un coup en pleine végétation ou de rester à 0 m jusqu'à la récolte.
 *
 * Règle fixée ici :
 * - J−28 INCLUS : débourrement à 0 m (départ de la repousse) ; J−29 et avant : repos, comme aujourd'hui.
 * - Rampe régulière : hauteur strictement croissante chaque jour, pas quotidien au plus hauteur max / 20.
 * - Premier jour de récolte : pleine végétation, à la hauteur maximale ; elle tient pendant la récolte
 *   (plus de chute à 0 m ce jour-là, quelle que soit l'année de rattachement de la campagne).
 * - Hors de ces 28 jours et de la récolte : rien ne change (dates témoins).
 * - Exceptions : plantation pendant les 28 jours (la pousse part du jour de plantation, sur la
 *   courbe du profil) ; asperge et feuillage après récolte (Q33 : turions seuls, aucune rampe).
 * - Fraisier d'hiver de T32f (campagne déjà en cours le 31 décembre) : inchangé.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours } from '../dates/index.ts';
import { campagneEnCours } from './recolte.ts';
import { chargerCroissance, d, enS, profil, type DateCalendaire, type EntreePerenne, type ModuleCroissance, type ProfilCroissance } from './test/contrat.ts';

let m: ModuleCroissance;
let KIWI: ProfilCroissance;
beforeAll(async () => {
  m = await chargerCroissance();
  KIWI = m.profilParDefaut('Kiwi').profil;
});

const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };
/** Kiwi récolté du 20 mars au 15 mai 2027 : la campagne n'est pas « en cours » le 31 décembre 2026 (79 jours). */
const kiwi = (annee: number, plantation: EntreePerenne['plantation'] = PLANTATION): EntreePerenne => ({
  plantation,
  campagne: { annee, debutRecolte: d('2027-03-20'), finRecolte: d('2027-05-15') },
});
const jours = (de: string, a: string): DateCalendaire[] => {
  const r: DateCalendaire[] = [];
  for (let j = d(de); j <= d(a); j = ajouterJours(j, 1)) r.push(j);
  return r;
};

describe('T32i : kiwi récolté dès le 20 mars, repousse sur les 28 jours qui précèdent', () => {
  for (const annee of [2027, 2026]) {
    it(`campagne rattachée à ${String(annee)} : repos le 19 février, débourrement à 0 m le 20 février (J−28 inclus)`, () => {
      expect(campagneEnCours(kiwi(annee).campagne, d('2026-12-31'))).toBe(false);
      expect(m.croissancePerenneA(kiwi(annee), KIWI, d('2027-02-19'))).toEqual({ stade: 'repos', hauteurM: 0, fraction: 0 });
      expect(m.croissancePerenneA(kiwi(annee), KIWI, d('2027-02-20'))).toEqual({ stade: 'debourrement', hauteurM: 0, fraction: 0 });
    });

    it(`campagne rattachée à ${String(annee)} : hauteur strictement croissante chaque jour du 20 février au 20 mars, pas ≤ hauteur max / 20`, () => {
      const pas = KIWI.hauteurMaxM / 20;
      let avant = m.croissancePerenneA(kiwi(annee), KIWI, d('2027-02-20')).hauteurM;
      for (const jour of jours('2027-02-21', '2027-03-20')) {
        const e = m.croissancePerenneA(kiwi(annee), KIWI, jour);
        expect(e.hauteurM, jour).toBeGreaterThan(avant);
        expect(e.hauteurM - avant, jour).toBeLessThanOrEqual(pas + 1e-12);
        if (jour < d('2027-03-20')) expect(e.stade, jour).toBe('debourrement');
        avant = e.hauteurM;
      }
    });

    it(`campagne rattachée à ${String(annee)} : pleine hauteur le 20 mars, tenue pendant toute la récolte (plus de chute à 0 m)`, () => {
      for (const jour of jours('2027-03-20', '2027-05-14')) {
        expect(m.croissancePerenneA(kiwi(annee), KIWI, jour), jour).toEqual({ stade: 'pleine_vegetation', hauteurM: KIWI.hauteurMaxM, fraction: 1 });
      }
    });
  }

  it('hors des 28 jours et de la récolte : comportement inchangé (dates témoins)', () => {
    const repos = { stade: 'repos', hauteurM: 0, fraction: 0 };
    const pleine = { stade: 'pleine_vegetation', hauteurM: KIWI.hauteurMaxM, fraction: 1 };
    const temoins: readonly [number, string, object][] = [
      [2027, '2027-01-15', repos],
      [2027, '2027-02-19', repos],
      [2027, '2027-08-01', pleine],
      [2027, '2027-11-19', pleine],
      [2027, '2027-11-20', repos],
      [2027, '2027-12-31', repos],
      [2026, '2027-01-15', repos],
      [2026, '2027-02-19', repos],
      [2026, '2027-05-15', repos],
      [2026, '2027-08-01', repos],
    ];
    for (const [annee, jour, attendu] of temoins) expect(m.croissancePerenneA(kiwi(annee), KIWI, d(jour)), `${String(annee)} ${jour}`).toEqual(attendu);
  });

  it('plantation pendant les 28 jours : rien avant, puis la pousse part du jour de plantation sur la courbe du profil (pas de rampe)', () => {
    const plantation = { datePlantation: d('2027-03-05'), dateArrachage: null };
    expect(KIWI.allure).toBe('en-s');
    expect(KIWI.duree).toEqual({ en: 'jours', jours: 75 });
    const e = kiwi(2027, plantation);
    expect(m.croissancePerenneA(e, KIWI, d('2027-03-04')).stade).toBe('aucun');
    expect(m.croissancePerenneA(e, KIWI, d('2027-03-05'))).toEqual({ stade: 'debourrement', hauteurM: 0, fraction: 0 });
    const le20 = m.croissancePerenneA(e, KIWI, d('2027-03-20'));
    expect(le20.stade).toBe('debourrement');
    expect(le20.hauteurM).toBeCloseTo(KIWI.hauteurMaxM * enS(15 / 75), 9);
  });
});

describe('T32i : exceptions et non-régressions', () => {
  it('asperge (Q33, fougère après la récolte) : aucune rampe, repos avant la récolte, turions à 0 m pendant', () => {
    const asperge = m.profilParDefaut('Asperge').profil;
    const e: EntreePerenne = { plantation: PLANTATION, campagne: { annee: 2027, debutRecolte: d('2027-03-20'), finRecolte: d('2027-05-31') } };
    for (const jour of ['2027-02-19', '2027-02-20', '2027-03-10', '2027-03-19']) {
      expect(m.croissancePerenneA(e, asperge, d(jour)), jour).toEqual({ stade: 'repos', hauteurM: 0, fraction: 0 });
    }
    for (const jour of ['2027-03-20', '2027-05-15', '2027-05-31', '2027-06-01']) {
      expect(m.croissancePerenneA(e, asperge, d(jour)), jour).toEqual({ stade: 'debourrement', hauteurM: 0, fraction: 0 });
    }
  });

  // Rattachée à 2026, la campagne prolonge la végétation de 2026 (T32a) : déjà 0,25 m début décembre ; rattachée à 2027, repos jusqu'au 12.
  it('fraisier d’hiver de T32f (récolte du 10 janvier au 20 mars 2027) : inchangé, 0,25 m du 13 décembre au 19 mars', () => {
    const FRAISIER = profil({ forme: 'touffe', hauteurMaxM: 0.25, duree: { en: 'jours', jours: 30 }, cycleAnnuel: { debourrement: '03-01', repos: '11-30' } });
    for (const annee of [2027, 2026]) {
      const e: EntreePerenne = { plantation: PLANTATION, campagne: { annee, debutRecolte: d('2027-01-10'), finRecolte: d('2027-03-20') } };
      for (const jour of jours('2026-12-01', '2027-03-19')) {
        const repos = annee === 2027 && jour < d('2026-12-13');
        const attendu = repos ? { stade: 'repos', hauteurM: 0, fraction: 0 } : { stade: 'pleine_vegetation', hauteurM: 0.25, fraction: 1 };
        expect(m.croissancePerenneA(e, FRAISIER, jour), `${String(annee)} ${jour}`).toEqual(attendu);
      }
    }
  });
});

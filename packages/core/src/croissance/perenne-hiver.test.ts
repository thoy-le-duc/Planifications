/**
 * Tests T32f (B1) — pérenne dont la campagne chevauche le 1er janvier : la plante reste en
 * végétation tant qu'une campagne est « en cours » (elle contient le jour ou commence dans les
 * 28 jours), quelle que soit son année de rattachement. Pas de retour à 0 m pendant la formation
 * des fruits ni au début de la récolte.
 *
 * Exemple : fraisier 0,25 m, débourrement le 1er mars, repos le 30 novembre ; campagne rattachée
 * à 2027, récolte du 10 janvier au 20 mars 2027.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours } from '../dates/index.ts';
import { chargerCroissance, d, profil, type DateCalendaire, type EntreePerenne, type ModuleCroissance } from './test/contrat.ts';

let m: ModuleCroissance;
beforeAll(async () => {
  m = await chargerCroissance();
});

const FRAISIER = profil({
  forme: 'touffe',
  hauteurMaxM: 0.25,
  duree: { en: 'jours', jours: 30 },
  cycleAnnuel: { debourrement: '03-01', repos: '11-30' },
});
const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };
const entree = (annee: number): EntreePerenne => ({ plantation: PLANTATION, campagne: { annee, debutRecolte: d('2027-01-10'), finRecolte: d('2027-03-20') } });

describe('T32f B1 : fraisier d’hiver, campagne rattachée à 2027 (10 janvier - 20 mars)', () => {
  for (const annee of [2027, 2026]) {
    const e = entree(annee);
    it(`campagne rattachée à ${String(annee)} : du 14 décembre 2026 au 19 mars 2027 (dernier jour de récolte), hauteur > 0 et jamais « repos »`, () => {
      for (let jour: DateCalendaire = d('2026-12-14'); jour <= d('2027-03-19'); jour = ajouterJours(jour, 1)) {
        const etat = m.croissancePerenneA(e, FRAISIER, jour);
        expect(etat.hauteurM, jour).toBeGreaterThan(0);
        expect(etat.stade, jour).not.toBe('repos');
      }
    });

    it(`campagne rattachée à ${String(annee)} : la hauteur ne retombe pas à 0 le 1er ni le 10 janvier`, () => {
      for (const jour of ['2026-12-31', '2027-01-01', '2027-01-09', '2027-01-10', '2027-01-11']) {
        expect(m.croissancePerenneA(e, FRAISIER, d(jour)).hauteurM, jour).toBeGreaterThan(0);
      }
      expect(m.croissancePerenneA(e, FRAISIER, d('2027-01-01')).hauteurM).toBeGreaterThanOrEqual(m.croissancePerenneA(e, FRAISIER, d('2026-12-31')).hauteurM);
    });
  }
});

describe('T32f B1 : continuité au 31 décembre (bord de la règle)', () => {
  const avec = (debut: string, fin: string): EntreePerenne => ({ plantation: PLANTATION, campagne: { annee: 2027, debutRecolte: d(debut), finRecolte: d(fin) } });
  const stadeA = (e: EntreePerenne, jour: string) => m.croissancePerenneA(e, FRAISIER, d(jour));

  it('début le 27 janvier : en cours le 31 décembre (27 jours) → végétation du 1er janvier au début, 0,25 m', () => {
    const e = avec('2027-01-27', '2027-04-20');
    for (const jour of ['2026-12-31', '2027-01-01', '2027-01-15', '2027-01-26', '2027-01-27']) {
      expect(stadeA(e, jour).hauteurM, jour).toBeGreaterThan(0);
      expect(stadeA(e, jour).stade, jour).not.toBe('repos');
    }
  });

  it('début le 28 janvier : en cours le 31 décembre (28 jours, limite incluse) → végétation', () => {
    expect(stadeA(avec('2027-01-28', '2027-04-20'), '2027-01-01').stade).not.toBe('repos');
  });

  // Q41 (T32i) : J−28 tombe le 4 janvier ; repos jusqu'à J−29, puis repousse régulière jusqu'au début de récolte.
  it('début le 1er février : pas en cours le 31 décembre (32 jours) → repos jusqu’à J−29, puis repousse sur 28 jours', () => {
    const e = avec('2027-02-01', '2027-04-20');
    expect(stadeA(e, '2027-01-01')).toMatchObject({ stade: 'repos', hauteurM: 0 });
    expect(stadeA(e, '2027-01-31').stade).toBe('debourrement');
    expect(stadeA(e, '2027-01-31').hauteurM).toBeGreaterThan(0);
    expect(stadeA(e, '2027-02-01')).toMatchObject({ stade: 'pleine_vegetation', hauteurM: 0.25 });
  });
});

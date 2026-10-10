/**
 * Tests d'acceptation T32a — croissancePerenneA : cycle annuel simple des pérennes (Q32 :
 * débourrement, pleine végétation, repos, sur les dates de la campagne de l'année ; tailles et
 * âge de la plantation hors périmètre). Contrat : ./test/contrat.ts.
 *
 * Exemple : kiwi planté le 1er mars 2020, profil de test 2,5 m, 60 jours, linéaire, débourrement
 * le 1er avril, repos le 15 novembre ; campagne 2027 récoltée du 15 octobre au 5 novembre.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ajouterJours, ecartEnJours } from '../dates/index.ts';
import {
  chargerCroissance,
  d,
  enS,
  profil,
  type DateCalendaire,
  type EntreePerenne,
  type EtatCroissance,
  type ModuleCroissance,
  type ProfilCroissance,
  type StadeCroissance,
} from './test/contrat.ts';

let m: ModuleCroissance;

beforeAll(async () => {
  m = await chargerCroissance();
});

const KIWI = profil({
  forme: 'arbre-ou-liane',
  hauteurMaxM: 2.5,
  duree: { en: 'jours', jours: 60 },
  cycleAnnuel: { debourrement: '04-01', repos: '11-15' },
});

const PLANTATION = { datePlantation: d('2020-03-01'), dateArrachage: null };

const campagne = (annee: number, debut: string | null = `${String(annee)}-10-15`, fin: string | null = `${String(annee)}-11-05`): EntreePerenne['campagne'] => ({
  annee,
  debutRecolte: debut === null ? null : d(debut),
  finRecolte: fin === null ? null : d(fin),
});

function etat(jour: string, entree: Partial<EntreePerenne> = {}, p: ProfilCroissance = KIWI): EtatCroissance {
  const annee = Number(jour.slice(0, 4));
  const e: EntreePerenne = { plantation: PLANTATION, campagne: campagne(annee), ...entree };
  return m.croissancePerenneA(e, p, d(jour));
}

function attendu(e: EtatCroissance, stade: StadeCroissance, hauteurM: number, p: ProfilCroissance = KIWI): void {
  expect(e.stade).toBe(stade);
  expect(e.hauteurM).toBeCloseTo(hauteurM, 9);
  expect(e.fraction).toBeCloseTo(hauteurM / p.hauteurMaxM, 9);
}

describe('T32a : pérenne, une année de campagne', () => {
  it('avant le débourrement : repos, pas de feuillage', () => {
    attendu(etat('2027-01-15'), 'repos', 0);
    attendu(etat('2027-03-31'), 'repos', 0);
  });

  it('débourrement le 1er avril, à 0 ; croissance jusqu’à la hauteur maximale 60 jours plus tard', () => {
    attendu(etat('2027-04-01'), 'debourrement', 0);
    attendu(etat('2027-05-01'), 'debourrement', 1.25);
    attendu(etat('2027-05-30'), 'debourrement', (2.5 * 59) / 60);
    attendu(etat('2027-05-31'), 'pleine_vegetation', 2.5);
  });

  it('pleine végétation tenue pendant la récolte, jusqu’à la veille du repos', () => {
    attendu(etat('2027-08-15'), 'pleine_vegetation', 2.5);
    attendu(etat('2027-10-20'), 'pleine_vegetation', 2.5);
    attendu(etat('2027-11-14'), 'pleine_vegetation', 2.5);
  });

  it('repos à partir du 15 novembre : plus de feuillage', () => {
    attendu(etat('2027-11-15'), 'repos', 0);
    attendu(etat('2027-12-31'), 'repos', 0);
  });

  it('courbe en S sur la repousse', () => {
    const s = { ...KIWI, allure: 'en-s' as const };
    attendu(etat('2027-05-01', {}, s), 'debourrement', 2.5 * enS(0.5), s);
    attendu(etat('2027-04-16', {}, s), 'debourrement', 2.5 * enS(15 / 60), s);
  });
});

describe('T32a : pérenne, repousse chaque année sur la campagne', () => {
  it('chaque année avec sa campagne : repart de 0 au débourrement, même hauteur aux mêmes jours', () => {
    for (const annee of [2021, 2024, 2027, 2028, 2031]) {
      const a = String(annee);
      attendu(etat(`${a}-03-31`), 'repos', 0);
      attendu(etat(`${a}-04-01`), 'debourrement', 0);
      attendu(etat(`${a}-05-01`), 'debourrement', 1.25);
      attendu(etat(`${a}-07-01`), 'pleine_vegetation', 2.5);
      attendu(etat(`${a}-11-15`), 'repos', 0);
    }
  });

  it('année bissextile (2028) : dates du cycle calées sur le calendrier de l’année', () => {
    attendu(etat('2028-02-29'), 'repos', 0);
    attendu(etat('2028-04-01'), 'debourrement', 0);
    attendu(etat('2028-05-31'), 'pleine_vegetation', 2.5);
  });

  it('hors campagne (aucune campagne cette année) : pas de feuillage, toute l’année', () => {
    for (const jour of ['2027-01-15', '2027-04-01', '2027-06-15', '2027-10-20', '2027-12-31']) {
      attendu(etat(jour, { campagne: null }), 'repos', 0);
    }
  });

  it('campagne d’une autre année que celle du jour : hors campagne', () => {
    attendu(etat('2028-06-15', { campagne: campagne(2027) }), 'repos', 0);
    attendu(etat('2026-06-15', { campagne: campagne(2027) }), 'repos', 0);
  });

  it('campagne sans dates de récolte : la fenêtre du profil suffit', () => {
    attendu(etat('2027-05-01', { campagne: campagne(2027, null, null) }), 'debourrement', 1.25);
    attendu(etat('2027-11-15', { campagne: campagne(2027, null, null) }), 'repos', 0);
  });
});

describe('T32a : pérenne, la récolte de la campagne élargit la fenêtre de végétation', () => {
  it('fin de récolte après le repos du profil : feuillage jusqu’au dernier jour de récolte compris', () => {
    const c = campagne(2027, '2027-10-15', '2027-11-30');
    attendu(etat('2027-11-20', { campagne: c }), 'pleine_vegetation', 2.5);
    attendu(etat('2027-11-30', { campagne: c }), 'pleine_vegetation', 2.5);
    attendu(etat('2027-12-01', { campagne: c }), 'repos', 0);
  });

  // Q41 (T32i) : la plante au repos repousse sur les 28 jours qui précèdent la récolte, pleine hauteur au premier jour de récolte.
  it('début de récolte avant le débourrement du profil : repousse dès J−28, pleine hauteur au début de récolte', () => {
    const c = campagne(2027, '2027-03-20', '2027-05-15');
    attendu(etat('2027-03-19', { campagne: c }), 'debourrement', (2.5 * 27) / 28);
    attendu(etat('2027-03-20', { campagne: c }), 'pleine_vegetation', 2.5);
    attendu(etat('2027-04-19', { campagne: c }), 'pleine_vegetation', 2.5);
  });
});

describe('T32a : pérenne, plantation et arrachage', () => {
  it('avant la plantation : rien ; l’année de plantation, la végétation part du jour de plantation', () => {
    const plantation = { datePlantation: d('2027-05-01'), dateArrachage: null };
    attendu(etat('2027-04-15', { plantation }), 'aucun', 0);
    attendu(etat('2026-07-01', { plantation, campagne: campagne(2026) }), 'aucun', 0);
    attendu(etat('2027-05-01', { plantation }), 'debourrement', 0);
    attendu(etat('2027-05-31', { plantation }), 'debourrement', 1.25);
    attendu(etat('2027-06-30', { plantation }), 'pleine_vegetation', 2.5);
  });

  it('à partir du jour de l’arrachage : rien, même en pleine saison', () => {
    const plantation = { datePlantation: d('2020-03-01'), dateArrachage: d('2027-09-01') };
    attendu(etat('2027-08-31', { plantation }), 'pleine_vegetation', 2.5);
    attendu(etat('2027-09-01', { plantation }), 'aucun', 0);
    attendu(etat('2028-06-01', { plantation }), 'aucun', 0);
  });
});

describe('T32a : pérenne sans cycle annuel (dates manquantes) : repli « touffe haute fixe »', () => {
  const SANS_CYCLE = profil({ forme: 'touffe', hauteurMaxM: 0.8, cycleAnnuel: null });

  it('pleine végétation à la hauteur maximale toute l’année, avec ou sans campagne', () => {
    for (const jour of ['2027-01-15', '2027-04-01', '2027-07-01', '2027-12-31']) {
      attendu(etat(jour, {}, SANS_CYCLE), 'pleine_vegetation', 0.8, SANS_CYCLE);
      attendu(etat(jour, { campagne: null }, SANS_CYCLE), 'pleine_vegetation', 0.8, SANS_CYCLE);
    }
  });

  it('rien avant la plantation ni après l’arrachage', () => {
    const plantation = { datePlantation: d('2027-05-01'), dateArrachage: d('2027-09-01') };
    attendu(etat('2027-04-30', { plantation }, SANS_CYCLE), 'aucun', 0, SANS_CYCLE);
    attendu(etat('2027-09-01', { plantation }, SANS_CYCLE), 'aucun', 0, SANS_CYCLE);
  });
});

describe('T32a : pérenne, durée en fraction de la fenêtre de végétation', () => {
  it('0,25 de la fenêtre du 1er avril au 15 novembre (228 jours) = 57 jours', () => {
    expect(ecartEnJours(d('2027-04-01'), d('2027-11-15'))).toBe(228);
    const enFraction = { ...KIWI, duree: { en: 'fraction_cycle' as const, fraction: 0.25 } };
    const enJours = { ...KIWI, duree: { en: 'jours' as const, jours: 57 } };
    for (let n = -2; n <= 230; n++) {
      const jour = ajouterJours(d('2027-04-01'), n);
      const a = etat(jour, {}, enJours);
      const b = etat(jour, {}, enFraction);
      expect(b.stade, jour).toBe(a.stade);
      expect(b.hauteurM, jour).toBeCloseTo(a.hauteurM, 9);
    }
  });
});

describe('T32a : pérennes de la bibliothèque', () => {
  it.each(['Asperge', 'Kiwi', 'Pivoine', 'Fraisier'])('%s : feuillage à la hauteur du profil en saison, aucun en hiver', (nom) => {
    const p = m.profilParDefaut(nom).profil;
    expect(p.cycleAnnuel, `${nom} : cycle annuel`).not.toBeNull();
    let max = 0;
    let jour: DateCalendaire = d('2027-01-01');
    for (let n = 0; n < 365; n++, jour = ajouterJours(jour, 1)) {
      const e = m.croissancePerenneA({ plantation: PLANTATION, campagne: campagne(2027, null, null) }, p, jour);
      expect(e.hauteurM).toBeGreaterThanOrEqual(0);
      expect(e.hauteurM).toBeLessThanOrEqual(p.hauteurMaxM);
      max = Math.max(max, e.hauteurM);
    }
    expect(max).toBeCloseTo(p.hauteurMaxM, 9);
    const hiver = m.croissancePerenneA({ plantation: PLANTATION, campagne: campagne(2027, null, null) }, p, d('2027-01-15'));
    expect(hiver).toEqual({ stade: 'repos', hauteurM: 0, fraction: 0 });
  });

  // Q33 : la fougère ne monte qu'après la fin de récolte (15 juin par défaut) ; elle est à 1,5 m en automne (cf. q33.test.ts).
  it('asperge : 1,5 m en fougère à l’automne, une fois montée', () => {
    const p = m.profilParDefaut('Asperge').profil;
    expect(p.hauteurMaxM).toBe(1.5);
    const e = m.croissancePerenneA({ plantation: PLANTATION, campagne: campagne(2027, null, null) }, p, d('2027-10-15'));
    expect(e).toEqual({ stade: 'pleine_vegetation', hauteurM: 1.5, fraction: 1 });
  });

  it('propriété : hauteur monotone croissante du débourrement à la pleine végétation, bornée, chaque année', () => {
    for (const nom of ['Asperge', 'Kiwi', 'Pivoine', 'Fraisier']) {
      const p = m.profilParDefaut(nom).profil;
      for (const annee of [2027, 2028]) {
        let avant = -1;
        let pleine = false;
        let jour = d(`${String(annee)}-01-01`);
        for (let n = 0; n < 366 && jour.startsWith(String(annee)); n++, jour = ajouterJours(jour, 1)) {
          const e = m.croissancePerenneA({ plantation: PLANTATION, campagne: campagne(annee, null, null) }, p, jour);
          if (e.stade === 'repos') {
            if (pleine) break;
            continue;
          }
          expect(['debourrement', 'pleine_vegetation'], `${nom} ${jour}`).toContain(e.stade);
          expect(e.hauteurM + 1e-12, `${nom} ${jour}`).toBeGreaterThanOrEqual(avant);
          if (e.stade === 'pleine_vegetation') {
            pleine = true;
            expect(e.hauteurM, `${nom} ${jour}`).toBeCloseTo(p.hauteurMaxM, 9);
          }
          avant = e.hauteurM;
        }
      }
    }
  });
});

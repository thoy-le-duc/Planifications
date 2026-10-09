/**
 * T32b — ce que la 3D lit en plus du plan (donnees-plants.ts), sans base : lignes locales →
 * cultures par occupation, écartement de l'itinéraire, emplacements hors-sol (zone `hors_sol` ou
 * sous elle, ou gouttière). Lecture seule.
 */
import type { DateCalendaire } from '@planif/core';
import { describe, expect, it } from 'vitest';
import { construireCultures, cultureAu, ecartementDe, ECARTEMENT_PAR_DEFAUT_M, type LignesPlants } from './donnees-plants.ts';
import { plantsDePlanche } from './plants.ts';

const d = (s: string): DateCalendaire => s as DateCalendaire;
const VIDE: LignesPlants = { occupations: [], campagnes: [], zones: [], emplacements: [] };

describe('T32b : écartement lu des paramètres de la série', () => {
  it('à l’écartement : centimètres → mètres ; au mètre linéaire : l’inverse des graines par mètre', () => {
    expect(ecartementDe(JSON.stringify({ densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 45 } }))).toBeCloseTo(0.45, 9);
    expect(ecartementDe(JSON.stringify({ densite: { facon: 'metre_lineaire', rangsParPlanche: 2, grainesParMetre: 20 } }))).toBeCloseTo(0.05, 9);
  });

  it('illisible, absent, à la volée ou aberrant : écartement par défaut, ou borné', () => {
    for (const v of [null, undefined, '', '{pas du json', '[]', 42, JSON.stringify({ densite: { facon: 'volee', largeurSemeeCm: 80, doseGParM2: 5 } }), JSON.stringify({})]) {
      expect(ecartementDe(v), String(v)).toBe(ECARTEMENT_PAR_DEFAUT_M);
    }
    expect(ecartementDe(JSON.stringify({ densite: { facon: 'ecartement', ecartementSurRangCm: 100_000 } }))).toBeLessThanOrEqual(6);
    expect(ecartementDe(JSON.stringify({ densite: { facon: 'ecartement', ecartementSurRangCm: 0 } }))).toBeGreaterThan(0);
    expect(ecartementDe(JSON.stringify({ densite: { facon: 'metre_lineaire', grainesParMetre: 0 } }))).toBe(ECARTEMENT_PAR_DEFAUT_M);
  });
});

describe('T32b : cultures par occupation', () => {
  const tomate = { id: 'o1', plantation_id: null, prevu_du: '2027-05-01', prevu_au: '2027-10-15', reel_du: null, reel_au: null, s_parametres: JSON.stringify({ densite: { facon: 'ecartement', ecartementSurRangCm: 50 } }), s_mise_en_place: '2027-05-03', s_debut_recolte: '2027-07-01', s_fin_recolte: '2027-09-15', e_nom: 'Tomate', e_profil: null };

  it('série : dates de croissance, écartement, profil par défaut de l’espèce ; la date réelle remplace la prévue', () => {
    const { parOccupation } = construireCultures({ ...VIDE, occupations: [{ ...tomate, reel_du: '2027-05-05', reel_au: '2027-10-01' }] });
    const c = parOccupation.get('o1');
    expect(c?.profil.hauteurMaxM).toBe(3);
    expect(c?.ecartementM).toBeCloseTo(0.5, 9);
    const culture = c === undefined ? null : cultureAu(c, d('2027-08-02'));
    expect(culture?.croissance.sorte).toBe('annuelle');
    if (culture?.croissance.sorte === 'annuelle') {
      expect(culture.croissance.dates.miseEnPlace).toEqual({ prevue: '2027-05-03', reelle: '2027-05-05' });
      expect(culture.croissance.dates.arrachage).toEqual({ prevue: '2027-10-15', reelle: '2027-10-01' });
    }
  });

  it('profil réglé par la ferme : il remplace le défaut ; illisible : le défaut', () => {
    const regle = JSON.stringify({ forme: 'buisson', hauteurMaxM: 1.2, duree: { en: 'jours', jours: 40 }, allure: 'lineaire', finDeCycle: 'conservee', cycleAnnuel: null });
    const lues = construireCultures({ ...VIDE, occupations: [{ ...tomate, id: 'a', e_profil: regle }, { ...tomate, id: 'b', e_profil: '{corrompu' }] }).parOccupation;
    expect(lues.get('a')?.profil.hauteurMaxM).toBe(1.2);
    expect(lues.get('b')?.profil.hauteurMaxM).toBe(3);
  });

  it('une occupation sans espèce (couverture, ligne orpheline) ou une plantation sans date : ignorée', () => {
    const lues = construireCultures({ ...VIDE, occupations: [{ ...tomate, id: 'x', e_nom: null }, { ...tomate, id: 'y', plantation_id: 'p', p_plantation: null }] }).parOccupation;
    expect(lues.size).toBe(0);
  });

  it('pérenne : campagne de l’année du jour ; sans campagne, le cycle annuel du profil (feuillage en saison)', () => {
    const kiwi = { id: 'k', plantation_id: 'p1', prevu_du: '2020-03-01', prevu_au: '2040-01-01', reel_du: null, reel_au: null, p_plantation: '2020-03-01', p_arrachage: null, e_nom: 'Kiwi', e_profil: null };
    const { parOccupation } = construireCultures({ ...VIDE, occupations: [kiwi], campagnes: [{ plantation_id: 'p1', annee: 2027, debut_recolte_prevu: '2027-10-15', fin_recolte_prevue: '2027-11-10' }] });
    const c = parOccupation.get('k');
    if (c === undefined) throw new Error('culture absente');
    const volume = { id: 'v', x: 0, z: 0, longueur: 20, largeur: 2, angle: 0, couleur: '#000' };
    const ete = plantsDePlanche({ volume, culture: cultureAu(c, d('2027-08-02')), jour: d('2027-08-02'), horsSol: false });
    expect(ete?.hauteurM).toBeCloseTo(2.5, 9);
    // 2028 : aucune campagne enregistrée, le feuillage suit pourtant le cycle annuel ; l’hiver, la structure seule.
    expect(plantsDePlanche({ volume, culture: cultureAu(c, d('2028-08-07')), jour: d('2028-08-07'), horsSol: false })?.hauteurM).toBeCloseTo(2.5, 9);
    const hiver = plantsDePlanche({ volume, culture: cultureAu(c, d('2028-01-17')), jour: d('2028-01-17'), horsSol: false });
    expect(hiver?.hauteurM).toBe(0);
    expect(hiver?.structureM).toBeGreaterThan(0);
  });
});

describe('T32b : hors-sol', () => {
  it('gouttière, zone hors-sol et ses sous-zones : hors-sol ; le reste : non', () => {
    const { horsSol } = construireCultures({
      ...VIDE,
      zones: [
        { id: 'hs', zone_parente_id: null, type_abri: 'hors_sol' },
        { id: 'hs-chapelle', zone_parente_id: 'hs', type_abri: null },
        { id: 'sol', zone_parente_id: null, type_abri: 'serre' },
        { id: 'boucle-a', zone_parente_id: 'boucle-b', type_abri: null },
        { id: 'boucle-b', zone_parente_id: 'boucle-a', type_abri: null },
      ],
      emplacements: [
        { id: 'e1', zone_id: 'hs', sorte: 'planche' },
        { id: 'e2', zone_id: 'hs-chapelle', sorte: 'rang' },
        { id: 'e3', zone_id: 'sol', sorte: 'gouttiere' },
        { id: 'e4', zone_id: 'sol', sorte: 'planche' },
        { id: 'e5', zone_id: 'boucle-a', sorte: 'planche' },
        { id: 'e6', zone_id: 'inconnue', sorte: 'planche' },
      ],
    });
    expect([...horsSol].sort()).toEqual(['e1', 'e2', 'e3']);
  });
});

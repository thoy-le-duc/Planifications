/**
 * Garde du jeu de test de T24 (./test/ferme-itineraires.ts) : ses lignes passent les règles du
 * serveur (validerItineraire avec la liste des types, validerTypeIntervention, validerSerie,
 * validerOccupation), et ses attendus (série d'exemple de l'aperçu, séries à venir) sont bien
 * ceux que le cœur donne. Ces tests passent sans le code de T24 : s'ils échouent, c'est le jeu
 * qui est faux, pas l'écran.
 */
import { describe, expect, it } from 'vitest';
import { ajouterJours, datesTravailPrevu, lundiDeSemaine, TYPES_INTERVENTION_PAR_DEFAUT, type DateCalendaire, type TravailPrevu } from '@planif/core';
import { AUJOURDHUI_TESTS, datesDe, fermeItineraires, ITINERAIRE, PARAMETRES, SERIE, seriesDuJeu, TYPE, TYPES_DEPART } from './test/ferme-itineraires.ts';
import { creerBanc, itineraire, itineraireValide, occupationsValides, typeIntervention, typeValide } from './test/outils.ts';

describe('T24 : la ferme des itinéraires est cohérente avec le cœur', () => {
  it('itinéraires de la ferme acceptés par validerItineraire (avec la liste des types) ; types acceptés par validerTypeIntervention', async () => {
    const b = await creerBanc();
    try {
      for (const cle of ['bataviaFerme', 'chouAutomne', 'ancien'] as const) itineraireValide(b, itineraire(b, ITINERAIRE[cle]));
      for (const id of Object.values(TYPE)) typeValide(typeIntervention(b, id));
    } finally {
      b.base.fermer();
    }
  });

  it('séries et occupations acceptées par validerSerie et validerOccupation (dates de la série comprises)', async () => {
    const b = await creerBanc();
    try {
      for (const id of Object.values(SERIE)) occupationsValides(b, id);
    } finally {
      b.base.fermer();
    }
  });

  it('liste de départ : une ligne par libellé de TYPES_INTERVENTION_PAR_DEFAUT, ids distincts', () => {
    const attendus = Object.values(TYPES_INTERVENTION_PAR_DEFAUT).reduce((n, l) => n + l.length, 0);
    expect(TYPES_DEPART).toHaveLength(attendus);
    expect(new Set(TYPES_DEPART.map((t) => t.id)).size).toBe(attendus);
  });

  it('séries à venir de « Batavia de la ferme » au 2026-09-30 : aVenir1 et aVenir2 seulement (première date ≥ aujourd’hui)', () => {
    const jeu = seriesDuJeu(AUJOURDHUI_TESTS);
    const premiere = (cle: keyof typeof SERIE) => {
      const d = datesDe(PARAMETRES[jeu[cle].itineraire], jeu[cle].ancre);
      return d.semisPepiniere ?? d.miseEnPlace;
    };
    expect(premiere('aVenir1') >= AUJOURDHUI_TESTS).toBe(true);
    expect(premiere('aVenir2') >= AUJOURDHUI_TESTS).toBe(true);
    expect(premiere('commencee') >= AUJOURDHUI_TESTS, 'commencée : exclue par son semis réalisé, pas par la date').toBe(true);
    expect(premiere('enRetard') < AUJOURDHUI_TESTS, 'semis prévu déjà passé').toBe(true);
    expect(premiere('passee') < AUJOURDHUI_TESTS).toBe(true);
  });

  it('aperçu : série d’exemple de la Batavia (S18) au 2027-05-03 ; grelinette −10 → 04-23 ; désherbage +14 tous les 14 j → 05-17, 05-31 (T22)', () => {
    expect(lundiDeSemaine(2027, 18)).toBe('2027-05-03');
    const dates = datesDe(PARAMETRES.batavia, { type: 'plantation', date: '2027-05-03' as DateCalendaire });
    expect(dates).toEqual({ semisPepiniere: '2027-04-12', miseEnPlace: '2027-05-03', debutRecolte: '2027-05-31', finRecolte: '2027-06-14' });
    const t = (x: Partial<TravailPrevu> & Pick<TravailPrevu, 'categorie' | 'type' | 'repere' | 'decalageJours'>): TravailPrevu => ({
      repetition: null,
      outil: null,
      produit: null,
      tempsEstime: null,
      ...x,
    });
    expect(datesTravailPrevu(t({ categorie: 'travail_sol', type: 'grelinette', repere: 'mise_en_place', decalageJours: -10 }), dates)).toEqual(['2027-04-23']);
    expect(
      datesTravailPrevu(t({ categorie: 'entretien', type: 'désherbage', repere: 'mise_en_place', decalageJours: 14, repetition: { tousLesJours: 14, repereFin: 'debut_recolte' } }), dates),
    ).toEqual(['2027-05-17', '2027-05-31']);
    expect(
      datesTravailPrevu(t({ categorie: 'entretien', type: 'désherbage', repere: 'mise_en_place', decalageJours: 60, repetition: { tousLesJours: 7, repereFin: 'debut_recolte' } }), dates),
      'ne tombe jamais',
    ).toEqual([]);
    expect(ajouterJours('2027-05-03' as DateCalendaire, 28)).toBe('2027-05-31');
  });

  it('le jeu se construit à toute date (e2e : jour du navigateur)', () => {
    for (const jour of ['2026-01-02', '2026-12-30', '2027-06-15']) {
      const f = fermeItineraires(jour);
      expect(f.total).toBe(fermeItineraires(AUJOURDHUI_TESTS).total);
    }
  });
});

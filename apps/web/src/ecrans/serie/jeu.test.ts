/**
 * Garde du jeu de test de T12 (./test/ferme-serie.ts) : ses attendus chiffrés sont bien ceux que
 * le cœur calcule (T02, T03, T04, T05), et ses lignes passent les règles du serveur (T10e). Ces
 * tests passent sans le code de T12 : s'ils échouent, c'est le jeu qui est faux, pas l'écran.
 */
import { describe, expect, it } from 'vitest';
import {
  alertesRotation,
  besoinsSerie,
  calculerDatesSerie,
  detecterConflits,
  lundiDeSemaine,
  type Assolement,
  type DateCalendaire,
  type Emplacement,
  type HierarchieParcellaire,
  type HistoriqueRotation,
  type Id,
  type ItineraireBesoins,
  type Occupation,
  type ParametresDatesSerie,
} from '@planif/core';
import { ATTENDU, EMPLACEMENT, ESPECE, FAMILLE, FERME, OCCUPATION_LAITUE, PARAMETRES, SAISON, SERIE_LAITUE, ZONE } from './test/ferme-serie.ts';
import { creerBanc, occupationsValides } from './test/outils.ts';

const dates = (p: Readonly<Record<string, unknown>>, type: 'plantation' | 'debut_recolte', date: string) =>
  calculerDatesSerie(p as unknown as ParametresDatesSerie, { type, date: date as DateCalendaire });

describe('T12 : la ferme du plan est cohérente avec le cœur', () => {
  it('SERIE_LAITUE et son occupation passent validerSerie et validerOccupation (dates de la série comprises)', async () => {
    const b = await creerBanc();
    try {
      occupationsValides(b, SERIE_LAITUE);
    } finally {
      b.base.fermer();
    }
  });

  it('T02 : batavia de printemps, plantation en S14 (ligne 1), récolte à partir de S22 (ligne 2)', () => {
    expect(dates(PARAMETRES.bataviaPrintemps, 'plantation', lundiDeSemaine(2027, 14))).toEqual(ATTENDU.bataviaPlantationS14);
    expect(dates(PARAMETRES.bataviaPrintemps, 'debut_recolte', lundiDeSemaine(2027, 22))).toEqual(ATTENDU.bataviaRecolteS22);
  });

  it('T05 : batavia de printemps sur 30 m', () => {
    const entree: ItineraireBesoins = {
      mode: 'plant_maison',
      densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
      grainesParMotte: 1,
      plantsParMotte: 1,
      germination: 90,
      pertePepiniere: 5,
      alveolesParPlaque: 104,
      margeSecurite: 10,
      pmgMg: null,
    };
    expect(besoinsSerie(entree, 3000)).toEqual({ mode: 'plant_maison', ...ATTENDU.besoinsBatavia30m });
  });

  it('T04 : choux sur C3-P02 rouge en 2026, orange en 2027, rien en 2029 ; sur C2-P01 rien', () => {
    const planche = (id: string, zone: string) => ({ id: id as Id<'Emplacement'>, zoneId: zone as Id<'Zone'>, remplace: [] });
    const hierarchie: HierarchieParcellaire = {
      zones: [
        { id: ZONE.serre as Id<'Zone'>, zoneParenteId: null },
        { id: ZONE.c2 as Id<'Zone'>, zoneParenteId: ZONE.serre as Id<'Zone'> },
        { id: ZONE.c3 as Id<'Zone'>, zoneParenteId: ZONE.serre as Id<'Zone'> },
        { id: ZONE.tunnel2 as Id<'Zone'>, zoneParenteId: null },
      ],
      emplacements: [planche(EMPLACEMENT.c2p01, ZONE.c2), planche(EMPLACEMENT.c3p02, ZONE.c3)],
    };
    const assolement: Assolement = {
      id: '0192f0c1-1212-7000-8000-000000000074' as Id<'Assolement'>,
      fermeId: FERME as Id<'Ferme'>,
      supprimeLe: null,
      saisonId: SAISON.s2023 as Id<'Saison'>,
      cible: { sorte: 'zone', zoneId: ZONE.c3 as Id<'Zone'> },
      familleId: FAMILLE.brassicacees as Id<'Famille'>,
      especeId: null,
      nature: 'passe_saisi',
    };
    const historique: HistoriqueRotation = {
      occupations: [],
      assolements: [assolement],
      saisons: [{ id: SAISON.s2023 as Id<'Saison'>, fin: '2023-12-31' as DateCalendaire }],
    };
    const chou = {
      espece: { id: ESPECE.chou as Id<'Espece'>, familleId: FAMILLE.brassicacees as Id<'Famille'>, delaisRetour: { minimalAns: 4, conseilleAns: 6 } },
      famille: { id: FAMILLE.brassicacees as Id<'Famille'>, delaiRetourMinimalAns: 4, delaiRetourConseilleAns: 6 },
    };
    const niveau = (emplacement: string, zone: string, annee: number) =>
      alertesRotation(chou, planche(emplacement, zone), annee, historique, hierarchie).map((a) => a.niveau);
    expect(niveau(EMPLACEMENT.c3p02, ZONE.c3, 2026)).toEqual(['rouge']);
    expect(niveau(EMPLACEMENT.c3p02, ZONE.c3, 2027)).toEqual(['orange']);
    expect(niveau(EMPLACEMENT.c3p02, ZONE.c3, 2029)).toEqual([]);
    expect(niveau(EMPLACEMENT.c2p01, ZONE.c2, 2026)).toEqual([]);
  });

  it('T03 : une batavia de 30 m sur T2-P02 aux dates de SERIE_LAITUE est en surcharge', () => {
    const t2p02: Emplacement = {
      id: EMPLACEMENT.t2p02 as Id<'Emplacement'>,
      fermeId: FERME as Id<'Ferme'>,
      supprimeLe: null,
      zoneId: ZONE.tunnel2 as Id<'Zone'>,
      code: 'T2-P02',
      sorte: 'planche',
      longueurM: 30,
      largeurM: 0.8,
      actifDu: '2020-01-01' as DateCalendaire,
      actifAu: null,
      remplace: [],
      placementXM: null,
      placementYM: null,
      orientationDeg: null,
    };
    const d = ATTENDU.bataviaPlantationS14;
    const occupation = (id: string, serie: string): Occupation => ({
      id: id as Id<'Occupation'>,
      fermeId: FERME as Id<'Ferme'>,
      supprimeLe: null,
      emplacementId: t2p02.id,
      occupant: { sorte: 'serie', serieId: serie as Id<'Serie'> },
      place: { unite: 'longueur', longueurM: 30 },
      positionM: null,
      prevuDu: d.miseEnPlace as DateCalendaire,
      prevuAu: d.finRecolte as DateCalendaire,
      reel: null,
    });
    const proposee = occupation('0192f0c1-1212-7000-8000-0000000000ff', '0192f0c1-1212-7000-8000-0000000000fe');
    const conflits = detecterConflits(t2p02, [occupation(OCCUPATION_LAITUE, SERIE_LAITUE), proposee]);
    expect(conflits.map((c) => c.sorte)).toEqual(['surcharge']);
  });
});

/**
 * Tests d'acceptation T02 — dates d'une série, planification à rebours et décalage.
 *
 * API attendue, exportée par `packages/core/src/planification/dates-serie.ts` :
 *
 *   type EtapeSerie = 'semisPepiniere' | 'miseEnPlace' | 'debutRecolte' | 'finRecolte'
 *     Ordre chronologique des étapes : semisPepiniere → miseEnPlace → debutRecolte → finRecolte.
 *
 *   type ParametresDatesSerie =
 *     | { readonly mode: 'semis_direct'; readonly dureeAvantRecolteJours: Jours; readonly fenetreRecolteJours: Jours }
 *     | { readonly mode: 'plant_maison'; readonly dureePepiniereJours: Jours;
 *         readonly dureeAvantRecolteJours: Jours; readonly fenetreRecolteJours: Jours }
 *     | { readonly mode: 'plant_achete'; readonly dureeAvantRecolteJours: Jours; readonly fenetreRecolteJours: Jours }
 *     Sous-ensemble de `ParametresItineraire` (T01) : l'instantané complet d'une série s'y assigne
 *     tel quel, et les tests peuvent ne passer que les durées.
 *
 *   interface DatesSerie {
 *     readonly semisPepiniere?: DateCalendaire;   // présente en plant maison seulement, sinon clé ABSENTE
 *     readonly miseEnPlace: DateCalendaire;       // semis direct ou plantation
 *     readonly debutRecolte: DateCalendaire;
 *     readonly finRecolte: DateCalendaire;
 *   }
 *     Étape sans objet = clé absente (ni `null`, ni `undefined`). NB : le type `DatesPrevuesSerie`
 *     de T01 (champ `Serie.datesPrevues`) porte encore `semisPepiniere: DateCalendaire | null` ;
 *     l'alignement éventuel se décide hors de ce module.
 *
 *   type RealisesSerie = Readonly<Partial<Record<EtapeSerie, DateCalendaire>>>
 *     Dates réelles saisies, étape par étape.
 *
 *   calculerDatesSerie(parametres: ParametresDatesSerie, ancre: AncreSerie): DatesSerie   (pure)
 *     Règles :
 *       miseEnPlace    = date de semis direct ou de plantation
 *       semisPepiniere = miseEnPlace − dureePepiniereJours      (plant maison uniquement)
 *       debutRecolte   = miseEnPlace + dureeAvantRecolteJours
 *       finRecolte     = debutRecolte + fenetreRecolteJours
 *     Sens de l'ancre (`AncreSerie` de T01) :
 *       'semis'         → semis pépinière en plant maison, semis direct (= miseEnPlace) en semis direct ;
 *                         RangeError en plant acheté (il n'y a pas de semis à la ferme).
 *       'plantation'    → miseEnPlace, quel que soit le mode.
 *       'debut_recolte' → debutRecolte ; les autres dates se déduisent à rebours.
 *     RangeError si une durée est négative ou non entière. Une durée nulle est permise.
 *
 *   appliquerRealises(datesPrevues: DatesSerie, realises: RealisesSerie): DatesSerie    (pure)
 *     Règles :
 *       - chaque étape réalisée prend sa date réelle ;
 *       - soit D la DERNIÈRE étape réalisée (dans l'ordre chronologique des étapes) et
 *         écart = réel(D) − prévu(D) : chaque étape non réalisée APRÈS D glisse de cet écart ;
 *       - une étape non réalisée AVANT D garde sa date prévue (le réel ne réécrit pas le passé :
 *         si la plantation est saisie sans le semis, le semis reste au prévu) ;
 *       - plusieurs réalisés : seul l'écart de la dernière compte pour la suite
 *         (semis réalisé à +2 j puis plantation réalisée à +5 j → début et fin à +5 j du prévu) ;
 *       - écart négatif (en avance) : la suite avance d'autant ;
 *       - sans réalisé, ou réalisé à la date prévue : résultat égal aux dates prévues ;
 *       - une étape réalisée absente des dates prévues (semis pépinière d'un semis direct) :
 *         RangeError, c'est une incohérence de l'appelant ;
 *       - les entrées ne sont jamais modifiées ; les clés absentes restent absentes.
 *
 *   interface PlantationPerenne {
 *     readonly datePlantation: DateCalendaire;
 *     readonly perenne: ParametresPerenne;   // T01 : anneesAvantPremiereRecolte, periodeRecolteAnnuelle
 *   }                                        // (semaines ISO), rendementParPlantParAn
 *   interface DatesCampagne { readonly debutRecolte: DateCalendaire; readonly finRecolte: DateCalendaire }
 *
 *   calculerDatesCampagne(plantation: PlantationPerenne, annee: number): DatesCampagne | null   (pure)
 *     Règles (les champs de `Campagne` de T01 sont `debutRecoltePrevu | null`, d'où `null`) :
 *       - première année de récolte = année civile de plantation + anneesAvantPremiereRecolte ;
 *         avant cette année (et avant la plantation) : null ;
 *       - pas de récolte avant la plantation : une plantation le 2026-10-01 sans année d'attente et
 *         une période S15–S24 donne null en 2026, puis une récolte en 2027 ;
 *       - RangeError si anneesAvantPremiereRecolte est négatif ou non entier ;
 *       - semaine 53 : une semaine de début ou de fin à 53 est ramenée à la dernière semaine ISO
 *         de l'année visée quand celle-ci n'en a que 52 (jamais de RangeError pour cette raison) ;
 *       - période de récolte annuelle en semaines ISO (modèle de T01, `PeriodeSemaines`) :
 *           debutRecolte = lundiDeSemaine(annee, semaineDebut)
 *           finRecolte   = dimanche de la semaine semaineFin, soit lundiDeSemaine(…, semaineFin) + 6
 *       - si semaineFin < semaineDebut, la période chevauche le nouvel an : elle commence en
 *         `annee` et finit en `annee + 1` (la campagne est celle de l'année où la récolte commence).
 *
 * Compatibilité avec T01 : `Serie['datesPrevues']` et `DatesSerie` s'assignent l'un à l'autre
 * (T01 rend `semisPepiniere` facultatif) ; ce test de type échoue tant que ce changement de T01
 * n'est pas fusionné dans la branche T02.
 *
 * Le module n'est pas obligé d'être ré-exporté par `packages/core/src/index.ts` (périmètre T02).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ajouterJours, analyserDate, dateDepuisJourAbsolu, jourAbsolu, lundiDeSemaine } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import type { AncreSerie, ParametresItineraire, ParametresPerenne, Serie } from '../domaine/index.ts';
import { appliquerRealises, calculerDatesCampagne, calculerDatesSerie } from './dates-serie.ts';
import type {
  DatesCampagne,
  DatesSerie,
  EtapeSerie,
  ParametresDatesSerie,
  PlantationPerenne,
  RealisesSerie,
} from './dates-serie.ts';

/** Fabrique une DateCalendaire pour les tests ; échoue si la chaîne est invalide. */
function d(saisie: string): DateCalendaire {
  const resultat = analyserDate(saisie);
  if (!resultat.ok) {
    throw new Error(`date de test invalide : ${saisie}`);
  }
  return resultat.date;
}

// ---------------------------------------------------------------------------------------------
// Jeux de paramètres
// ---------------------------------------------------------------------------------------------

/** Exemple de référence du ticket : batavia, plant maison, pépinière 28 j, avant récolte 49 j, fenêtre 14 j. */
const BATAVIA: ParametresDatesSerie = {
  mode: 'plant_maison',
  dureePepiniereJours: 28,
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
};

/** Radis en semis direct : 28 j avant récolte, 7 j de fenêtre. */
const RADIS: ParametresDatesSerie = {
  mode: 'semis_direct',
  dureeAvantRecolteJours: 28,
  fenetreRecolteJours: 7,
};

/** Tomate en plant acheté : 70 j avant récolte, 90 j de fenêtre. */
const TOMATE: ParametresDatesSerie = {
  mode: 'plant_achete',
  dureeAvantRecolteJours: 70,
  fenetreRecolteJours: 90,
};

/** Dates prévues de la ligne 1 du tableau du ticket. */
const BATAVIA_PREVU: DatesSerie = {
  semisPepiniere: d('2027-03-08'),
  miseEnPlace: d('2027-04-05'),
  debutRecolte: d('2027-05-24'),
  finRecolte: d('2027-06-07'),
};

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

describe('types du module', () => {
  it("l'instantané complet d'un itinéraire (T01) s'assigne aux paramètres de dates", () => {
    expectTypeOf<ParametresItineraire>().toExtend<ParametresDatesSerie>();
  });

  it('le semis pépinière est une clé facultative, les autres étapes sont obligatoires', () => {
    expectTypeOf<DatesSerie>().toEqualTypeOf<{
      readonly semisPepiniere?: DateCalendaire;
      readonly miseEnPlace: DateCalendaire;
      readonly debutRecolte: DateCalendaire;
      readonly finRecolte: DateCalendaire;
    }>();
    expectTypeOf<EtapeSerie>().toEqualTypeOf<'semisPepiniere' | 'miseEnPlace' | 'debutRecolte' | 'finRecolte'>();
    expectTypeOf<RealisesSerie>().toEqualTypeOf<Readonly<Partial<Record<EtapeSerie, DateCalendaire>>>>();
  });

  it('les signatures sont celles documentées', () => {
    expectTypeOf(calculerDatesSerie).parameters.toEqualTypeOf<[ParametresDatesSerie, AncreSerie]>();
    expectTypeOf(calculerDatesSerie).returns.toEqualTypeOf<DatesSerie>();
    expectTypeOf(appliquerRealises).parameters.toEqualTypeOf<[DatesSerie, RealisesSerie]>();
    expectTypeOf(appliquerRealises).returns.toEqualTypeOf<DatesSerie>();
    expectTypeOf(calculerDatesCampagne).parameters.toEqualTypeOf<[PlantationPerenne, number]>();
    expectTypeOf(calculerDatesCampagne).returns.toEqualTypeOf<DatesCampagne | null>();
  });

  it("les dates prévues d'une Serie (T01) et DatesSerie s'assignent l'une à l'autre", () => {
    expectTypeOf<Serie['datesPrevues']>().toExtend<DatesSerie>();
    expectTypeOf<DatesSerie>().toExtend<Serie['datesPrevues']>();
  });
});

// ---------------------------------------------------------------------------------------------
// calculerDatesSerie
// ---------------------------------------------------------------------------------------------

describe('calculerDatesSerie — tableau du ticket (batavia)', () => {
  it('ligne 1 : ancre sur la plantation 2027-04-05', () => {
    expect(calculerDatesSerie(BATAVIA, { type: 'plantation', date: d('2027-04-05') })).toStrictEqual({
      semisPepiniere: d('2027-03-08'),
      miseEnPlace: d('2027-04-05'),
      debutRecolte: d('2027-05-24'),
      finRecolte: d('2027-06-07'),
    });
  });

  it('ligne 2 : ancre sur le début de récolte en semaine 22 de 2027 (lundi 2027-05-31)', () => {
    const lundi = lundiDeSemaine(2027, 22);
    expect(lundi).toBe('2027-05-31');
    expect(calculerDatesSerie(BATAVIA, { type: 'debut_recolte', date: lundi })).toStrictEqual({
      semisPepiniere: d('2027-03-15'),
      miseEnPlace: d('2027-04-12'),
      debutRecolte: d('2027-05-31'),
      finRecolte: d('2027-06-14'),
    });
  });

  it('ligne 3 : plantation prévue 2027-04-05, réalisée 2027-04-12 — le semis ne bouge pas, la suite glisse', () => {
    const prevu = calculerDatesSerie(BATAVIA, { type: 'plantation', date: d('2027-04-05') });
    expect(appliquerRealises(prevu, { miseEnPlace: d('2027-04-12') })).toStrictEqual({
      semisPepiniere: d('2027-03-08'),
      miseEnPlace: d('2027-04-12'),
      debutRecolte: d('2027-05-31'),
      finRecolte: d('2027-06-14'),
    });
  });
});

describe('calculerDatesSerie — modes et ancres', () => {
  it('ancre sur le semis pépinière : mêmes dates que la ligne 1', () => {
    expect(calculerDatesSerie(BATAVIA, { type: 'semis', date: d('2027-03-08') })).toStrictEqual(BATAVIA_PREVU);
  });

  it('semis direct ancré sur le semis : pas de semis pépinière (clé absente), mise en place = semis', () => {
    const dates = calculerDatesSerie(RADIS, { type: 'semis', date: d('2027-03-15') });
    expect(dates).toStrictEqual({
      miseEnPlace: d('2027-03-15'),
      debutRecolte: d('2027-04-12'),
      finRecolte: d('2027-04-19'),
    });
    expect('semisPepiniere' in dates).toBe(false);
    expect(Object.keys(dates).sort()).toEqual(['debutRecolte', 'finRecolte', 'miseEnPlace']);
  });

  it('semis direct ancré sur le début de récolte : à rebours, toujours sans pépinière', () => {
    const dates = calculerDatesSerie(RADIS, { type: 'debut_recolte', date: d('2027-04-12') });
    expect(dates).toStrictEqual({
      miseEnPlace: d('2027-03-15'),
      debutRecolte: d('2027-04-12'),
      finRecolte: d('2027-04-19'),
    });
    expect('semisPepiniere' in dates).toBe(false);
  });

  it("semis direct ancré sur la « plantation » : c'est la mise en place, comme l'ancre semis", () => {
    expect(calculerDatesSerie(RADIS, { type: 'plantation', date: d('2027-03-15') })).toStrictEqual(
      calculerDatesSerie(RADIS, { type: 'semis', date: d('2027-03-15') }),
    );
  });

  it('plant acheté ancré sur la plantation : pas de semis pépinière', () => {
    const dates = calculerDatesSerie(TOMATE, { type: 'plantation', date: d('2027-05-03') });
    expect(dates).toStrictEqual({
      miseEnPlace: d('2027-05-03'),
      debutRecolte: d('2027-07-12'),
      finRecolte: d('2027-10-10'),
    });
    expect('semisPepiniere' in dates).toBe(false);
  });

  it('plant acheté ancré sur le début de récolte : à rebours', () => {
    expect(calculerDatesSerie(TOMATE, { type: 'debut_recolte', date: d('2027-07-12') })).toStrictEqual({
      miseEnPlace: d('2027-05-03'),
      debutRecolte: d('2027-07-12'),
      finRecolte: d('2027-10-10'),
    });
  });

  it("plant acheté ancré sur le semis : RangeError (pas de semis à la ferme)", () => {
    expect(() => calculerDatesSerie(TOMATE, { type: 'semis', date: d('2027-03-01') })).toThrow(RangeError);
  });

  it("accepte l'instantané complet d'un itinéraire, pas seulement les durées", () => {
    const complet: ParametresItineraire = {
      mode: 'plant_maison',
      densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 30 },
      dureePepiniereJours: 28,
      grainesParMotte: 1,
      plantsParMotte: 1,
      pertePepiniere: 10,
      alveolesParPlaque: 104,
      periodeUsage: null,
      typeAbri: 'tunnel',
      dureeAvantRecolteJours: 49,
      fenetreRecolteJours: 14,
      margeSecurite: 10,
      rendementAttendu: null,
      perenne: null,
    };
    expect(calculerDatesSerie(complet, { type: 'plantation', date: d('2027-04-05') })).toStrictEqual(BATAVIA_PREVU);
  });
});

describe('calculerDatesSerie — cas limites', () => {
  it('durées nulles : toutes les dates tombent sur l’ancre', () => {
    const nul: ParametresDatesSerie = {
      mode: 'plant_maison',
      dureePepiniereJours: 0,
      dureeAvantRecolteJours: 0,
      fenetreRecolteJours: 0,
    };
    const jour = d('2027-04-05');
    const attendu = { semisPepiniere: jour, miseEnPlace: jour, debutRecolte: jour, finRecolte: jour };
    expect(calculerDatesSerie(nul, { type: 'semis', date: jour })).toStrictEqual(attendu);
    expect(calculerDatesSerie(nul, { type: 'plantation', date: jour })).toStrictEqual(attendu);
    expect(calculerDatesSerie(nul, { type: 'debut_recolte', date: jour })).toStrictEqual(attendu);
  });

  it('fenêtre de récolte nulle : la fin de récolte est le jour du début', () => {
    const dates = calculerDatesSerie({ ...BATAVIA, fenetreRecolteJours: 0 }, { type: 'plantation', date: d('2027-04-05') });
    expect(dates.debutRecolte).toBe('2027-05-24');
    expect(dates.finRecolte).toBe('2027-05-24');
  });

  it("ancre en fin d'année : les dates passent sur l'année suivante", () => {
    expect(calculerDatesSerie(BATAVIA, { type: 'plantation', date: d('2027-12-20') })).toStrictEqual({
      semisPepiniere: d('2027-11-22'),
      miseEnPlace: d('2027-12-20'),
      debutRecolte: d('2028-02-07'),
      finRecolte: d('2028-02-21'),
    });
  });

  it("ancre en début d'année sur la récolte : à rebours sur l'année précédente", () => {
    expect(calculerDatesSerie(BATAVIA, { type: 'debut_recolte', date: d('2028-01-10') })).toStrictEqual({
      semisPepiniere: d('2027-10-25'),
      miseEnPlace: d('2027-11-22'),
      debutRecolte: d('2028-01-10'),
      finRecolte: d('2028-01-24'),
    });
  });

  it('traverse le 29 février', () => {
    // 2028 est bissextile : 2028-02-20 + 14 j = 2028-03-05.
    const dates = calculerDatesSerie(
      { mode: 'plant_achete', dureeAvantRecolteJours: 0, fenetreRecolteJours: 14 },
      { type: 'plantation', date: d('2028-02-20') },
    );
    expect(dates.finRecolte).toBe('2028-03-05');
  });

  it('durée négative ou non entière : RangeError', () => {
    const ancre: AncreSerie = { type: 'plantation', date: d('2027-04-05') };
    expect(() => calculerDatesSerie({ ...BATAVIA, dureePepiniereJours: -1 }, ancre)).toThrow(RangeError);
    expect(() => calculerDatesSerie({ ...BATAVIA, dureeAvantRecolteJours: -1 }, ancre)).toThrow(RangeError);
    expect(() => calculerDatesSerie({ ...BATAVIA, fenetreRecolteJours: -1 }, ancre)).toThrow(RangeError);
    expect(() => calculerDatesSerie({ ...BATAVIA, dureeAvantRecolteJours: 49.5 }, ancre)).toThrow(RangeError);
    expect(() => calculerDatesSerie({ ...RADIS, fenetreRecolteJours: Number.NaN }, ancre)).toThrow(RangeError);
  });

  it('est pure : ne modifie pas ses entrées et répond pareil à chaque appel', () => {
    const parametres = Object.freeze({ ...BATAVIA });
    const ancre = Object.freeze({ type: 'plantation', date: d('2027-04-05') } as const);
    const premier = calculerDatesSerie(parametres, ancre);
    const second = calculerDatesSerie(parametres, ancre);
    expect(premier).toStrictEqual(second);
    expect(parametres).toStrictEqual(BATAVIA);
    expect(ancre).toStrictEqual({ type: 'plantation', date: '2027-04-05' });
  });
});

// ---------------------------------------------------------------------------------------------
// appliquerRealises
// ---------------------------------------------------------------------------------------------

describe('appliquerRealises — décalage', () => {
  it('sans réalisé : identique aux dates prévues', () => {
    expect(appliquerRealises(BATAVIA_PREVU, {})).toStrictEqual(BATAVIA_PREVU);
  });

  it('réalisé à la date prévue : identique aux dates prévues', () => {
    expect(appliquerRealises(BATAVIA_PREVU, { miseEnPlace: d('2027-04-05') })).toStrictEqual(BATAVIA_PREVU);
    expect(
      appliquerRealises(BATAVIA_PREVU, { semisPepiniere: d('2027-03-08'), miseEnPlace: d('2027-04-05') }),
    ).toStrictEqual(BATAVIA_PREVU);
  });

  it('réalisé en avance (écart négatif) : la suite avance d’autant', () => {
    expect(appliquerRealises(BATAVIA_PREVU, { miseEnPlace: d('2027-04-01') })).toStrictEqual({
      semisPepiniere: d('2027-03-08'),
      miseEnPlace: d('2027-04-01'),
      debutRecolte: d('2027-05-20'),
      finRecolte: d('2027-06-03'),
    });
  });

  it('semis pépinière réalisé en retard : toute la suite glisse', () => {
    expect(appliquerRealises(BATAVIA_PREVU, { semisPepiniere: d('2027-03-11') })).toStrictEqual({
      semisPepiniere: d('2027-03-11'),
      miseEnPlace: d('2027-04-08'),
      debutRecolte: d('2027-05-27'),
      finRecolte: d('2027-06-10'),
    });
  });

  it('plusieurs réalisés (semis +2 j, plantation +5 j) : la suite glisse de +5 j par rapport au prévu', () => {
    expect(
      appliquerRealises(BATAVIA_PREVU, { semisPepiniere: d('2027-03-10'), miseEnPlace: d('2027-04-10') }),
    ).toStrictEqual({
      semisPepiniere: d('2027-03-10'),
      miseEnPlace: d('2027-04-10'),
      debutRecolte: d('2027-05-29'),
      finRecolte: d('2027-06-12'),
    });
  });

  it('semis en retard puis plantation à la date prévue : la suite revient au prévu', () => {
    expect(
      appliquerRealises(BATAVIA_PREVU, { semisPepiniere: d('2027-03-15'), miseEnPlace: d('2027-04-05') }),
    ).toStrictEqual({ ...BATAVIA_PREVU, semisPepiniere: d('2027-03-15') });
  });

  it('début de récolte réalisé en retard : seule la fin de récolte glisse', () => {
    expect(appliquerRealises(BATAVIA_PREVU, { debutRecolte: d('2027-05-28') })).toStrictEqual({
      semisPepiniere: d('2027-03-08'),
      miseEnPlace: d('2027-04-05'),
      debutRecolte: d('2027-05-28'),
      finRecolte: d('2027-06-11'),
    });
  });

  it('étapes non saisies avant la dernière réalisée : elles gardent leur date prévue', () => {
    // Début de récolte saisi sans semis ni plantation : le passé non saisi reste au prévu.
    expect(appliquerRealises(BATAVIA_PREVU, { debutRecolte: d('2027-06-01') })).toStrictEqual({
      semisPepiniere: d('2027-03-08'),
      miseEnPlace: d('2027-04-05'),
      debutRecolte: d('2027-06-01'),
      finRecolte: d('2027-06-15'),
    });
  });

  it('toutes les étapes réalisées : chacune prend sa date réelle', () => {
    const reel: RealisesSerie = {
      semisPepiniere: d('2027-03-09'),
      miseEnPlace: d('2027-04-07'),
      debutRecolte: d('2027-05-22'),
      finRecolte: d('2027-06-20'),
    };
    expect(appliquerRealises(BATAVIA_PREVU, reel)).toStrictEqual(reel);
  });

  it('semis direct : la clé semis pépinière reste absente après recalage', () => {
    const prevu = calculerDatesSerie(RADIS, { type: 'semis', date: d('2027-03-15') });
    const recale = appliquerRealises(prevu, { miseEnPlace: d('2027-03-18') });
    expect(recale).toStrictEqual({
      miseEnPlace: d('2027-03-18'),
      debutRecolte: d('2027-04-15'),
      finRecolte: d('2027-04-22'),
    });
    expect('semisPepiniere' in recale).toBe(false);
  });

  it('semis pépinière réalisé sur une série sans pépinière : RangeError', () => {
    const prevu = calculerDatesSerie(RADIS, { type: 'semis', date: d('2027-03-15') });
    expect(() => appliquerRealises(prevu, { semisPepiniere: d('2027-02-15') })).toThrow(RangeError);
  });

  it("recalage en fin d'année : la suite passe sur l'année suivante", () => {
    const prevu = calculerDatesSerie(BATAVIA, { type: 'plantation', date: d('2027-12-20') });
    expect(appliquerRealises(prevu, { miseEnPlace: d('2027-12-27') })).toStrictEqual({
      semisPepiniere: d('2027-11-22'),
      miseEnPlace: d('2027-12-27'),
      debutRecolte: d('2028-02-14'),
      finRecolte: d('2028-02-28'),
    });
  });

  it('est pure : ne modifie ni les dates prévues ni les réalisés', () => {
    const prevu = Object.freeze({ ...BATAVIA_PREVU });
    const realises = Object.freeze({ miseEnPlace: d('2027-04-12') });
    appliquerRealises(prevu, realises);
    expect(prevu).toStrictEqual(BATAVIA_PREVU);
    expect(realises).toStrictEqual({ miseEnPlace: '2027-04-12' });
  });
});

// ---------------------------------------------------------------------------------------------
// Propriété : ordre des dates
// ---------------------------------------------------------------------------------------------

/** Générateur pseudo-aléatoire déterministe (mulberry32) : mêmes cas à chaque exécution. */
function generateur(graine: number): (max: number) => number {
  let etat = graine >>> 0;
  return (max: number): number => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const flottant = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(flottant * (max + 1)); // entier de 0 à max inclus
  };
}

function tirerParametres(hasard: (max: number) => number): ParametresDatesSerie {
  const dureeAvantRecolteJours = hasard(400);
  const fenetreRecolteJours = hasard(200);
  switch (hasard(2)) {
    case 0:
      return { mode: 'semis_direct', dureeAvantRecolteJours, fenetreRecolteJours };
    case 1:
      return { mode: 'plant_maison', dureePepiniereJours: hasard(120), dureeAvantRecolteJours, fenetreRecolteJours };
    default:
      return { mode: 'plant_achete', dureeAvantRecolteJours, fenetreRecolteJours };
  }
}

function tirerAncre(hasard: (max: number) => number, parametres: ParametresDatesSerie): AncreSerie {
  // Dates de 2000-01-01 à fin 2099 environ.
  const date = dateDepuisJourAbsolu(jourAbsolu(d('2000-01-01')) + hasard(36500));
  const types: readonly AncreSerie['type'][] =
    parametres.mode === 'plant_achete' ? ['plantation', 'debut_recolte'] : ['semis', 'plantation', 'debut_recolte'];
  const type = types[hasard(types.length - 1)] ?? 'plantation';
  return { type, date };
}

describe('propriété : semis ≤ mise en place ≤ début de récolte ≤ fin de récolte', () => {
  const CAS = 500;
  const hasard = generateur(20270405);
  const cas = Array.from({ length: CAS }, () => {
    const parametres = tirerParametres(hasard);
    return { parametres, ancre: tirerAncre(hasard, parametres) };
  });

  it(`${String(CAS)} cas tirés : dates ordonnées, écarts égaux aux durées, ancre respectée`, () => {
    for (const { parametres, ancre } of cas) {
      const dates = calculerDatesSerie(parametres, ancre);
      const contexte = JSON.stringify({ parametres, ancre, dates });

      if (parametres.mode === 'plant_maison') {
        expect(dates.semisPepiniere, contexte).toBeDefined();
        const semis = dates.semisPepiniere ?? dates.miseEnPlace;
        expect(semis <= dates.miseEnPlace, contexte).toBe(true);
        expect(jourAbsolu(dates.miseEnPlace) - jourAbsolu(semis), contexte).toBe(parametres.dureePepiniereJours);
      } else {
        expect('semisPepiniere' in dates, contexte).toBe(false);
      }
      expect(dates.miseEnPlace <= dates.debutRecolte, contexte).toBe(true);
      expect(dates.debutRecolte <= dates.finRecolte, contexte).toBe(true);
      expect(jourAbsolu(dates.debutRecolte) - jourAbsolu(dates.miseEnPlace), contexte).toBe(
        parametres.dureeAvantRecolteJours,
      );
      expect(jourAbsolu(dates.finRecolte) - jourAbsolu(dates.debutRecolte), contexte).toBe(
        parametres.fenetreRecolteJours,
      );

      const dateAncree =
        ancre.type === 'debut_recolte'
          ? dates.debutRecolte
          : ancre.type === 'plantation'
            ? dates.miseEnPlace
            : (dates.semisPepiniere ?? dates.miseEnPlace);
      expect(dateAncree, contexte).toBe(ancre.date);
    }
  });

  it(`${String(CAS)} cas tirés : ré-ancrer sur n'importe quelle date calculée redonne les mêmes dates`, () => {
    for (const { parametres, ancre } of cas) {
      const dates = calculerDatesSerie(parametres, ancre);
      const contexte = JSON.stringify({ parametres, ancre, dates });
      expect(calculerDatesSerie(parametres, { type: 'plantation', date: dates.miseEnPlace }), contexte).toStrictEqual(
        dates,
      );
      expect(
        calculerDatesSerie(parametres, { type: 'debut_recolte', date: dates.debutRecolte }),
        contexte,
      ).toStrictEqual(dates);
    }
  });

  it(`${String(CAS)} cas tirés : un seul réalisé décale la suite de son écart et rien avant`, () => {
    const etapes: readonly EtapeSerie[] = ['semisPepiniere', 'miseEnPlace', 'debutRecolte', 'finRecolte'];
    for (const { parametres, ancre } of cas) {
      const prevu = calculerDatesSerie(parametres, ancre);
      const presentes = etapes.filter((e) => prevu[e] !== undefined);
      const indexRealise = hasard(presentes.length - 1);
      const etapeRealisee = presentes[indexRealise] ?? 'miseEnPlace';
      const ecart = hasard(60) - 30;
      const datePrevue = prevu[etapeRealisee] ?? prevu.miseEnPlace;
      const recale = appliquerRealises(prevu, { [etapeRealisee]: ajouterJours(datePrevue, ecart) });
      const contexte = JSON.stringify({ prevu, etapeRealisee, ecart, recale });

      expect(Object.keys(recale).sort(), contexte).toEqual(Object.keys(prevu).sort());
      presentes.forEach((etape, i) => {
        const avant = prevu[etape] ?? prevu.miseEnPlace;
        const apres = recale[etape];
        expect(apres, contexte).toBe(i < indexRealise ? avant : ajouterJours(avant, ecart));
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// calculerDatesCampagne (pérennes)
// ---------------------------------------------------------------------------------------------

/** Asperges : 2 ans sans récolte après la plantation, récolte des semaines 15 à 24. */
const ASPERGES_PERENNE: ParametresPerenne = {
  anneesAvantPremiereRecolte: 2,
  periodeRecolteAnnuelle: { semaineDebut: 15, semaineFin: 24 },
  rendementParPlantParAn: null,
};

const ASPERGES: PlantationPerenne = { datePlantation: d('2026-04-15'), perenne: ASPERGES_PERENNE };

describe('calculerDatesCampagne — pérennes', () => {
  it('asperges plantées en 2026 : pas de récolte prévue en 2026', () => {
    expect(calculerDatesCampagne(ASPERGES, 2026)).toBeNull();
  });

  it('asperges plantées en 2026 : pas de récolte prévue en 2027', () => {
    expect(calculerDatesCampagne(ASPERGES, 2027)).toBeNull();
  });

  it('asperges plantées en 2026 : récolte prévue en 2028, du lundi S15 au dimanche S24', () => {
    expect(calculerDatesCampagne(ASPERGES, 2028)).toStrictEqual({
      debutRecolte: d('2028-04-10'),
      finRecolte: d('2028-06-18'),
    });
    expect(lundiDeSemaine(2028, 15)).toBe('2028-04-10');
  });

  it('les années suivantes aussi, sur les semaines ISO de chaque année', () => {
    expect(calculerDatesCampagne(ASPERGES, 2029)).toStrictEqual({
      debutRecolte: lundiDeSemaine(2029, 15),
      finRecolte: ajouterJours(lundiDeSemaine(2029, 24), 6),
    });
  });

  it('année antérieure à la plantation : pas de récolte', () => {
    expect(calculerDatesCampagne(ASPERGES, 2025)).toBeNull();
  });

  it('aucune année d’attente : récolte dès l’année de plantation', () => {
    const fraisiers: PlantationPerenne = {
      datePlantation: d('2026-03-01'),
      perenne: { ...ASPERGES_PERENNE, anneesAvantPremiereRecolte: 0 },
    };
    expect(calculerDatesCampagne(fraisiers, 2026)).toStrictEqual({
      debutRecolte: d('2026-04-06'),
      finRecolte: d('2026-06-14'),
    });
  });

  it("période qui chevauche le nouvel an : commence dans l'année, finit l'année suivante", () => {
    const hiver: PlantationPerenne = {
      datePlantation: d('2026-04-15'),
      perenne: { ...ASPERGES_PERENNE, periodeRecolteAnnuelle: { semaineDebut: 48, semaineFin: 6 } },
    };
    expect(calculerDatesCampagne(hiver, 2028)).toStrictEqual({
      debutRecolte: d('2028-11-27'),
      finRecolte: d('2029-02-11'),
    });
    expect(calculerDatesCampagne(hiver, 2027)).toBeNull();
  });

  it('est pure : ne modifie pas la plantation', () => {
    const plantation = Object.freeze({ ...ASPERGES, perenne: Object.freeze({ ...ASPERGES_PERENNE }) });
    calculerDatesCampagne(plantation, 2028);
    expect(plantation).toStrictEqual(ASPERGES);
  });
  it('semaine 53 en fin de période : S40→S53 en 2026 (53 semaines)', () => {
    const tardive: PlantationPerenne = {
      datePlantation: d('2024-04-15'),
      perenne: { ...ASPERGES_PERENNE, periodeRecolteAnnuelle: { semaineDebut: 40, semaineFin: 53 } },
    };
    expect(calculerDatesCampagne(tardive, 2026)).toStrictEqual({
      debutRecolte: d('2026-09-28'),
      finRecolte: d('2027-01-03'),
    });
  });

  it("semaine 53 en fin de période : ramenée à la S52 en 2027 (52 semaines), sans RangeError", () => {
    const tardive: PlantationPerenne = {
      datePlantation: d('2024-04-15'),
      perenne: { ...ASPERGES_PERENNE, periodeRecolteAnnuelle: { semaineDebut: 40, semaineFin: 53 } },
    };
    expect(() => calculerDatesCampagne(tardive, 2027)).not.toThrow();
    expect(calculerDatesCampagne(tardive, 2027)).toStrictEqual({
      debutRecolte: d('2027-10-04'),
      finRecolte: d('2028-01-02'),
    });
  });

  it('semaine 53 en début de période : ramenée à la dernière semaine de l’année', () => {
    const hiver: PlantationPerenne = {
      datePlantation: d('2024-04-15'),
      perenne: { ...ASPERGES_PERENNE, periodeRecolteAnnuelle: { semaineDebut: 53, semaineFin: 5 } },
    };
    // 2026 a 53 semaines : lundi S53 2026, dimanche S5 2027.
    expect(calculerDatesCampagne(hiver, 2026)).toStrictEqual({
      debutRecolte: d('2026-12-28'),
      finRecolte: d('2027-02-07'),
    });
    // 2027 n'en a que 52 : lundi S52 2027, dimanche S5 2028.
    expect(() => calculerDatesCampagne(hiver, 2027)).not.toThrow();
    expect(calculerDatesCampagne(hiver, 2027)).toStrictEqual({
      debutRecolte: d('2027-12-27'),
      finRecolte: d('2028-02-06'),
    });
  });

  it('pas de récolte avant la plantation : plantée le 2026-10-01 sans attente, S15–S24 → rien en 2026, récolte en 2027', () => {
    const automne: PlantationPerenne = {
      datePlantation: d('2026-10-01'),
      perenne: { ...ASPERGES_PERENNE, anneesAvantPremiereRecolte: 0 },
    };
    expect(calculerDatesCampagne(automne, 2026)).toBeNull();
    expect(calculerDatesCampagne(automne, 2027)).toStrictEqual({
      debutRecolte: d('2027-04-12'),
      finRecolte: d('2027-06-20'),
    });
  });

  it('années avant première récolte négatives ou non entières : RangeError', () => {
    for (const anneesAvantPremiereRecolte of [-1, 1.5]) {
      const invalide: PlantationPerenne = {
        datePlantation: d('2026-04-15'),
        perenne: { ...ASPERGES_PERENNE, anneesAvantPremiereRecolte },
      };
      expect(() => calculerDatesCampagne(invalide, 2028), String(anneesAvantPremiereRecolte)).toThrow(RangeError);
    }
  });

  it("période d'une seule semaine : du lundi au dimanche de cette semaine", () => {
    const courte: PlantationPerenne = {
      datePlantation: d('2026-04-15'),
      perenne: { ...ASPERGES_PERENNE, periodeRecolteAnnuelle: { semaineDebut: 20, semaineFin: 20 } },
    };
    expect(calculerDatesCampagne(courte, 2028)).toStrictEqual({
      debutRecolte: d('2028-05-15'),
      finRecolte: d('2028-05-21'),
    });
  });
});

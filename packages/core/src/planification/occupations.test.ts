/**
 * Tests d'acceptation T03 — occupations d'un emplacement (première moitié ; les conflits sont
 * dans `conflits.test.ts`).
 *
 * API attendue, exportée par `packages/core/src/planification/occupations.ts` :
 *
 *   type NouvelleOccupation = Omit<Occupation, 'id' | 'supprimeLe'>
 *     Ce que le moteur calcule. L'identifiant (UUID v7, `creerGenerateurId`) et `supprimeLe: null`
 *     sont ajoutés par l'appelant au moment d'écrire la ligne : le moteur reste pur.
 *
 *   const DATE_SANS_FIN: DateCalendaire = '9999-12-31'
 *     `Occupation.prevuAu` est obligatoire (T01) : une plantation pérenne pas encore arrachée
 *     prend cette date comme fin prévue, et `periodeOccupation` la rend en `au: null`.
 *
 *   Unités (choix T03, fidèle aux types de T01) :
 *     - planche et rang : le paramètre `longueur` est en MÈTRES (`Metres`, comme
 *       `Emplacement.longueurM`, `PlaceOccupee.longueurM` et `Occupation.positionM`) ; il peut avoir
 *       des décimales jusqu'au centimètre (12,5 m). Le moteur compare en CENTIMÈTRES ENTIERS
 *       (arrondi au centimètre), jamais en flottants : 5,1 m + 16,1 m tiennent exactement sur 21,2 m ;
 *     - gouttière : `longueur` est un NOMBRE DE PLACES entier ; la place devient
 *       `{ unite: 'places', nombrePlaces }` et une position est interdite.
 *
 *   occupationDeSerie(
 *     serie: Serie,
 *     emplacement: Emplacement,
 *     longueur: number,                 // mètres (planche, rang) ou places (gouttière)
 *     position?: Metres | null,         // début du tronçon sur la planche, en mètres ; défaut null
 *     realises?: RealisesSerie,         // T02 ; défaut {} (aucun réalisé)
 *   ): NouvelleOccupation                (pure)
 *     - fermeId = serie.fermeId ; emplacementId = emplacement.id ;
 *       occupant = { sorte: 'serie', serieId: serie.id } ;
 *       place = { unite: 'longueur', longueurM: longueur } (planche, rang)
 *             | { unite: 'places', nombrePlaces: longueur } (gouttière) ;
 *       positionM = position ?? null ;
 *     - dates : D = appliquerRealises(serie.datesPrevues, realises) (T02 : le prévu glisse avec
 *       le réel) ; prevuDu = D.miseEnPlace ; prevuAu = D.finRecolte. La pépinière n'occupe pas
 *       l'emplacement : le semis pépinière n'intervient jamais ;
 *     - reel = null tant que la mise en place n'est pas réalisée ; sinon
 *       { du: realises.miseEnPlace, au: realises.finRecolte ?? null } ;
 *       la fin réelle vient TOUJOURS de `realises.finRecolte` : c'est à l'appelant de la tirer de
 *       l'événement d'arrachage (`realise` d'étape 'arrachage') avant d'appeler ;
 *     - RangeError (validation de la place, commune aux trois fonctions) :
 *         longueur non finie ou < 0,01 m (un centimètre, la résolution du moteur) ;
 *         nombre de places non entier ou ≤ 0 (gouttière) ;
 *         position négative ou non finie ; position sur une gouttière ;
 *         position + longueur > emplacement.longueurM (comparé en centimètres entiers :
 *         10 m posés à 20 m sur 30 m passent, à 25 m ils dépassent) ;
 *     - RangeError propre à la série : fin réelle (realises.finRecolte) STRICTEMENT avant la
 *       mise en place réelle (realises.miseEnPlace). Le même jour est permis (durée nulle).
 *
 *   occupationDePlantation(
 *     plantation: Plantation,
 *     emplacement: Emplacement,
 *     longueur: number,
 *     position?: Metres | null,
 *   ): NouvelleOccupation                (pure)
 *     - occupant = { sorte: 'plantation', plantationId: plantation.id } ; place, position,
 *       fermeId, emplacementId et RangeError comme ci-dessus ;
 *     - prevuDu = plantation.datePlantation ; prevuAu = plantation.dateArrachage ?? DATE_SANS_FIN ;
 *       reel = null (la plantation n'a qu'un jeu de dates).
 *
 *   occupationDeCouverture(
 *     evenement: Evenement,             // intervention de catégorie 'couverture'
 *     emplacement: Emplacement,
 *     longueur: number,
 *     position?: Metres | null,
 *   ): NouvelleOccupation                (pure)
 *     - occupant = { sorte: 'couverture', evenementId: evenement.id } ; fermeId = evenement.fermeId ;
 *     - prevuDu = evenement.date ; prevuAu = evenement.date + detail.dureeOccupationJours ;
 *       reel = null ;
 *     - RangeError si l'événement n'est pas une intervention de couverture, ou si sa durée
 *       d'occupation est `null` (couverture courte : pas d'occupation) ou ≤ 0.
 *
 *   periodeOccupation(occupation: Pick<Occupation, 'prevuDu' | 'prevuAu' | 'reel'>):
 *     { readonly du: DateCalendaire; readonly au: DateCalendaire | null }   (pure)
 *     Période effective : les dates réelles priment sur les prévues.
 *       du = reel?.du ?? prevuDu ;
 *       au = reel?.au ?? prevuAu, puis `null` si cette date vaut DATE_SANS_FIN.
 *     Convention des intervalles (toute la T03) : `au` est le jour où l'emplacement se libère.
 *     Deux périodes A et B se recouvrent si et seulement si du(A) < au(B) et du(B) < au(A)
 *     (`au: null` = +∞) : arracher et replanter le même jour ne se recouvre pas.
 *
 *     RÈGLE DE LECTURE : la période d'une occupation se lit TOUJOURS par `periodeOccupation`,
 *     jamais par `prevuDu` / `prevuAu` directement. `prevuAu` peut valoir DATE_SANS_FIN (sentinelle
 *     de stockage, pas une vraie date), et le réel prime sur le prévu.
 *
 * Le module n'est pas obligé d'être ré-exporté par `packages/core/src/index.ts` (périmètre T03).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { analyserDate } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import type {
  Emplacement,
  Evenement,
  Id,
  NomEntite,
  Occupation,
  Plantation,
  Serie,
} from '../domaine/index.ts';
import type { DatesSerie } from './dates-serie.ts';
import {
  DATE_SANS_FIN,
  occupationDeCouverture,
  occupationDePlantation,
  occupationDeSerie,
  periodeOccupation,
} from './occupations.ts';
import type { NouvelleOccupation } from './occupations.ts';

// ---------------------------------------------------------------------------------------------
// Fabriques de test
// ---------------------------------------------------------------------------------------------

/** Fabrique une DateCalendaire pour les tests ; échoue si la chaîne est invalide. */
function d(saisie: string): DateCalendaire {
  const resultat = analyserDate(saisie);
  if (!resultat.ok) {
    throw new Error(`date de test invalide : ${saisie}`);
  }
  return resultat.date;
}

/** Identifiant de test lisible, marqué par l'entité. */
function id<E extends NomEntite>(nom: string): Id<E> {
  return nom as Id<E>;
}

const FERME = id<'Ferme'>('ferme');

function planche(code: string, longueurM: number): Emplacement {
  return {
    id: id<'Emplacement'>(code),
    fermeId: FERME,
    supprimeLe: null,
    zoneId: id<'Zone'>('tunnel-2'),
    code,
    sorte: 'planche',
    longueurM,
    largeurM: 0.8,
    actifDu: d('2020-01-01'),
    actifAu: null,
    remplace: [],
    placementXM: null,
    placementYM: null,
    orientationDeg: null,
  };
}

function gouttiere(code: string, nombrePlaces: number): Emplacement {
  return {
    id: id<'Emplacement'>(code),
    fermeId: FERME,
    supprimeLe: null,
    zoneId: id<'Zone'>('serre-fraises'),
    code,
    sorte: 'gouttiere',
    longueurM: 20,
    largeurM: null,
    nombrePlaces,
    actifDu: d('2020-01-01'),
    actifAu: null,
    remplace: [],
    placementXM: null,
    placementYM: null,
    orientationDeg: null,
  };
}

function serie(nom: string, datesPrevues: DatesSerie): Serie {
  return {
    id: id<'Serie'>(nom),
    fermeId: FERME,
    supprimeLe: null,
    saisonId: id<'Saison'>('2027'),
    especeId: id<'Espece'>('espece'),
    varieteId: null,
    itineraireId: id<'Itineraire'>('itineraire'),
    parametres: {
      mode: 'plant_achete',
      densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 30 },
      periodeUsage: null,
      typeAbri: null,
      dureeAvantRecolteJours: 49,
      fenetreRecolteJours: 14,
      margeSecurite: 10,
      rendementAttendu: null,
      perenne: null,
    },
    ancre: { type: 'plantation', date: datesPrevues.miseEnPlace },
    datesPrevues,
    taille: { unite: 'longueur', longueurM: 30 },
    statut: 'prevue',
  };
}

function plantation(nom: string, datePlantation: string, dateArrachage: string | null): Plantation {
  return {
    id: id<'Plantation'>(nom),
    fermeId: FERME,
    supprimeLe: null,
    especeId: id<'Espece'>('asperge'),
    varieteId: null,
    datePlantation: d(datePlantation),
    nombrePlants: 400,
    dateArrachage: dateArrachage === null ? null : d(dateArrachage),
  };
}

function couverture(nom: string, date: string, dureeOccupationJours: number | null): Evenement {
  return {
    id: id<'Evenement'>(nom),
    fermeId: FERME,
    date: d(date),
    horodatage: 0,
    auteurId: id<'Utilisateur'>('theophane'),
    source: 'tap',
    culture: null,
    emplacementIds: [id<'Emplacement'>('T2-P03')],
    note: null,
    photos: [],
    remplaceEvenement: null,
    type: 'intervention',
    detail: { categorie: 'couverture', type: 'bâchage ou occultation', outil: null, dureeOccupationJours },
  };
}

/** Batavia en plant maison de l'exemple T02 : la pépinière commence le 2027-03-08. */
const BATAVIA_PREVU: DatesSerie = {
  semisPepiniere: d('2027-03-08'),
  miseEnPlace: d('2027-04-05'),
  debutRecolte: d('2027-05-24'),
  finRecolte: d('2027-06-07'),
};

const P03 = planche('T2-P03', 30);

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

describe('types', () => {
  it('une nouvelle occupation est une Occupation sans identifiant ni suppression douce', () => {
    expectTypeOf<NouvelleOccupation>().toEqualTypeOf<Omit<Occupation, 'id' | 'supprimeLe'>>();
    expectTypeOf(DATE_SANS_FIN).toEqualTypeOf<DateCalendaire>();
    expect(DATE_SANS_FIN).toBe('9999-12-31');
  });

  it('periodeOccupation rend une fin nullable', () => {
    expectTypeOf(periodeOccupation).returns.toEqualTypeOf<{
      readonly du: DateCalendaire;
      readonly au: DateCalendaire | null;
    }>();
  });
});

// ---------------------------------------------------------------------------------------------
// occupationDeSerie
// ---------------------------------------------------------------------------------------------

describe('occupationDeSerie', () => {
  it('occupe de la mise en place à la fin de récolte : la pépinière n’occupe pas la planche', () => {
    const occupation = occupationDeSerie(serie('batavia-1', BATAVIA_PREVU), P03, 15, 0);
    expect(occupation).toEqual({
      fermeId: FERME,
      emplacementId: P03.id,
      occupant: { sorte: 'serie', serieId: id<'Serie'>('batavia-1') },
      place: { unite: 'longueur', longueurM: 15 },
      positionM: 0,
      prevuDu: d('2027-04-05'),
      prevuAu: d('2027-06-07'),
      reel: null,
    });
    expect(occupation.prevuDu).not.toBe(BATAVIA_PREVU.semisPepiniere);
  });

  it('sans position, positionM vaut null (jamais undefined)', () => {
    const occupation = occupationDeSerie(serie('batavia-1', BATAVIA_PREVU), P03, 12.5);
    expect(occupation.positionM).toBeNull();
    expect(occupation.place).toEqual({ unite: 'longueur', longueurM: 12.5 });
    expect(occupationDeSerie(serie('batavia-1', BATAVIA_PREVU), P03, 12.5, null).positionM).toBeNull();
  });

  it('sur une gouttière, la place se compte en places', () => {
    const g = gouttiere('G-07', 20);
    const occupation = occupationDeSerie(serie('fraise', BATAVIA_PREVU), g, 8);
    expect(occupation.place).toEqual({ unite: 'places', nombrePlaces: 8 });
    expect(occupation.positionM).toBeNull();
    expect(occupation.emplacementId).toBe(g.id);
  });

  it('dates réelles : la mise en place réalisée remplit `reel` et fait glisser le prévu (T02)', () => {
    // Plantation réalisée 7 jours en retard : la fin prévue glisse aussi de 7 jours.
    const occupation = occupationDeSerie(serie('batavia-2', BATAVIA_PREVU), P03, 15, 15, {
      miseEnPlace: d('2027-04-12'),
    });
    expect(occupation.prevuDu).toBe('2027-04-12');
    expect(occupation.prevuAu).toBe('2027-06-14');
    expect(occupation.reel).toEqual({ du: d('2027-04-12'), au: null });
    expect(periodeOccupation(occupation)).toEqual({ du: d('2027-04-12'), au: d('2027-06-14') });
  });

  it('dates réelles : l’arrachage réalisé ferme la période réelle', () => {
    const occupation = occupationDeSerie(serie('batavia-2', BATAVIA_PREVU), P03, 15, 15, {
      miseEnPlace: d('2027-04-12'),
      finRecolte: d('2027-06-01'),
    });
    expect(occupation.reel).toEqual({ du: d('2027-04-12'), au: d('2027-06-01') });
    expect(occupation.prevuAu).toBe('2027-06-01');
    expect(periodeOccupation(occupation)).toEqual({ du: d('2027-04-12'), au: d('2027-06-01') });
  });

  it('un semis pépinière réalisé seul ne crée pas de période réelle', () => {
    const occupation = occupationDeSerie(serie('batavia-2', BATAVIA_PREVU), P03, 15, 15, {
      semisPepiniere: d('2027-03-10'),
    });
    expect(occupation.reel).toBeNull();
    // Le semis a 2 jours de retard : toute la suite glisse de 2 jours (T02).
    expect(occupation.prevuDu).toBe('2027-04-07');
    expect(occupation.prevuAu).toBe('2027-06-09');
  });

  it('ne modifie pas la série', () => {
    const s = serie('batavia-1', BATAVIA_PREVU);
    const copie = JSON.parse(JSON.stringify(s)) as Serie;
    occupationDeSerie(s, P03, 15, 0, { miseEnPlace: d('2027-04-12') });
    expect(s).toEqual(copie);
  });

  it('refuse une place impossible', () => {
    const s = serie('batavia-1', BATAVIA_PREVU);
    expect(() => occupationDeSerie(s, P03, 0)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, P03, -3)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, P03, Number.NaN)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, P03, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, P03, 10, -1)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, gouttiere('G-07', 20), 2.5)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, gouttiere('G-07', 20), 4, 0)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, gouttiere('G-07', 20), 0)).toThrow(RangeError);
  });

  it('longueur minimale : un centimètre', () => {
    const s = serie('batavia-1', BATAVIA_PREVU);
    expect(() => occupationDeSerie(s, P03, 0.009)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, P03, 0.004)).toThrow(RangeError);
    expect(occupationDeSerie(s, P03, 0.01).place).toEqual({ unite: 'longueur', longueurM: 0.01 });
  });

  it('refuse un tronçon qui dépasse l’emplacement', () => {
    const s = serie('batavia-1', BATAVIA_PREVU);
    expect(() => occupationDeSerie(s, P03, 10, 25)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, P03, 30.01, 0)).toThrow(RangeError);
    expect(() => occupationDeSerie(s, P03, 10, 30)).toThrow(RangeError);
    // Pile à la limite : 20 + 10 = 30 m, et 5,1 + 16,1 = 21,2 m sans erreur de flottant.
    expect(occupationDeSerie(s, P03, 10, 20).positionM).toBe(20);
    expect(occupationDeSerie(s, planche('P-21', 21.2), 16.1, 5.1).positionM).toBe(5.1);
  });

  it('refuse une fin réelle avant la mise en place réelle', () => {
    const s = serie('batavia-2', BATAVIA_PREVU);
    expect(() =>
      occupationDeSerie(s, P03, 15, 15, { miseEnPlace: d('2027-04-12'), finRecolte: d('2027-04-10') }),
    ).toThrow(RangeError);
    // Le même jour : durée nulle, permise.
    expect(
      occupationDeSerie(s, P03, 15, 15, { miseEnPlace: d('2027-04-12'), finRecolte: d('2027-04-12') }).reel,
    ).toEqual({ du: d('2027-04-12'), au: d('2027-04-12') });
  });
});

// ---------------------------------------------------------------------------------------------
// occupationDePlantation
// ---------------------------------------------------------------------------------------------

describe('occupationDePlantation', () => {
  it('pérenne sans date d’arrachage : occupe sans fin', () => {
    const rang = planche('R-ASP-1', 50);
    const occupation = occupationDePlantation(plantation('asperges', '2025-03-15', null), rang, 50);
    expect(occupation).toEqual({
      fermeId: FERME,
      emplacementId: rang.id,
      occupant: { sorte: 'plantation', plantationId: id<'Plantation'>('asperges') },
      place: { unite: 'longueur', longueurM: 50 },
      positionM: null,
      prevuDu: d('2025-03-15'),
      prevuAu: DATE_SANS_FIN,
      reel: null,
    });
    expect(periodeOccupation(occupation)).toEqual({ du: d('2025-03-15'), au: null });
  });

  it('pérenne arrachée : occupe jusqu’à l’arrachage', () => {
    const rang = planche('R-ASP-1', 50);
    const occupation = occupationDePlantation(plantation('asperges', '2015-03-15', '2026-11-02'), rang, 50, 0);
    expect(occupation.positionM).toBe(0);
    expect(periodeOccupation(occupation)).toEqual({ du: d('2015-03-15'), au: d('2026-11-02') });
  });

  it('fraisiers en gouttière : des places', () => {
    const occupation = occupationDePlantation(plantation('fraisiers', '2026-08-20', null), gouttiere('G-07', 20), 12);
    expect(occupation.place).toEqual({ unite: 'places', nombrePlaces: 12 });
  });

  it('refuse une place impossible', () => {
    const p = plantation('asperges', '2025-03-15', null);
    expect(() => occupationDePlantation(p, P03, 0)).toThrow(RangeError);
    expect(() => occupationDePlantation(p, gouttiere('G-07', 20), 1.5)).toThrow(RangeError);
    expect(() => occupationDePlantation(p, gouttiere('G-07', 20), 3, 2)).toThrow(RangeError);
    expect(() => occupationDePlantation(p, P03, 0.005)).toThrow(RangeError);
    expect(() => occupationDePlantation(p, P03, 10, 25)).toThrow(RangeError);
    expect(occupationDePlantation(p, P03, 10, 20).positionM).toBe(20);
  });
});

// ---------------------------------------------------------------------------------------------
// occupationDeCouverture
// ---------------------------------------------------------------------------------------------

describe('occupationDeCouverture', () => {
  it('une bâche de 42 jours réserve la planche de la pose à la dépose', () => {
    const occupation = occupationDeCouverture(couverture('bache', '2027-02-01', 42), P03, 30, 0);
    expect(occupation).toEqual({
      fermeId: FERME,
      emplacementId: P03.id,
      occupant: { sorte: 'couverture', evenementId: id<'Evenement'>('bache') },
      place: { unite: 'longueur', longueurM: 30 },
      positionM: 0,
      prevuDu: d('2027-02-01'),
      prevuAu: d('2027-03-15'),
      reel: null,
    });
  });

  it('refuse une couverture sans durée d’occupation ou un autre événement', () => {
    expect(() => occupationDeCouverture(couverture('paillage', '2027-02-01', null), P03, 30)).toThrow(RangeError);
    const desherbage: Evenement = {
      ...couverture('desherbage', '2027-02-01', 42),
      type: 'intervention',
      detail: { categorie: 'entretien', type: 'désherbage', outil: null },
    };
    expect(() => occupationDeCouverture(desherbage, P03, 30)).toThrow(RangeError);
  });

  it('refuse une durée d’occupation nulle ou négative', () => {
    expect(() => occupationDeCouverture(couverture('bache', '2027-02-01', 0), P03, 30)).toThrow(RangeError);
    expect(() => occupationDeCouverture(couverture('bache', '2027-02-01', -5), P03, 30)).toThrow(RangeError);
  });

  it('refuse une place impossible, comme les autres occupations', () => {
    const bache = couverture('bache', '2027-02-01', 42);
    expect(() => occupationDeCouverture(bache, P03, 0.009)).toThrow(RangeError);
    expect(() => occupationDeCouverture(bache, P03, 30, 0.5)).toThrow(RangeError);
    expect(occupationDeCouverture(bache, P03, 29.5, 0.5).positionM).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------------------------
// periodeOccupation
// ---------------------------------------------------------------------------------------------

describe('periodeOccupation : les dates réelles priment sur les prévues', () => {
  const prevu = { prevuDu: d('2027-04-05'), prevuAu: d('2027-06-07') };

  it('sans réel : le prévu', () => {
    expect(periodeOccupation({ ...prevu, reel: null })).toEqual({ du: d('2027-04-05'), au: d('2027-06-07') });
  });

  it('réel complet : le réel', () => {
    expect(periodeOccupation({ ...prevu, reel: { du: d('2027-04-09'), au: d('2027-05-30') } })).toEqual({
      du: d('2027-04-09'),
      au: d('2027-05-30'),
    });
  });

  it('réel sans fin : début réel, fin prévue', () => {
    expect(periodeOccupation({ ...prevu, reel: { du: d('2027-04-09'), au: null } })).toEqual({
      du: d('2027-04-09'),
      au: d('2027-06-07'),
    });
  });

  it('fin prévue DATE_SANS_FIN : au null', () => {
    expect(periodeOccupation({ prevuDu: d('2025-03-15'), prevuAu: DATE_SANS_FIN, reel: null })).toEqual({
      du: d('2025-03-15'),
      au: null,
    });
  });
});

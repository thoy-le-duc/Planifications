/**
 * Tests d'acceptation T03 — conflits de place sur un emplacement (seconde moitié ; les
 * occupations et leurs conventions sont dans `occupations.test.ts`).
 *
 * API attendue, exportée par `packages/core/src/planification/conflits.ts` :
 *
 *   type SorteConflit =
 *     | 'chevauchement' | 'surcharge' | 'depassement' | 'emplacement_inactif' | 'periode_invalide'
 *
 *   interface Conflit {
 *     readonly sorte: SorteConflit;
 *     readonly emplacementId: Id<'Emplacement'>;
 *     readonly occupations: readonly Id<'Occupation'>[];  // occupations en cause, dans l'ordre de la liste d'entrée
 *     readonly du: DateCalendaire;                        // début du recouvrement
 *     readonly au: DateCalendaire | null;                 // jour où il cesse ; null = sans fin (pérenne en place)
 *   }
 *
 *   detecterConflits(emplacement: Emplacement, occupations: readonly Occupation[]): Conflit[]   (pure)
 *
 * Usage prévu : un appel par emplacement, avec les occupations de cet emplacement (l'appelant les
 * a déjà par emplacement, c'est ainsi que la vue 2D les lit). Les occupations d'un autre
 * emplacement sont tolérées et ignorées, mais ce n'est pas le chemin mesuré en performance.
 *
 * Règles :
 *   - Seules comptent les occupations de CET emplacement (`emplacementId`) et non supprimées
 *     (`supprimeLe === null`) : les autres sont ignorées, sans erreur.
 *   - Période d'une occupation = `periodeOccupation` (occupations.ts), JAMAIS `prevuAu` lu
 *     directement (DATE_SANS_FIN est une sentinelle de stockage) : réel prioritaire sur le prévu,
 *     `au` = jour où l'emplacement se libère, `null` = sans fin. Deux occupations ne sont
 *     présentes ensemble que si du(A) < au(B) et du(B) < au(A) : arracher et replanter le même
 *     jour ne fait pas de conflit.
 *   - Période de durée nulle (du = au) : occupation ignorée, sans conflit.
 *   - 'periode_invalide' : période inversée (du > au), erreur de données. L'occupation n'est pas
 *     écartée en silence : un conflit avec cette seule occupation, `du` et `au` recopiés TELS
 *     QUELS depuis `periodeOccupation` (donc du > au), pour que l'écran montre la donnée fautive.
 *     Elle ne participe à aucun autre conflit. detecterConflits ne lève jamais pour ça.
 *   - Longueurs et positions comparées en CENTIMÈTRES ENTIERS (mètres × 100, arrondis) : aucune
 *     erreur de flottant (5,1 m + 16,1 m tiennent sur 21,2 m).
 *   - 'chevauchement' : deux occupations présentes ensemble, TOUTES DEUX avec une position, dont
 *     les tronçons [positionM, positionM + longueurM[ se recouvrent (0–15 m et 15–30 m se
 *     touchent sans se recouvrir). En cause : une GRAPPE de tronçons reliés par recouvrement ;
 *     deux grappes disjointes au même moment (0–10/5–15 et 20–25/22–27) font deux conflits.
 *   - 'surcharge' : à un moment donné, au moins une occupation présente est SANS position et la
 *     somme des places présentes (positionnées ou non) dépasse la capacité : `longueurM` pour une
 *     planche ou un rang, `nombrePlaces` pour une gouttière. En cause : toutes les occupations
 *     présentes à ce moment-là. (Si toutes ont une position, seul le chevauchement s'applique.)
 *   - 'depassement' : occupation positionnée dont le tronçon sort de l'emplacement
 *     (positionM + longueurM > emplacement.longueurM), par exemple après qu'une planche a été
 *     redessinée plus courte. Un conflit par occupation, sur toute sa période. (Les fonctions
 *     occupationDe… refusent déjà ce cas à la création ; ce conflit couvre les lignes déjà
 *     enregistrées.) Une occupation sans position trop longue reste une 'surcharge'.
 *   - Regroupement : pour une même sorte, une tranche de temps en conflit PROLONGE un conflit
 *     ouvert seulement si elle le suit sans interruption ET partage au moins une occupation avec
 *     lui ; `occupations` est alors l'union, [du, au[ la période totale. Sinon, c'est un nouveau
 *     conflit : A+B de janvier à mars puis C+D de mars à mai font deux conflits. L'exemple du
 *     ticket reste un conflit unique « tomate + deux batavias du 2027-06-01 au 2027-06-21 »
 *     (la tomate est commune aux deux tranches).
 *   - 'emplacement_inactif' (« emplacement supprimé ») : l'emplacement est actif sur
 *     [actifDu, actifAu[ (actifAu null = sans fin). Pour chaque occupation qui en déborde, un
 *     conflit par côté, avec cette seule occupation et la partie hors de la période active :
 *       avant : { du: du(occ), au: min(au(occ), actifDu) }
 *       après : { du: max(du(occ), actifAu), au: au(occ) }
 *     Une occupation qui finit le jour de actifAu ne déborde pas.
 *     Emplacement en suppression douce (`supprimeLe` renseigné) : inactif partout ; chaque
 *     occupation (non supprimée, de période valide et non nulle) donne UN conflit sur toute sa
 *     période, à la place des conflits par côté.
 *   - Ordre du résultat : par `du` croissant, puis sorte (chevauchement, surcharge, depassement,
 *     emplacement_inactif, periode_invalide), puis rang dans la liste d'entrée de la première
 *     occupation en cause. Aucun conflit : tableau vide.
 *   - Performance : 3 000 occupations sur 400 emplacements (un appel par emplacement) en moins
 *     de 50 ms, meilleure de 5 mesures après échauffement.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ajouterJours, analyserDate } from '../dates/index.ts';
import type { DateCalendaire } from '../dates/index.ts';
import type { Emplacement, Id, NomEntite, Occupation, Serie } from '../domaine/index.ts';
import { detecterConflits } from './conflits.ts';
import type { Conflit, SorteConflit } from './conflits.ts';
import type { DatesSerie } from './dates-serie.ts';
import { DATE_SANS_FIN, occupationDePlantation, occupationDeSerie } from './occupations.ts';
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

interface OptionsEmplacement {
  readonly actifDu?: string;
  readonly actifAu?: string | null;
  readonly supprime?: boolean;
}

function planche(code: string, longueurM: number, options: OptionsEmplacement = {}): Emplacement {
  return {
    id: id<'Emplacement'>(code),
    fermeId: FERME,
    supprimeLe: options.supprime === true ? 1_790_000_000_000 : null,
    zoneId: id<'Zone'>('tunnel-2'),
    code,
    sorte: 'planche',
    longueurM,
    largeurM: 0.8,
    actifDu: d(options.actifDu ?? '2020-01-01'),
    actifAu: options.actifAu === undefined || options.actifAu === null ? null : d(options.actifAu),
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
    especeId: id<'Espece'>(nom),
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

/** Dates prévues d'une série qui occupe l'emplacement du `du` au `au`. */
function prevues(du: string, au: string): DatesSerie {
  return { miseEnPlace: d(du), debutRecolte: d(du), finRecolte: d(au) };
}

/** Ajoute l'identifiant et `supprimeLe`, comme le fait l'appelant avant d'écrire la ligne. */
function enregistrer(nom: string, nouvelle: NouvelleOccupation): Occupation {
  return { id: id<'Occupation'>(nom), supprimeLe: null, ...nouvelle };
}

interface OptionsOccupation {
  readonly longueurM?: number;
  readonly places?: number;
  readonly positionM?: number | null;
  readonly du: string;
  readonly au: string;
  readonly reel?: { readonly du: string; readonly au: string | null } | null;
  readonly supprimee?: boolean;
}

/** Occupation construite à la main (série fictive), pour les cas de dates et de place. */
function occ(nom: string, emplacement: Emplacement, o: OptionsOccupation): Occupation {
  return {
    id: id<'Occupation'>(nom),
    fermeId: FERME,
    supprimeLe: o.supprimee === true ? 1_790_000_000_000 : null,
    emplacementId: emplacement.id,
    occupant: { sorte: 'serie', serieId: id<'Serie'>(nom) },
    place:
      o.places === undefined
        ? { unite: 'longueur', longueurM: o.longueurM ?? emplacement.longueurM }
        : { unite: 'places', nombrePlaces: o.places },
    positionM: o.positionM ?? null,
    prevuDu: d(o.du),
    prevuAu: d(o.au),
    reel: o.reel === undefined || o.reel === null ? null : { du: d(o.reel.du), au: o.reel.au === null ? null : d(o.reel.au) },
  };
}

function conflit(
  sorte: SorteConflit,
  emplacement: Emplacement,
  occupations: readonly string[],
  du: string,
  au: string | null,
): Conflit {
  return {
    sorte,
    emplacementId: emplacement.id,
    occupations: occupations.map((nom) => id<'Occupation'>(nom)),
    du: d(du),
    au: au === null ? null : d(au),
  };
}

const P03 = planche('T2-P03', 30);

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

describe('types', () => {
  it('forme d’un conflit', () => {
    expectTypeOf<SorteConflit>().toEqualTypeOf<
      'chevauchement' | 'surcharge' | 'depassement' | 'emplacement_inactif' | 'periode_invalide'
    >();
    expectTypeOf<Conflit['occupations']>().toEqualTypeOf<readonly Id<'Occupation'>[]>();
    expectTypeOf<Conflit['emplacementId']>().toEqualTypeOf<Id<'Emplacement'>>();
    expectTypeOf<Conflit['du']>().toEqualTypeOf<DateCalendaire>();
    expectTypeOf<Conflit['au']>().toEqualTypeOf<DateCalendaire | null>();
    expectTypeOf(detecterConflits).parameters.toEqualTypeOf<[Emplacement, readonly Occupation[]]>();
    expectTypeOf(detecterConflits).returns.toEqualTypeOf<Conflit[]>();
  });
});

// ---------------------------------------------------------------------------------------------
// L'exemple du ticket
// ---------------------------------------------------------------------------------------------

describe('exemple du ticket : planche de 30 m', () => {
  const radis = enregistrer('radis', occupationDeSerie(serie('radis', prevues('2027-03-01', '2027-04-04')), P03, 30, 0));
  const batavia1 = enregistrer(
    'batavia-1',
    occupationDeSerie(
      serie('batavia-1', {
        semisPepiniere: d('2027-03-08'),
        miseEnPlace: d('2027-04-05'),
        debutRecolte: d('2027-05-24'),
        finRecolte: d('2027-06-07'),
      }),
      P03,
      15,
      0,
    ),
  );
  const batavia2 = enregistrer(
    'batavia-2',
    occupationDeSerie(
      serie('batavia-2', {
        semisPepiniere: d('2027-03-22'),
        miseEnPlace: d('2027-04-19'),
        debutRecolte: d('2027-06-07'),
        finRecolte: d('2027-06-21'),
      }),
      P03,
      15,
      15,
    ),
  );
  const tomate = enregistrer(
    'tomate',
    occupationDeSerie(serie('tomate', prevues('2027-06-01', '2027-10-15')), P03, 30, 0),
  );

  it('radis puis deux batavias côte à côte : aucun conflit', () => {
    expect(detecterConflits(P03, [radis, batavia1, batavia2])).toEqual([]);
  });

  it('la tomate 0–30 m dès le 2027-06-01 : un conflit avec les deux batavias, du 2027-06-01 au 2027-06-21', () => {
    expect(detecterConflits(P03, [radis, batavia1, batavia2, tomate])).toEqual([
      conflit('chevauchement', P03, ['batavia-1', 'batavia-2', 'tomate'], '2027-06-01', '2027-06-21'),
    ]);
  });

  it('la même tomate plantée le 2027-06-21 : plus de conflit', () => {
    const tomateTardive = enregistrer(
      'tomate',
      occupationDeSerie(serie('tomate', prevues('2027-06-21', '2027-10-15')), P03, 30, 0),
    );
    expect(detecterConflits(P03, [radis, batavia1, batavia2, tomateTardive])).toEqual([]);
  });

  it('dates réelles prioritaires : batavia 2 plantée 7 jours en retard gêne la tomate du 2027-06-21', () => {
    const batavia2EnRetard = enregistrer(
      'batavia-2',
      occupationDeSerie(
        serie('batavia-2', {
          semisPepiniere: d('2027-03-22'),
          miseEnPlace: d('2027-04-19'),
          debutRecolte: d('2027-06-07'),
          finRecolte: d('2027-06-21'),
        }),
        P03,
        15,
        15,
        { miseEnPlace: d('2027-04-26') },
      ),
    );
    const tomateTardive = enregistrer(
      'tomate',
      occupationDeSerie(serie('tomate', prevues('2027-06-21', '2027-10-15')), P03, 30, 0),
    );
    expect(detecterConflits(P03, [radis, batavia1, batavia2EnRetard, tomateTardive])).toEqual([
      conflit('chevauchement', P03, ['batavia-2', 'tomate'], '2027-06-21', '2027-06-28'),
    ]);
  });

  it('la pépinière n’occupe pas la planche : un semis pépinière pendant les radis ne gêne pas', () => {
    // Batavia 1 est semée en pépinière le 2027-03-08, en pleine culture des radis (0–30 m).
    expect(batavia1.prevuDu).toBe('2027-04-05');
    expect(detecterConflits(P03, [radis, batavia1])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Somme des longueurs (occupations sans position)
// ---------------------------------------------------------------------------------------------

describe('surcharge : somme des longueurs sans position', () => {
  it('somme exactement égale à la longueur : pas de conflit', () => {
    const a = occ('a', P03, { longueurM: 12.5, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 17.5, du: '2027-04-15', au: '2027-07-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([]);
  });

  it('un mètre de trop : conflit sur la période commune', () => {
    const a = occ('a', P03, { longueurM: 12.5, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 18.5, du: '2027-04-15', au: '2027-07-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([conflit('surcharge', P03, ['a', 'b'], '2027-04-15', '2027-06-01')]);
  });

  it('calcul exact en centimètres : 5,1 m + 16,1 m tiennent sur 21,2 m', () => {
    // En flottants, 5.1 + 16.1 = 21.200000000000003 > 21.2.
    const p = planche('P-21', 21.2);
    const a = occ('a', p, { longueurM: 5.1, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', p, { longueurM: 16.1, du: '2027-04-01', au: '2027-06-01' });
    expect(detecterConflits(p, [a, b])).toEqual([]);
  });

  it('seul le moment où la somme dépasse est en conflit', () => {
    const a = occ('a', P03, { longueurM: 20, du: '2027-03-01', au: '2027-05-01' });
    const b = occ('b', P03, { longueurM: 10, du: '2027-04-01', au: '2027-06-01' });
    const c = occ('c', P03, { longueurM: 10, du: '2027-04-15', au: '2027-04-20' });
    expect(detecterConflits(P03, [a, b, c])).toEqual([
      conflit('surcharge', P03, ['a', 'b', 'c'], '2027-04-15', '2027-04-20'),
    ]);
  });

  it('deux périodes de surcharge séparées : deux conflits, dans l’ordre des dates', () => {
    const c = occ('c', P03, { du: '2027-04-20', au: '2027-06-01' });
    const a = occ('a', P03, { du: '2027-03-01', au: '2027-04-01' });
    const b = occ('b', P03, { du: '2027-03-20', au: '2027-05-01' });
    expect(detecterConflits(P03, [c, a, b])).toEqual([
      conflit('surcharge', P03, ['a', 'b'], '2027-03-20', '2027-04-01'),
      conflit('surcharge', P03, ['c', 'b'], '2027-04-20', '2027-05-01'),
    ]);
  });

  it('positionnées et non positionnées se somment', () => {
    const a = occ('a', P03, { longueurM: 15, positionM: 0, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 15, positionM: 15, du: '2027-04-01', au: '2027-06-01' });
    const c = occ('c', P03, { longueurM: 1, du: '2027-05-01', au: '2027-07-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([]);
    expect(detecterConflits(P03, [a, b, c])).toEqual([
      conflit('surcharge', P03, ['a', 'b', 'c'], '2027-05-01', '2027-06-01'),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Tronçons positionnés
// ---------------------------------------------------------------------------------------------

describe('chevauchement : tronçons positionnés', () => {
  it('tronçons qui se touchent (0–15 m et 15–30 m) : pas de conflit', () => {
    const a = occ('a', P03, { longueurM: 15, positionM: 0, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 15, positionM: 15, du: '2027-04-01', au: '2027-06-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([]);
  });

  it('tronçons qui se recouvrent (0–15 m et 10–20 m) : conflit', () => {
    const a = occ('a', P03, { longueurM: 15, positionM: 0, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 10, positionM: 10, du: '2027-05-01', au: '2027-07-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([
      conflit('chevauchement', P03, ['a', 'b'], '2027-05-01', '2027-06-01'),
    ]);
  });

  it('seules les occupations qui se recouvrent sont en cause', () => {
    const a = occ('a', P03, { longueurM: 10, positionM: 0, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 10, positionM: 5, du: '2027-04-01', au: '2027-06-01' });
    const c = occ('c', P03, { longueurM: 10, positionM: 20, du: '2027-04-01', au: '2027-06-01' });
    expect(detecterConflits(P03, [a, b, c])).toEqual([
      conflit('chevauchement', P03, ['a', 'b'], '2027-04-01', '2027-06-01'),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Gouttière
// ---------------------------------------------------------------------------------------------

describe('gouttière : des places, pas des mètres', () => {
  const g = gouttiere('G-07', 20);
  const fraisiers = enregistrer(
    'fraisiers',
    occupationDePlantation(
      {
        id: id<'Plantation'>('fraisiers'),
        fermeId: FERME,
        supprimeLe: null,
        especeId: id<'Espece'>('fraise'),
        varieteId: null,
        datePlantation: d('2026-08-20'),
        nombrePlants: 120,
        dateArrachage: d('2027-09-30'),
      },
      g,
      12,
    ),
  );

  it('gouttière pleine juste : pas de conflit', () => {
    const complement = occ('complement', g, { places: 8, du: '2027-03-01', au: '2027-07-01' });
    expect(detecterConflits(g, [fraisiers, complement])).toEqual([]);
  });

  it('une place de trop : conflit', () => {
    const complement = occ('complement', g, { places: 9, du: '2027-03-01', au: '2027-07-01' });
    expect(detecterConflits(g, [fraisiers, complement])).toEqual([
      conflit('surcharge', g, ['fraisiers', 'complement'], '2027-03-01', '2027-07-01'),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Bornes des intervalles
// ---------------------------------------------------------------------------------------------

describe('arracher et replanter le même jour', () => {
  const a = occ('a', P03, { du: '2027-03-01', au: '2027-04-04' });

  it('début le jour de fin de la précédente : pas de conflit', () => {
    const b = occ('b', P03, { du: '2027-04-04', au: '2027-06-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([]);
  });

  it('un jour plus tôt : conflit d’un jour', () => {
    const b = occ('b', P03, { du: '2027-04-03', au: '2027-06-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([conflit('surcharge', P03, ['a', 'b'], '2027-04-03', '2027-04-04')]);
  });

  it('même règle pour des tronçons positionnés', () => {
    const ap = occ('a', P03, { positionM: 0, du: '2027-03-01', au: '2027-04-04' });
    const bp = occ('b', P03, { positionM: 0, du: '2027-04-04', au: '2027-06-01' });
    const bpTot = occ('b', P03, { positionM: 0, du: '2027-04-03', au: '2027-06-01' });
    expect(detecterConflits(P03, [ap, bp])).toEqual([]);
    expect(detecterConflits(P03, [ap, bpTot])).toEqual([
      conflit('chevauchement', P03, ['a', 'b'], '2027-04-03', '2027-04-04'),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Dates réelles
// ---------------------------------------------------------------------------------------------

describe('dates réelles prioritaires sur les prévues', () => {
  it('arrachage réel plus tôt que prévu : le conflit prévu disparaît', () => {
    const a = occ('a', P03, { du: '2027-04-01', au: '2027-06-01', reel: { du: '2027-04-01', au: '2027-05-01' } });
    const b = occ('b', P03, { du: '2027-05-01', au: '2027-07-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([]);
  });

  it('mise en place réelle plus tôt que prévu : le conflit apparaît dès le début réel', () => {
    const a = occ('a', P03, { du: '2027-04-01', au: '2027-05-01', reel: { du: '2027-03-01', au: null } });
    const b = occ('b', P03, { du: '2027-03-10', au: '2027-04-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([conflit('surcharge', P03, ['a', 'b'], '2027-03-10', '2027-04-01')]);
  });

  it('réel sans fin : la fin prévue s’applique', () => {
    const a = occ('a', P03, { du: '2027-04-01', au: '2027-06-01', reel: { du: '2027-04-01', au: null } });
    const b = occ('b', P03, { du: '2027-05-20', au: '2027-07-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([conflit('surcharge', P03, ['a', 'b'], '2027-05-20', '2027-06-01')]);
  });
});

// ---------------------------------------------------------------------------------------------
// Pérennes
// ---------------------------------------------------------------------------------------------

describe('pérenne sans date d’arrachage', () => {
  const rang = planche('R-ASP-1', 50);
  const asperges = enregistrer(
    'asperges',
    occupationDePlantation(
      {
        id: id<'Plantation'>('asperges'),
        fermeId: FERME,
        supprimeLe: null,
        especeId: id<'Espece'>('asperge'),
        varieteId: null,
        datePlantation: d('2025-03-15'),
        nombrePlants: 400,
        dateArrachage: null,
      },
      rang,
      50,
    ),
  );

  it('elle occupe encore le rang des années plus tard', () => {
    const salade = occ('salade', rang, { longueurM: 10, du: '2031-04-01', au: '2031-06-01' });
    expect(asperges.prevuAu).toBe(DATE_SANS_FIN);
    expect(detecterConflits(rang, [asperges, salade])).toEqual([
      conflit('surcharge', rang, ['asperges', 'salade'], '2031-04-01', '2031-06-01'),
    ]);
  });

  it('deux pérennes en place sur le même tronçon : conflit sans fin (au null)', () => {
    const pivoines = occ('pivoines', rang, { positionM: 40, longueurM: 10, du: '2026-10-01', au: DATE_SANS_FIN });
    const aspergesPositionnees: Occupation = { ...asperges, positionM: 0 };
    expect(detecterConflits(rang, [aspergesPositionnees, pivoines])).toEqual([
      conflit('chevauchement', rang, ['asperges', 'pivoines'], '2026-10-01', null),
    ]);
  });

  it('une série posée avant la plantation, arrachée le jour même : pas de conflit', () => {
    const engraisVert = occ('engrais-vert', rang, { du: '2024-10-01', au: '2025-03-15' });
    expect(detecterConflits(rang, [engraisVert, asperges])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Couverture longue
// ---------------------------------------------------------------------------------------------

describe('couverture longue', () => {
  function bache(du: string, au: string): Occupation {
    return {
      ...occ('bache', P03, { du, au }),
      occupant: { sorte: 'couverture', evenementId: id<'Evenement'>('bache') },
    };
  }

  it('une occultation réserve la planche : une culture posée dessous est en conflit', () => {
    const radis = occ('radis', P03, { du: '2027-03-01', au: '2027-04-04' });
    expect(detecterConflits(P03, [bache('2027-02-01', '2027-03-15'), radis])).toEqual([
      conflit('surcharge', P03, ['bache', 'radis'], '2027-03-01', '2027-03-15'),
    ]);
  });

  it('planter le jour où l’on retire la bâche : pas de conflit', () => {
    const radis = occ('radis', P03, { du: '2027-03-15', au: '2027-04-18' });
    expect(detecterConflits(P03, [bache('2027-02-01', '2027-03-15'), radis])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Emplacement inactif
// ---------------------------------------------------------------------------------------------

describe('emplacement inactif (« emplacement supprimé »)', () => {
  it('occupation au-delà de la fin d’activité : conflit sur la partie qui déborde', () => {
    const p = planche('T2-P03', 30, { actifAu: '2027-05-01' });
    const a = occ('a', p, { du: '2027-04-05', au: '2027-06-07' });
    expect(detecterConflits(p, [a])).toEqual([conflit('emplacement_inactif', p, ['a'], '2027-05-01', '2027-06-07')]);
  });

  it('occupation avant la création de l’emplacement : conflit sur la partie qui précède', () => {
    const p = planche('T2-P03-bis', 30, { actifDu: '2027-04-10' });
    const a = occ('a', p, { du: '2027-04-05', au: '2027-06-07' });
    expect(detecterConflits(p, [a])).toEqual([conflit('emplacement_inactif', p, ['a'], '2027-04-05', '2027-04-10')]);
  });

  it('occupation entièrement après : toute la période', () => {
    const p = planche('T2-P03', 30, { actifAu: '2027-01-01' });
    const a = occ('a', p, { du: '2027-04-05', au: '2027-06-07' });
    expect(detecterConflits(p, [a])).toEqual([conflit('emplacement_inactif', p, ['a'], '2027-04-05', '2027-06-07')]);
  });

  it('pérenne sans fin sur un emplacement fermé : conflit sans fin', () => {
    const p = planche('R-KIWI', 40, { actifAu: '2028-01-01' });
    const kiwis = occ('kiwis', p, { du: '2022-03-01', au: DATE_SANS_FIN });
    expect(detecterConflits(p, [kiwis])).toEqual([conflit('emplacement_inactif', p, ['kiwis'], '2028-01-01', null)]);
  });

  it('occupation qui finit le jour de la fin d’activité : pas de conflit', () => {
    const p = planche('T2-P03', 30, { actifAu: '2027-06-07' });
    const a = occ('a', p, { du: '2027-04-05', au: '2027-06-07' });
    expect(detecterConflits(p, [a])).toEqual([]);
  });

  it('se combine avec une surcharge, triée par date puis par sorte', () => {
    const p = planche('T2-P03', 30, { actifAu: '2027-05-01' });
    const a = occ('a', p, { du: '2027-04-05', au: '2027-06-07' });
    const b = occ('b', p, { du: '2027-05-01', au: '2027-05-20' });
    expect(detecterConflits(p, [a, b])).toEqual([
      conflit('surcharge', p, ['a', 'b'], '2027-05-01', '2027-05-20'),
      conflit('emplacement_inactif', p, ['a'], '2027-05-01', '2027-06-07'),
      conflit('emplacement_inactif', p, ['b'], '2027-05-01', '2027-05-20'),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Dépassement de l'emplacement
// ---------------------------------------------------------------------------------------------

describe('dépassement de l’emplacement (occupation déjà enregistrée)', () => {
  it('10 m posés à 25 m sur une planche de 30 m : dépassement sur toute la période', () => {
    const a = occ('a', P03, { longueurM: 10, positionM: 25, du: '2027-04-01', au: '2027-06-01' });
    expect(detecterConflits(P03, [a])).toEqual([conflit('depassement', P03, ['a'], '2027-04-01', '2027-06-01')]);
  });

  it('0–30 m et 30–40 m sur 30 m : seule la seconde dépasse, pas de chevauchement', () => {
    const a = occ('a', P03, { longueurM: 30, positionM: 0, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 10, positionM: 30, du: '2027-04-01', au: '2027-06-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([conflit('depassement', P03, ['b'], '2027-04-01', '2027-06-01')]);
  });

  it('planche redessinée plus courte : les occupations d’avant dépassent', () => {
    const courte = planche('T2-P03', 20);
    const a = occ('a', courte, { longueurM: 15, positionM: 0, du: '2027-04-05', au: '2027-06-07' });
    const b = occ('b', courte, { longueurM: 15, positionM: 15, du: '2027-04-19', au: '2027-06-21' });
    expect(detecterConflits(courte, [a, b])).toEqual([
      conflit('depassement', courte, ['b'], '2027-04-19', '2027-06-21'),
    ]);
  });

  it('pile à la limite (20 m + 10 m sur 30 m) : pas de dépassement', () => {
    const a = occ('a', P03, { longueurM: 10, positionM: 20, du: '2027-04-01', au: '2027-06-01' });
    expect(detecterConflits(P03, [a])).toEqual([]);
  });

  it('pérenne sans fin qui dépasse : au null', () => {
    const a = occ('a', P03, { longueurM: 10, positionM: 25, du: '2026-03-01', au: DATE_SANS_FIN });
    expect(detecterConflits(P03, [a])).toEqual([conflit('depassement', P03, ['a'], '2026-03-01', null)]);
  });
});

// ---------------------------------------------------------------------------------------------
// Conflits indépendants
// ---------------------------------------------------------------------------------------------

describe('des conflits indépendants ne se fusionnent pas', () => {
  it('deux grappes de tronçons au même moment : deux conflits', () => {
    const a = occ('a', P03, { longueurM: 10, positionM: 0, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 10, positionM: 5, du: '2027-04-01', au: '2027-06-01' });
    const c = occ('c', P03, { longueurM: 5, positionM: 20, du: '2027-04-01', au: '2027-06-01' });
    const dd = occ('d', P03, { longueurM: 5, positionM: 22, du: '2027-04-01', au: '2027-06-01' });
    expect(detecterConflits(P03, [a, b, c, dd])).toEqual([
      conflit('chevauchement', P03, ['a', 'b'], '2027-04-01', '2027-06-01'),
      conflit('chevauchement', P03, ['c', 'd'], '2027-04-01', '2027-06-01'),
    ]);
  });

  it('deux grappes décalées dans le temps restent distinctes', () => {
    const a = occ('a', P03, { longueurM: 10, positionM: 0, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { longueurM: 10, positionM: 5, du: '2027-04-01', au: '2027-06-01' });
    const c = occ('c', P03, { longueurM: 5, positionM: 20, du: '2027-05-01', au: '2027-07-01' });
    const dd = occ('d', P03, { longueurM: 5, positionM: 22, du: '2027-05-01', au: '2027-07-01' });
    expect(detecterConflits(P03, [a, b, c, dd])).toEqual([
      conflit('chevauchement', P03, ['a', 'b'], '2027-04-01', '2027-06-01'),
      conflit('chevauchement', P03, ['c', 'd'], '2027-05-01', '2027-07-01'),
    ]);
  });

  it('A et B de janvier à mars, puis C et D de mars à mai, sans position : deux surcharges', () => {
    const a = occ('a', P03, { longueurM: 20, du: '2027-01-01', au: '2027-03-01' });
    const b = occ('b', P03, { longueurM: 20, du: '2027-01-01', au: '2027-03-01' });
    const c = occ('c', P03, { longueurM: 20, du: '2027-03-01', au: '2027-05-01' });
    const dd = occ('d', P03, { longueurM: 20, du: '2027-03-01', au: '2027-05-01' });
    expect(detecterConflits(P03, [a, b, c, dd])).toEqual([
      conflit('surcharge', P03, ['a', 'b'], '2027-01-01', '2027-03-01'),
      conflit('surcharge', P03, ['c', 'd'], '2027-03-01', '2027-05-01'),
    ]);
  });

  it('A et B de janvier à mars, puis C et D de mars à mai, positionnés : deux chevauchements', () => {
    const a = occ('a', P03, { longueurM: 10, positionM: 0, du: '2027-01-01', au: '2027-03-01' });
    const b = occ('b', P03, { longueurM: 10, positionM: 5, du: '2027-01-01', au: '2027-03-01' });
    const c = occ('c', P03, { longueurM: 10, positionM: 0, du: '2027-03-01', au: '2027-05-01' });
    const dd = occ('d', P03, { longueurM: 10, positionM: 5, du: '2027-03-01', au: '2027-05-01' });
    expect(detecterConflits(P03, [a, b, c, dd])).toEqual([
      conflit('chevauchement', P03, ['a', 'b'], '2027-01-01', '2027-03-01'),
      conflit('chevauchement', P03, ['c', 'd'], '2027-03-01', '2027-05-01'),
    ]);
  });

  it('une occupation commune relie les tranches : un seul conflit', () => {
    // B reste en place et recouvre A, puis C : c'est le même problème qui se prolonge.
    const a = occ('a', P03, { longueurM: 10, positionM: 0, du: '2027-01-01', au: '2027-03-01' });
    const b = occ('b', P03, { longueurM: 10, positionM: 5, du: '2027-01-01', au: '2027-05-01' });
    const c = occ('c', P03, { longueurM: 10, positionM: 10, du: '2027-03-01', au: '2027-05-01' });
    expect(detecterConflits(P03, [a, b, c])).toEqual([
      conflit('chevauchement', P03, ['a', 'b', 'c'], '2027-01-01', '2027-05-01'),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Périodes invalides
// ---------------------------------------------------------------------------------------------

describe('période inversée ou nulle', () => {
  it('période prévue inversée : conflit periode_invalide, dates recopiées telles quelles', () => {
    const a = occ('a', P03, { du: '2027-06-01', au: '2027-04-01' });
    const b = occ('b', P03, { du: '2027-04-15', au: '2027-05-15' });
    expect(detecterConflits(P03, [a, b])).toEqual([
      conflit('periode_invalide', P03, ['a'], '2027-06-01', '2027-04-01'),
    ]);
  });

  it('période réelle inversée : même traitement, le réel prime', () => {
    const a = occ('a', P03, { du: '2027-04-01', au: '2027-06-01', reel: { du: '2027-04-10', au: '2027-04-05' } });
    expect(detecterConflits(P03, [a])).toEqual([conflit('periode_invalide', P03, ['a'], '2027-04-10', '2027-04-05')]);
  });

  it('elle ne compte ni en surcharge, ni en dépassement, ni hors période active', () => {
    const p = planche('T2-P03', 30, { actifAu: '2027-05-01' });
    const a = occ('a', p, { longueurM: 10, positionM: 25, du: '2027-06-01', au: '2027-04-01' });
    expect(detecterConflits(p, [a])).toEqual([conflit('periode_invalide', p, ['a'], '2027-06-01', '2027-04-01')]);
  });

  it('période de durée nulle : ignorée, sans conflit', () => {
    const a = occ('a', P03, { du: '2027-04-01', au: '2027-04-01' });
    const b = occ('b', P03, { du: '2027-03-01', au: '2027-06-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Emplacement en suppression douce
// ---------------------------------------------------------------------------------------------

describe('emplacement en suppression douce', () => {
  const supprime = planche('T2-P03', 30, { supprime: true });

  it('chaque occupation non supprimée donne un conflit emplacement_inactif sur toute sa période', () => {
    const a = occ('a', supprime, { longueurM: 10, du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', supprime, { longueurM: 10, du: '2027-03-01', au: '2027-05-01' });
    expect(detecterConflits(supprime, [a, b])).toEqual([
      conflit('emplacement_inactif', supprime, ['b'], '2027-03-01', '2027-05-01'),
      conflit('emplacement_inactif', supprime, ['a'], '2027-04-01', '2027-06-01'),
    ]);
  });

  it('un seul conflit par occupation, même si elle déborde aussi de actifAu', () => {
    const fermeeEtSupprimee = planche('T2-P03', 30, { supprime: true, actifAu: '2027-05-01' });
    const a = occ('a', fermeeEtSupprimee, { longueurM: 10, du: '2027-04-01', au: '2027-06-01' });
    expect(detecterConflits(fermeeEtSupprimee, [a])).toEqual([
      conflit('emplacement_inactif', fermeeEtSupprimee, ['a'], '2027-04-01', '2027-06-01'),
    ]);
  });

  it('pérenne sans fin : conflit sans fin', () => {
    const kiwis = occ('kiwis', supprime, { du: '2022-03-01', au: DATE_SANS_FIN });
    expect(detecterConflits(supprime, [kiwis])).toEqual([
      conflit('emplacement_inactif', supprime, ['kiwis'], '2022-03-01', null),
    ]);
  });

  it('les occupations supprimées y sont ignorées', () => {
    const a = occ('a', supprime, { du: '2027-04-01', au: '2027-06-01', supprimee: true });
    expect(detecterConflits(supprime, [a])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Filtrage et cas limites
// ---------------------------------------------------------------------------------------------

describe('filtrage', () => {
  it('aucune occupation : aucun conflit', () => {
    expect(detecterConflits(P03, [])).toEqual([]);
  });

  it('une occupation supprimée (suppression douce) est ignorée', () => {
    const a = occ('a', P03, { du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { du: '2027-05-01', au: '2027-07-01', supprimee: true });
    expect(detecterConflits(P03, [a, b])).toEqual([]);
  });

  it('les occupations d’un autre emplacement sont ignorées', () => {
    const autre = planche('T2-P04', 30);
    const a = occ('a', P03, { du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', autre, { du: '2027-05-01', au: '2027-07-01' });
    expect(detecterConflits(P03, [a, b])).toEqual([]);
  });

  it('ne modifie pas les entrées', () => {
    const a = occ('a', P03, { du: '2027-04-01', au: '2027-06-01' });
    const b = occ('b', P03, { du: '2027-05-01', au: '2027-07-01' });
    const liste = [a, b];
    const copie = JSON.parse(JSON.stringify(liste)) as Occupation[];
    detecterConflits(P03, liste);
    expect(liste).toEqual(copie);
  });
});

// ---------------------------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------------------------

/**
 * Horloge haute résolution, globale dans Node et les navigateurs. Le paquet core est compilé sans
 * types d'environnement (`types: []`) : on déclare ici le seul membre utilisé.
 */
declare const performance: { now: () => number };

/** Générateur pseudo-aléatoire déterministe (mulberry32) : le même jeu à chaque exécution. */
function aleatoire(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jeuDeFerme(graine: number): { emplacements: Emplacement[]; parEmplacement: Map<string, Occupation[]> } {
  const hasard = aleatoire(graine);
  const entier = (min: number, max: number): number => min + Math.floor(hasard() * (max - min + 1));
  const emplacements: Emplacement[] = [];
  for (let i = 0; i < 400; i += 1) {
    emplacements.push(i % 10 === 9 ? gouttiere(`G-${String(i)}`, 20) : planche(`P-${String(i)}`, entier(10, 50)));
  }
  const parEmplacement = new Map<string, Occupation[]>();
  const debutSaison = d('2027-01-01');
  for (let i = 0; i < 3000; i += 1) {
    const emplacement = emplacements[entier(0, emplacements.length - 1)];
    if (emplacement === undefined) {
      throw new Error('jeu de test incohérent');
    }
    const du = ajouterJours(debutSaison, entier(0, 330));
    const au = ajouterJours(du, entier(20, 120));
    const positionne = emplacement.sorte !== 'gouttiere' && hasard() < 0.5;
    const longueur = entier(1, Math.max(1, Math.floor(emplacement.longueurM / 2)));
    const occupation = occ(`o-${String(i)}`, emplacement, {
      ...(emplacement.sorte === 'gouttiere' ? { places: entier(1, 10) } : { longueurM: longueur }),
      positionM: positionne ? entier(0, emplacement.longueurM - longueur) : null,
      du,
      au,
    });
    const liste = parEmplacement.get(emplacement.id) ?? [];
    liste.push(occupation);
    parEmplacement.set(emplacement.id, liste);
  }
  return { emplacements, parEmplacement };
}

describe('performance', () => {
  it('3 000 occupations sur 400 emplacements analysées en moins de 50 ms', () => {
    const { emplacements, parEmplacement } = jeuDeFerme(20270601);
    const analyser = (): Conflit[] =>
      emplacements.flatMap((emplacement) => detecterConflits(emplacement, parEmplacement.get(emplacement.id) ?? []));

    // Échauffement : compilation JIT hors mesure.
    for (let i = 0; i < 5; i += 1) {
      analyser();
    }

    // Meilleure de 5 mesures : on juge l'algorithme, pas un ramasse-miettes ou une machine chargée.
    let duree = Number.POSITIVE_INFINITY;
    let conflits: Conflit[] = [];
    for (let i = 0; i < 5; i += 1) {
      const debut = performance.now();
      conflits = analyser();
      duree = Math.min(duree, performance.now() - debut);
    }

    // Le jeu est assez dense pour produire des conflits : l'algorithme a vraiment travaillé.
    expect(conflits.length).toBeGreaterThan(0);
    for (const c of conflits) {
      expect(c.occupations.length).toBeGreaterThan(0);
      expect(c.au === null || c.du < c.au).toBe(true);
    }
    expect(duree).toBeLessThan(50);
  });
});

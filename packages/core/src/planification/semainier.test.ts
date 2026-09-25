/**
 * Tests d'acceptation T06 — semainier : ce qu'il y a à faire dans une semaine ISO, tiré du plan.
 *
 * API attendue, exportée par `packages/core/src/planification/semainier.ts` :
 *
 *   interface EmplacementConcerne {
 *     readonly id: Id<'Emplacement'>;
 *     readonly code: string;          // Emplacement.code ('T2-P03')
 *     readonly zone: string;          // Zone.nom de la zone de l'emplacement ('Tunnel 2')
 *   }
 *
 *   interface SerieSemainier {          // vue d'une Serie (T01), jointe à l'espèce, la variété et
 *     readonly id: Id<'Serie'>;         // aux emplacements de ses occupations
 *     readonly statut: StatutSerie;
 *     readonly mode: ModeItineraire;    // Serie.parametres.mode : semis direct ou plantation
 *     readonly culture: string;         // Espece.nom
 *     readonly variete: string | null;  // Variete.nom
 *     readonly datesPrevues: DatesPrevuesSerie;   // Serie.datesPrevues (T02, avant recalage)
 *     readonly taille: TailleSerie;     // Serie.taille : longueur ou nombre de plants
 *     readonly emplacements: readonly EmplacementConcerne[];
 *   }
 *
 *   interface CampagneSemainier {       // vue d'une Campagne (T01) et de sa Plantation
 *     readonly id: Id<'Campagne'>;
 *     readonly culture: string;
 *     readonly variete: string | null;
 *     readonly debutRecoltePrevu: DateCalendaire | null;   // Campagne.debutRecoltePrevu
 *     readonly finRecoltePrevue: DateCalendaire | null;    // Campagne.finRecoltePrevue
 *     readonly nombrePlants: number;                       // Plantation.nombrePlants
 *     readonly emplacements: readonly EmplacementConcerne[];
 *   }
 *
 *   interface RealisesSemainier {
 *     readonly series: ReadonlyMap<Id<'Serie'>, RealisesSerie>;        // RealisesSerie de T02
 *     readonly campagnes: ReadonlyMap<Id<'Campagne'>, DateCalendaire>; // date de la 1re récolte saisie
 *   }
 *     L'appelant dérive ces réalisés du journal : événement 'realise' d'étape semis_pepiniere →
 *     semisPepiniere ; semis_direct ou plantation → miseEnPlace ; arrachage → finRecolte ; première
 *     récolte de la série → debutRecolte. Une série ou campagne absente des Map n'a aucun réalisé.
 *
 *   type EtapeTache = EtapeRealisee | 'debut_recolte'
 *     = 'semis_pepiniere' | 'semis_direct' | 'plantation' | 'arrachage' | 'debut_recolte'
 *
 *   interface TacheSemainier {
 *     readonly etape: EtapeTache;
 *     readonly cible: CultureConcernee;        // { sorte: 'serie', serieId } | { sorte: 'campagne', campagneId }
 *     readonly culture: string;
 *     readonly variete: string | null;
 *     readonly emplacements: readonly EmplacementConcerne[];   // triés par zone puis par code
 *     readonly taille: TailleSerie;            // campagne : { unite: 'plants', nombrePlants }
 *     readonly datePrevue: DateCalendaire;     // date recalée par les réalisés (appliquerRealises)
 *     readonly enRetard: boolean;
 *     readonly joursDeRetard: number;          // 0 quand la tâche n'est pas en retard
 *   }
 *
 *   semainier(
 *     semaine: SemaineIso,                     // { annee, semaine } ISO
 *     series: readonly SerieSemainier[],
 *     campagnes: readonly CampagneSemainier[],
 *     realises: RealisesSemainier,
 *     dateDuJour: DateCalendaire,
 *   ): readonly TacheSemainier[]               (pure : n'écrit dans aucune entrée)
 *
 * Responsabilités de l'appelant (le semainier ne les vérifie pas) :
 *   - écarter les lignes supprimées (`supprimeLe` renseigné) : séries, campagnes, emplacements ;
 *   - écarter les campagnes d'une plantation arrachée (`Plantation.dateArrachage` renseignée) ;
 *   - dériver les réalisés du journal en tenant compte des corrections et annulations.
 *
 * Règles :
 *   - Semaine demandée : du lundi `lundiDeSemaine(annee, semaine)` au dimanche (lundi + 6).
 *     Une semaine qui n'existe pas (S53 d'une année à 52 semaines) : RangeError.
 *   - Séries : seules 'prevue' et 'en_cours' comptent ; 'terminee' et 'abandonnee' n'apparaissent pas.
 *   - Dates d'une série = appliquerRealises(datesPrevues, réalisés de la série) : un réalisé en
 *     retard ou en avance décale la suite (T02).
 *   - Étapes d'une série → tâches :
 *       semisPepiniere → 'semis_pepiniere' (plant maison seulement : la clé est absente sinon)
 *       miseEnPlace    → 'semis_direct' si mode = 'semis_direct', sinon 'plantation'
 *       debutRecolte   → 'debut_recolte'
 *       finRecolte     → 'arrachage' (fin d'occupation)
 *     Campagne : une seule tâche 'debut_recolte' à `debutRecoltePrevu` ; rien si elle vaut null.
 *     Elle n'est plus listée une fois `finRecoltePrevue` passée (finRecoltePrevue < dateDuJour ;
 *     le jour même de la fin, elle l'est encore). `finRecoltePrevue` null : pas de borne.
 *   - Une tâche disparaît dès que son étape est réalisée (quelle que soit la date du réalisé).
 *   - Réalisé incohérent : une étape réalisée absente des dates prévues de la série (semis
 *     pépinière saisi sur un semis direct ou un plant acheté) est ignorée ; pas de RangeError,
 *     le semainier ne plante pas, les autres réalisés s'appliquent normalement.
 *   - DÉCISION PROVISOIRE (question à Théophane, PR #2) : une étape non saisie est considérée
 *     comme faite dès qu'une étape postérieure de la même série est réalisée. Plantation réalisée
 *     sans semis saisi : le semis pépinière n'apparaît ni dû ni en retard.
 *   - Retard : enRetard ⇔ datePrevue < dateDuJour (une tâche prévue aujourd'hui n'est pas en
 *     retard) ; joursDeRetard = dateDuJour − datePrevue en jours, 0 sinon.
 *   - Une tâche non réalisée figure dans la semaine si :
 *       · sa date prévue tombe dans la semaine (en retard ou non selon la date du jour), ou
 *       · sa date prévue est avant le lundi de la semaine ET elle est en retard.
 *     Une tâche d'avant la semaine mais pas encore en retard (on regarde une semaine future)
 *     n'y figure pas : elle reste dans sa propre semaine.
 *     Le retard se compte toujours par rapport à `dateDuJour`, jamais par rapport à la semaine
 *     consultée : une tâche du dimanche consultée le lundi suivant a 1 jour de retard.
 *     Semaine passée (son dimanche est avant la date du jour) : on y trouve ses propres tâches non
 *     réalisées, toutes en retard, et les retards d'avant son lundi. Une tâche prévue après son
 *     dimanche n'y figure jamais, même si elle est en retard aujourd'hui : elle apparaît dans sa
 *     propre semaine et dans les semaines suivantes.
 *     Pas de limite dans le temps : une tâche en retard reste listée tant qu'elle n'est pas
 *     réalisée (ou rendue caduque par une étape postérieure), ou que la série n'est pas passée
 *     'terminee' ou 'abandonnee'. On ne cache jamais en silence un travail oublié.
 *   - Ordre : en retard d'abord ; puis date prévue croissante ; puis zone, puis code du premier
 *     emplacement de la tâche (après tri de ses emplacements), en ordre naturel : les nombres
 *     comptent pour leur valeur ('T2-P9' avant 'T2-P10'). Une tâche sans emplacement passe après
 *     les autres à date égale. Puis l'étape : l'arrachage passe avant toute autre étape (on
 *     libère la planche avant de semer ou de planter), les autres suivent l'ordre chronologique
 *     (semis pépinière, semis direct ou plantation, début de récolte). Égalité restante :
 *     identifiant de la série ou de la campagne (ordre des chaînes). Le résultat ne dépend
 *     donc jamais de l'ordre d'entrée.
 *   - 3 000 séries traitées en moins de 30 ms.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ajouterJours, analyserDate, dateDepuisJourAbsolu, jourAbsolu, lundiDeSemaine } from '../dates/index.ts';
import type { DateCalendaire, SemaineIso } from '../dates/index.ts';
import type {
  CultureConcernee,
  DatesPrevuesSerie,
  EtapeRealisee,
  Id,
  ModeItineraire,
  NomEntite,
  StatutSerie,
  TailleSerie,
} from '../domaine/index.ts';
import { appliquerRealises, calculerDatesCampagne, calculerDatesSerie } from './dates-serie.ts';
import type { ParametresDatesSerie, RealisesSerie } from './dates-serie.ts';
import { semainier } from './semainier.ts';
import type {
  CampagneSemainier,
  EmplacementConcerne,
  EtapeTache,
  RealisesSemainier,
  SerieSemainier,
  TacheSemainier,
} from './semainier.ts';

// `types: []` dans tsconfig : l'horloge haute résolution de Node est déclarée ici.
declare const performance: { now(): number };

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

/** Fabrique une DateCalendaire pour les tests ; échoue si la chaîne est invalide. */
function d(saisie: string): DateCalendaire {
  const resultat = analyserDate(saisie);
  if (!resultat.ok) {
    throw new Error(`date de test invalide : ${saisie}`);
  }
  return resultat.date;
}

/** Identifiant lisible pour les tests (le format UUID v7 n'importe pas au semainier). */
function id<E extends NomEntite>(texte: string): Id<E> {
  return texte as Id<E>;
}

function emplacement(code: string, zone: string): EmplacementConcerne {
  return { id: id<'Emplacement'>(`emp-${code}`), code, zone };
}

const T2_P03 = emplacement('T2-P03', 'Tunnel 2');
const T2_P04 = emplacement('T2-P04', 'Tunnel 2');

/** Série de test : batavia en plant maison sur T2-P03 par défaut. */
function serie(
  nom: string,
  datesPrevues: DatesPrevuesSerie,
  options: Partial<Omit<SerieSemainier, 'id' | 'datesPrevues'>> = {},
): SerieSemainier {
  return {
    id: id<'Serie'>(nom),
    statut: 'prevue',
    mode: 'plant_maison',
    culture: 'Laitue',
    variete: 'Batavia blonde',
    taille: { unite: 'longueur', longueurM: 30 },
    emplacements: [T2_P03],
    datesPrevues,
    ...options,
  };
}

/** Dates ne portant qu'une mise en place à `date` : récolte bien plus tard, hors des semaines testées. */
function miseEnPlaceSeule(date: string): DatesPrevuesSerie {
  const miseEnPlace = d(date);
  return { miseEnPlace, debutRecolte: ajouterJours(miseEnPlace, 120), finRecolte: ajouterJours(miseEnPlace, 150) };
}

const AUCUN_REALISE: RealisesSemainier = { series: new Map(), campagnes: new Map() };

function realisesDe(entrees: readonly (readonly [string, RealisesSerie])[]): RealisesSemainier {
  return { series: new Map(entrees.map(([nom, r]) => [id<'Serie'>(nom), r])), campagnes: new Map() };
}

function s(annee: number, semaine: number): SemaineIso {
  return { annee, semaine };
}

/** Résumé d'une tâche pour des comparaisons lisibles. */
function resume(t: TacheSemainier): string {
  const cible = t.cible.sorte === 'serie' ? t.cible.serieId : t.cible.campagneId;
  return `${cible}:${t.etape}:${t.datePrevue}${t.enRetard ? `:retard ${String(t.joursDeRetard)}` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Batavia de T02 : plant maison, pépinière 28 j, 49 j avant récolte, 14 j de fenêtre
// ---------------------------------------------------------------------------------------------

const BATAVIA: ParametresDatesSerie = {
  mode: 'plant_maison',
  dureePepiniereJours: 28,
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
};

/** Semis 2027-03-08 (S10), plantation 2027-04-05 (S14), récolte 2027-05-24 (S21) → 2027-06-07 (S23). */
const BATAVIA_PREVU = calculerDatesSerie(BATAVIA, { type: 'plantation', date: d('2027-04-05') });

const batavia = serie('batavia', BATAVIA_PREVU);

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

describe('types du module', () => {
  it('la signature est celle documentée', () => {
    expectTypeOf(semainier).parameters.toEqualTypeOf<
      [SemaineIso, readonly SerieSemainier[], readonly CampagneSemainier[], RealisesSemainier, DateCalendaire]
    >();
    expectTypeOf(semainier).returns.toEqualTypeOf<readonly TacheSemainier[]>();
  });

  it('les entrées réutilisent les types du domaine et de T02', () => {
    expectTypeOf<EmplacementConcerne>().toEqualTypeOf<{
      readonly id: Id<'Emplacement'>;
      readonly code: string;
      readonly zone: string;
    }>();
    expectTypeOf<SerieSemainier>().toEqualTypeOf<{
      readonly id: Id<'Serie'>;
      readonly statut: StatutSerie;
      readonly mode: ModeItineraire;
      readonly culture: string;
      readonly variete: string | null;
      readonly datesPrevues: DatesPrevuesSerie;
      readonly taille: TailleSerie;
      readonly emplacements: readonly EmplacementConcerne[];
    }>();
    expectTypeOf<CampagneSemainier>().toEqualTypeOf<{
      readonly id: Id<'Campagne'>;
      readonly culture: string;
      readonly variete: string | null;
      readonly debutRecoltePrevu: DateCalendaire | null;
      readonly finRecoltePrevue: DateCalendaire | null;
      readonly nombrePlants: number;
      readonly emplacements: readonly EmplacementConcerne[];
    }>();
    expectTypeOf<RealisesSemainier>().toEqualTypeOf<{
      readonly series: ReadonlyMap<Id<'Serie'>, RealisesSerie>;
      readonly campagnes: ReadonlyMap<Id<'Campagne'>, DateCalendaire>;
    }>();
  });

  it('la forme de la tâche', () => {
    expectTypeOf<EtapeTache>().toEqualTypeOf<EtapeRealisee | 'debut_recolte'>();
    expectTypeOf<TacheSemainier>().toEqualTypeOf<{
      readonly etape: EtapeTache;
      readonly cible: CultureConcernee;
      readonly culture: string;
      readonly variete: string | null;
      readonly emplacements: readonly EmplacementConcerne[];
      readonly taille: TailleSerie;
      readonly datePrevue: DateCalendaire;
      readonly enRetard: boolean;
      readonly joursDeRetard: number;
    }>();
  });
});

// ---------------------------------------------------------------------------------------------
// Critères du ticket
// ---------------------------------------------------------------------------------------------

describe('batavia de T02 : une tâche par étape, dans sa semaine', () => {
  const avantTout = d('2027-03-01');

  it('semis pépinière en 2027-S10, avec toute la tâche', () => {
    expect(semainier(s(2027, 10), [batavia], [], AUCUN_REALISE, avantTout)).toStrictEqual([
      {
        etape: 'semis_pepiniere',
        cible: { sorte: 'serie', serieId: id<'Serie'>('batavia') },
        culture: 'Laitue',
        variete: 'Batavia blonde',
        emplacements: [T2_P03],
        taille: { unite: 'longueur', longueurM: 30 },
        datePrevue: d('2027-03-08'),
        enRetard: false,
        joursDeRetard: 0,
      },
    ]);
  });

  it('plantation en 2027-S14', () => {
    expect(semainier(s(2027, 14), [batavia], [], AUCUN_REALISE, avantTout).map(resume)).toStrictEqual([
      'batavia:plantation:2027-04-05',
    ]);
  });

  it('début de récolte en 2027-S21', () => {
    expect(semainier(s(2027, 21), [batavia], [], AUCUN_REALISE, avantTout).map(resume)).toStrictEqual([
      'batavia:debut_recolte:2027-05-24',
    ]);
  });

  it('arrachage (fin de récolte, fin d’occupation) en 2027-S23', () => {
    expect(semainier(s(2027, 23), [batavia], [], AUCUN_REALISE, avantTout).map(resume)).toStrictEqual([
      'batavia:arrachage:2027-06-07',
    ]);
  });

  it('rien les autres semaines (S09, S11, S13, S22, S24)', () => {
    for (const semaine of [9, 11, 13, 22, 24]) {
      expect(semainier(s(2027, semaine), [batavia], [], AUCUN_REALISE, avantTout)).toStrictEqual([]);
    }
  });

  it('semis direct : la mise en place est une tâche « semis_direct », sans semis pépinière', () => {
    const radis = serie('radis', calculerDatesSerie({ mode: 'semis_direct', dureeAvantRecolteJours: 28, fenetreRecolteJours: 7 }, { type: 'semis', date: d('2027-04-06') }), {
      mode: 'semis_direct',
      culture: 'Radis',
      variete: null,
    });
    expect(semainier(s(2027, 14), [radis], [], AUCUN_REALISE, avantTout).map(resume)).toStrictEqual([
      'radis:semis_direct:2027-04-06',
    ]);
  });

  it('plant acheté : la mise en place est une plantation, sans semis pépinière', () => {
    const tomate = serie('tomate', miseEnPlaceSeule('2027-04-07'), { mode: 'plant_achete', culture: 'Tomate' });
    expect(semainier(s(2027, 14), [tomate], [], AUCUN_REALISE, avantTout).map(resume)).toStrictEqual([
      'tomate:plantation:2027-04-07',
    ]);
  });

  it('une taille en nombre de plants est reprise telle quelle', () => {
    const enPlants = serie('plants', BATAVIA_PREVU, { taille: { unite: 'plants', nombrePlants: 450 } });
    const [tache] = semainier(s(2027, 14), [enPlants], [], AUCUN_REALISE, avantTout);
    expect(tache?.taille).toStrictEqual({ unite: 'plants', nombrePlants: 450 });
  });
});

describe('réalisés : une tâche disparaît dès que son étape est réalisée', () => {
  it('plantation réalisée (le 2027-04-06) : la tâche de S14 disparaît', () => {
    const realises = realisesDe([['batavia', { semisPepiniere: d('2027-03-08'), miseEnPlace: d('2027-04-06') }]]);
    expect(semainier(s(2027, 14), [batavia], [], realises, d('2027-04-06'))).toStrictEqual([]);
  });

  it('plantation réalisée en avance, la semaine d’avant : rien en S14', () => {
    const realises = realisesDe([['batavia', { semisPepiniere: d('2027-03-08'), miseEnPlace: d('2027-04-01') }]]);
    expect(semainier(s(2027, 14), [batavia], [], realises, d('2027-04-06'))).toStrictEqual([]);
  });

  it('début de récolte et arrachage réalisés : plus de tâche de récolte ni d’arrachage', () => {
    const realises = realisesDe([
      [
        'batavia',
        {
          semisPepiniere: d('2027-03-08'),
          miseEnPlace: d('2027-04-05'),
          debutRecolte: d('2027-05-24'),
          finRecolte: d('2027-06-07'),
        },
      ],
    ]);
    for (const semaine of [10, 14, 21, 23, 30]) {
      expect(semainier(s(2027, semaine), [batavia], [], realises, d('2027-07-26'))).toStrictEqual([]);
    }
  });

  it('réalisé incohérent (semis pépinière saisi sur un semis direct) : ignoré, pas de RangeError', () => {
    const radis = serie('radis', miseEnPlaceSeule('2027-04-06'), { mode: 'semis_direct', culture: 'Radis' });
    const seul = realisesDe([['radis', { semisPepiniere: d('2027-03-01') }]]);
    expect(() => semainier(s(2027, 14), [radis], [], seul, d('2027-04-06'))).not.toThrow();
    expect(semainier(s(2027, 14), [radis], [], seul, d('2027-04-06')).map(resume)).toStrictEqual([
      'radis:semis_direct:2027-04-06',
    ]);
  });

  it('réalisé incohérent à côté d’un réalisé valable : seul le valable compte et décale la suite', () => {
    const radis = serie(
      'radis',
      calculerDatesSerie({ mode: 'semis_direct', dureeAvantRecolteJours: 28, fenetreRecolteJours: 7 }, { type: 'semis', date: d('2027-04-06') }),
      { mode: 'semis_direct', culture: 'Radis' },
    );
    // Semis direct réalisé 2 jours en retard : début de récolte du 2027-05-04 au 2027-05-06 (S18).
    const r = realisesDe([['radis', { semisPepiniere: d('2027-03-01'), miseEnPlace: d('2027-04-08') }]]);
    expect(semainier(s(2027, 14), [radis], [], r, d('2027-04-08'))).toStrictEqual([]);
    expect(semainier(s(2027, 18), [radis], [], r, d('2027-04-08')).map(resume)).toStrictEqual([
      'radis:debut_recolte:2027-05-06',
    ]);
  });

  it('un réalisé d’une autre série ne retire rien', () => {
    const realises = realisesDe([['autre', { semisPepiniere: d('2027-03-08'), miseEnPlace: d('2027-04-05') }]]);
    expect(semainier(s(2027, 14), [batavia], [], realises, d('2027-03-01')).map(resume)).toStrictEqual([
      'batavia:plantation:2027-04-05',
    ]);
  });
});

describe('retard', () => {
  it('plantation non faite : en retard en S15 avec 7 jours (date du jour 2027-04-12)', () => {
    const realises = realisesDe([['batavia', { semisPepiniere: d('2027-03-08') }]]);
    const taches = semainier(s(2027, 15), [batavia], [], realises, d('2027-04-12'));
    expect(taches).toHaveLength(1);
    expect(taches[0]).toMatchObject({
      etape: 'plantation',
      datePrevue: d('2027-04-05'),
      enRetard: true,
      joursDeRetard: 7,
    });
  });

  it('rien de saisi : semis et plantation en retard en S15, le plus ancien d’abord', () => {
    expect(semainier(s(2027, 15), [batavia], [], AUCUN_REALISE, d('2027-04-12')).map(resume)).toStrictEqual([
      'batavia:semis_pepiniere:2027-03-08:retard 35',
      'batavia:plantation:2027-04-05:retard 7',
    ]);
  });

  it('pas de limite dans le temps : la plantation oubliée reste listée en retard des mois après', () => {
    const realises = realisesDe([['batavia', { semisPepiniere: d('2027-03-08') }]]);
    const taches = semainier(s(2027, 40), [batavia], [], realises, d('2027-10-04'));
    // Plantation, début de récolte et arrachage : tous en retard, aucun n'a été saisi.
    expect(taches.map(resume)).toStrictEqual([
      'batavia:plantation:2027-04-05:retard 182',
      'batavia:debut_recolte:2027-05-24:retard 133',
      'batavia:arrachage:2027-06-07:retard 119',
    ]);
  });

  it('une tâche prévue aujourd’hui n’est pas en retard', () => {
    const [tache] = semainier(s(2027, 14), [batavia], [], realisesDe([['batavia', { semisPepiniere: d('2027-03-08') }]]), d('2027-04-05'));
    expect(tache).toMatchObject({ etape: 'plantation', enRetard: false, joursDeRetard: 0 });
  });

  it('dans la semaine, une tâche dont la date est passée est en retard (consultée un mercredi)', () => {
    const realises = realisesDe([['batavia', { semisPepiniere: d('2027-03-08') }]]);
    const [tache] = semainier(s(2027, 14), [batavia], [], realises, d('2027-04-07'));
    expect(tache).toMatchObject({ etape: 'plantation', datePrevue: d('2027-04-05'), enRetard: true, joursDeRetard: 2 });
  });

  it('semaine future : une tâche d’avant son lundi mais pas encore due n’y figure pas', () => {
    // Aujourd'hui 2027-03-01 : le semis (S10) n'est pas en retard, il ne remonte pas en S14.
    expect(semainier(s(2027, 14), [batavia], [], AUCUN_REALISE, d('2027-03-01')).map(resume)).toStrictEqual([
      'batavia:plantation:2027-04-05',
    ]);
  });

  it('borne du lundi : tâche du dimanche d’avant, consultée le lundi : 1 jour de retard', () => {
    const tomate = serie('tomate', miseEnPlaceSeule('2027-04-04'), { mode: 'plant_achete', culture: 'Tomate' });
    expect(semainier(s(2027, 14), [tomate], [], AUCUN_REALISE, d('2027-04-05')).map(resume)).toStrictEqual([
      'tomate:plantation:2027-04-04:retard 1',
    ]);
  });

  it('semaine passée (S12 consultée en S16) : ses tâches et les retards d’avant, jamais celles d’après son dimanche', () => {
    // Batavia : semis S10 (en retard, d'avant le lundi de S12), plantation S14 (après le dimanche
    // de S12 : absente de S12 bien qu'en retard aujourd'hui). Poireau : plantation en S12.
    const poireau = serie('poireau', miseEnPlaceSeule('2027-03-24'), { mode: 'plant_achete', culture: 'Poireau' });
    expect(semainier(s(2027, 12), [batavia, poireau], [], AUCUN_REALISE, d('2027-04-20')).map(resume)).toStrictEqual([
      'batavia:semis_pepiniere:2027-03-08:retard 43',
      'poireau:plantation:2027-03-24:retard 27',
    ]);
  });

  it('semaine passée : ses tâches non faites sont en retard par rapport à aujourd’hui', () => {
    expect(semainier(s(2027, 10), [batavia], [], AUCUN_REALISE, d('2027-04-12')).map(resume)).toStrictEqual([
      'batavia:semis_pepiniere:2027-03-08:retard 35',
    ]);
  });
});

describe('DÉCISION PROVISOIRE (question à Théophane, PR #2) : une étape postérieure réalisée vaut pour les étapes antérieures non saisies', () => {
  it('plantation réalisée sans semis saisi : le semis pépinière n’est ni dû ni en retard', () => {
    const realises = realisesDe([['batavia', { miseEnPlace: d('2027-04-05') }]]);
    expect(semainier(s(2027, 15), [batavia], [], realises, d('2027-04-12'))).toStrictEqual([]);
    expect(semainier(s(2027, 10), [batavia], [], realises, d('2027-04-12'))).toStrictEqual([]);
  });

  it('début de récolte réalisé sans rien d’autre : ni semis ni plantation en retard, l’arrachage reste', () => {
    const realises = realisesDe([['batavia', { debutRecolte: d('2027-05-24') }]]);
    expect(semainier(s(2027, 23), [batavia], [], realises, d('2027-06-01')).map(resume)).toStrictEqual([
      'batavia:arrachage:2027-06-07',
    ]);
  });

  it('arrachage réalisé : plus aucune tâche pour la série', () => {
    const realises = realisesDe([['batavia', { finRecolte: d('2027-06-07') }]]);
    expect(semainier(s(2027, 30), [batavia], [], realises, d('2027-07-26'))).toStrictEqual([]);
  });
});

describe('un réalisé décale la suite (appliquerRealises de T02)', () => {
  const realises = realisesDe([['batavia', { semisPepiniere: d('2027-03-08'), miseEnPlace: d('2027-04-12') }]]);
  const recalees = appliquerRealises(BATAVIA_PREVU, { semisPepiniere: d('2027-03-08'), miseEnPlace: d('2027-04-12') });

  it('plantation réalisée avec 7 jours de retard : le début de récolte passe de S21 à S22', () => {
    expect(recalees.debutRecolte).toBe('2027-05-31');
    expect(semainier(s(2027, 21), [batavia], [], realises, d('2027-04-12'))).toStrictEqual([]);
    expect(semainier(s(2027, 22), [batavia], [], realises, d('2027-04-12')).map(resume)).toStrictEqual([
      'batavia:debut_recolte:2027-05-31',
    ]);
  });

  it('l’arrachage glisse aussi, de S23 à S24', () => {
    expect(recalees.finRecolte).toBe('2027-06-14');
    expect(semainier(s(2027, 23), [batavia], [], realises, d('2027-04-12'))).toStrictEqual([]);
    expect(semainier(s(2027, 24), [batavia], [], realises, d('2027-04-12')).map(resume)).toStrictEqual([
      'batavia:arrachage:2027-06-14',
    ]);
  });

  it('le retard se compte depuis la date recalée', () => {
    // Début de récolte recalé au 2027-05-31, consulté en S23 le 2027-06-07 : 7 jours.
    expect(semainier(s(2027, 23), [batavia], [], realises, d('2027-06-07')).map(resume)).toStrictEqual([
      'batavia:debut_recolte:2027-05-31:retard 7',
    ]);
  });
});

describe('semaine 53 de 2026 (du lundi 2026-12-28 au dimanche 2027-01-03)', () => {
  const avant = serie('dimanche-s52', miseEnPlaceSeule('2026-12-27'), { mode: 'plant_achete' });
  const lundi = serie('lundi-s53', miseEnPlaceSeule('2026-12-28'), { mode: 'plant_achete' });
  const nouvelAn = serie('nouvel-an', miseEnPlaceSeule('2027-01-01'), { mode: 'plant_achete' });
  const dimanche = serie('dimanche-s53', miseEnPlaceSeule('2027-01-03'), { mode: 'plant_achete' });
  const apres = serie('lundi-s01', miseEnPlaceSeule('2027-01-04'), { mode: 'plant_achete' });
  const toutes = [avant, lundi, nouvelAn, dimanche, apres];

  it('2026 a bien une semaine 53 qui commence le 2026-12-28', () => {
    expect(lundiDeSemaine(2026, 53)).toBe('2026-12-28');
  });

  it('elle contient les tâches du 2026-12-28 au 2027-01-03, à cheval sur le nouvel an', () => {
    expect(semainier(s(2026, 53), toutes, [], AUCUN_REALISE, d('2026-12-01')).map(resume)).toStrictEqual([
      'lundi-s53:plantation:2026-12-28',
      'nouvel-an:plantation:2027-01-01',
      'dimanche-s53:plantation:2027-01-03',
    ]);
  });

  it('la tâche du 2027-01-01 n’est pas dans 2027-S01', () => {
    expect(semainier(s(2027, 1), toutes, [], AUCUN_REALISE, d('2026-12-01')).map(resume)).toStrictEqual([
      'lundi-s01:plantation:2027-01-04',
    ]);
  });

  it('2027 n’a pas de semaine 53 : RangeError', () => {
    expect(() => semainier(s(2027, 53), toutes, [], AUCUN_REALISE, d('2027-12-01'))).toThrow(RangeError);
  });
});

describe('statut de la série', () => {
  const statuts: readonly StatutSerie[] = ['prevue', 'en_cours', 'terminee', 'abandonnee'];
  const series = statuts.map((statut) => serie(statut, BATAVIA_PREVU, { statut }));

  it('une série abandonnée est absente', () => {
    const abandonnee = serie('abandonnee', BATAVIA_PREVU, { statut: 'abandonnee' });
    expect(semainier(s(2027, 14), [abandonnee], [], AUCUN_REALISE, d('2027-03-01'))).toStrictEqual([]);
    // Même en retard : une série abandonnée ne remonte jamais.
    expect(semainier(s(2027, 20), [abandonnee], [], AUCUN_REALISE, d('2027-05-17'))).toStrictEqual([]);
  });

  it('seules les séries prévues et en cours apparaissent (terminée : absente aussi)', () => {
    // Égalité complète : départage par identifiant ('en_cours' < 'prevue').
    expect(semainier(s(2027, 14), series, [], AUCUN_REALISE, d('2027-03-01')).map(resume)).toStrictEqual([
      'en_cours:plantation:2027-04-05',
      'prevue:plantation:2027-04-05',
    ]);
  });
});

describe('ordre : en retard, puis date, puis zone et code d’emplacement', () => {
  const tunnel = (code: string): EmplacementConcerne => emplacement(code, 'Tunnel 2');
  const achete = { mode: 'plant_achete' } as const;
  const series: readonly SerieSemainier[] = [
    // Dans la semaine, le 2027-04-07 : début de récolte (plantation déjà réalisée).
    serie('F-recolte-0407', { miseEnPlace: d('2027-02-01'), debutRecolte: d('2027-04-07'), finRecolte: d('2027-06-01') }, {
      ...achete,
      emplacements: [emplacement('A-01', 'Abri')],
    }),
    // Dans la semaine, le 2027-04-05, sans emplacement : après les autres du même jour.
    serie('H-sans-emplacement', miseEnPlaceSeule('2027-04-05'), { ...achete, emplacements: [] }),
    // Dans la semaine, le 2027-04-05 : Tunnel 2, T2-P10.
    serie('C-T2-P10', miseEnPlaceSeule('2027-04-05'), { ...achete, emplacements: [tunnel('T2-P10')] }),
    // Dans la semaine, le 2027-04-05 : Tunnel 2, T2-P9 (ordre naturel : 9 avant 10).
    serie('D-T2-P9', miseEnPlaceSeule('2027-04-05'), { ...achete, emplacements: [tunnel('T2-P9')] }),
    // Dans la semaine, le 2027-04-05 : deux planches données dans le désordre ; la clé est T2-P2.
    serie('G-T2-P2-P12', miseEnPlaceSeule('2027-04-05'), { ...achete, emplacements: [tunnel('T2-P12'), tunnel('T2-P2')] }),
    // Dans la semaine, le 2027-04-05 : zone « Serre », avant « Tunnel 2 ».
    serie('E-serre', miseEnPlaceSeule('2027-04-05'), { ...achete, emplacements: [emplacement('S-01', 'Serre')] }),
    // En retard : semis direct du 2027-03-31 (5 jours).
    serie('B-retard-0331', miseEnPlaceSeule('2027-03-31'), {
      mode: 'semis_direct',
      emplacements: [emplacement('A-01', 'Abri')],
    }),
    // En retard : plantation du 2027-03-29 (7 jours), la plus ancienne.
    serie('A-retard-0329', miseEnPlaceSeule('2027-03-29'), { ...achete, emplacements: [tunnel('T2-P10')] }),
  ];
  const realises = realisesDe([['F-recolte-0407', { miseEnPlace: d('2027-02-01') }]]);

  it('ordre complet de la semaine 2027-S14 consultée le lundi 2027-04-05', () => {
    expect(semainier(s(2027, 14), series, [], realises, d('2027-04-05')).map(resume)).toStrictEqual([
      'A-retard-0329:plantation:2027-03-29:retard 7',
      'B-retard-0331:semis_direct:2027-03-31:retard 5',
      'E-serre:plantation:2027-04-05',
      'G-T2-P2-P12:plantation:2027-04-05',
      'D-T2-P9:plantation:2027-04-05',
      'C-T2-P10:plantation:2027-04-05',
      'H-sans-emplacement:plantation:2027-04-05',
      'F-recolte-0407:debut_recolte:2027-04-07',
    ]);
  });

  it('les emplacements d’une tâche sont triés par zone puis par code', () => {
    const taches = semainier(s(2027, 14), series, [], realises, d('2027-04-05'));
    const g = taches.find((t) => t.cible.sorte === 'serie' && t.cible.serieId === id<'Serie'>('G-T2-P2-P12'));
    expect(g?.emplacements.map((e) => e.code)).toStrictEqual(['T2-P2', 'T2-P12']);
  });

  it('l’ordre ne dépend pas de l’ordre des séries en entrée', () => {
    const a = semainier(s(2027, 14), series, [], realises, d('2027-04-05'));
    const b = semainier(s(2027, 14), [...series].reverse(), [], realises, d('2027-04-05'));
    expect(b.map(resume)).toStrictEqual(a.map(resume));
  });

  it('même date et même emplacement : l’arrachage passe avant le semis et la plantation', () => {
    // Changement après relecture : on libère la planche avant de semer ou de planter. Semis direct
    // et plantation le 2027-04-05 de deux séries, arrachage le même jour d'une troisième, même planche.
    const arrachage = serie('arrachage', { miseEnPlace: d('2027-01-04'), debutRecolte: d('2027-03-01'), finRecolte: d('2027-04-05') }, { ...achete, emplacements: [T2_P04] });
    const semis = serie('semis', miseEnPlaceSeule('2027-04-05'), { mode: 'semis_direct', emplacements: [T2_P04] });
    const plantation = serie('plantation', miseEnPlaceSeule('2027-04-05'), { ...achete, emplacements: [T2_P04] });
    const r = realisesDe([['arrachage', { miseEnPlace: d('2027-01-04'), debutRecolte: d('2027-03-01') }]]);
    const attendu = [
      'arrachage:arrachage:2027-04-05',
      // Semis direct et plantation ont le même rang : départage par identifiant.
      'plantation:plantation:2027-04-05',
      'semis:semis_direct:2027-04-05',
    ];
    expect(semainier(s(2027, 14), [semis, plantation, arrachage], [], r, d('2027-04-05')).map(resume)).toStrictEqual(attendu);
    expect(semainier(s(2027, 14), [arrachage, plantation, semis], [], r, d('2027-04-05')).map(resume)).toStrictEqual(attendu);
  });

  it('égalité complète : départage par identifiant, quel que soit l’ordre d’entrée', () => {
    // Même étape (début de récolte), même date, même planche : deux séries et une campagne.
    const recolte = { miseEnPlace: d('2027-02-01'), debutRecolte: d('2027-04-07'), finRecolte: d('2027-06-01') };
    const zz = serie('zz', recolte, achete);
    const aa = serie('aa', recolte, achete);
    const mm: CampagneSemainier = {
      id: id<'Campagne'>('mm'),
      culture: 'Fraise',
      variete: null,
      debutRecoltePrevu: d('2027-04-07'),
      finRecoltePrevue: d('2027-06-30'),
      nombrePlants: 200,
      emplacements: [T2_P03],
    };
    const nn: CampagneSemainier = { ...mm, id: id<'Campagne'>('nn') };
    const r = realisesDe([
      ['zz', { miseEnPlace: d('2027-02-01') }],
      ['aa', { miseEnPlace: d('2027-02-01') }],
    ]);
    const attendu = [
      'aa:debut_recolte:2027-04-07',
      'mm:debut_recolte:2027-04-07',
      'nn:debut_recolte:2027-04-07',
      'zz:debut_recolte:2027-04-07',
    ];
    expect(semainier(s(2027, 14), [zz, aa], [nn, mm], r, d('2027-04-05')).map(resume)).toStrictEqual(attendu);
    expect(semainier(s(2027, 14), [aa, zz], [mm, nn], r, d('2027-04-05')).map(resume)).toStrictEqual(attendu);
  });
});

describe('campagne de pérenne : début de récolte', () => {
  // Asperges plantées en 2024, 2 ans d'attente, récolte S15 à S24 : campagne 2027 du 2027-04-12.
  const dates = calculerDatesCampagne(
    {
      datePlantation: d('2024-03-01'),
      perenne: {
        anneesAvantPremiereRecolte: 2,
        periodeRecolteAnnuelle: { semaineDebut: 15, semaineFin: 24 },
        rendementParPlantParAn: null,
      },
    },
    2027,
  );
  const aspergeraie = emplacement('V-R01', 'Verger');
  const asperges: CampagneSemainier = {
    id: id<'Campagne'>('asperges-2027'),
    culture: 'Asperge',
    variete: 'Argenteuil',
    debutRecoltePrevu: dates?.debutRecolte ?? null,
    finRecoltePrevue: dates?.finRecolte ?? null,
    nombrePlants: 400,
    emplacements: [aspergeraie],
  };

  it('la campagne 2027 va du 2027-04-12 au 2027-06-20 (T02)', () => {
    expect(dates?.debutRecolte).toBe('2027-04-12');
    expect(dates?.finRecolte).toBe('2027-06-20');
  });

  it('une tâche « début de récolte » en S15, avec le nombre de plants', () => {
    expect(semainier(s(2027, 15), [], [asperges], AUCUN_REALISE, d('2027-04-01'))).toStrictEqual([
      {
        etape: 'debut_recolte',
        cible: { sorte: 'campagne', campagneId: id<'Campagne'>('asperges-2027') },
        culture: 'Asperge',
        variete: 'Argenteuil',
        emplacements: [aspergeraie],
        taille: { unite: 'plants', nombrePlants: 400 },
        datePrevue: d('2027-04-12'),
        enRetard: false,
        joursDeRetard: 0,
      },
    ]);
  });

  it('pas d’arrachage ni d’autre étape pour une campagne', () => {
    for (const semaine of [14, 16, 24, 25]) {
      expect(semainier(s(2027, semaine), [], [asperges], AUCUN_REALISE, d('2027-04-01'))).toStrictEqual([]);
    }
  });

  it('non commencée : en retard en S16 (7 jours le 2027-04-19)', () => {
    expect(semainier(s(2027, 16), [], [asperges], AUCUN_REALISE, d('2027-04-19')).map(resume)).toStrictEqual([
      'asperges-2027:debut_recolte:2027-04-12:retard 7',
    ]);
  });

  it('première récolte saisie : la tâche disparaît', () => {
    const realises: RealisesSemainier = {
      series: new Map(),
      campagnes: new Map([[id<'Campagne'>('asperges-2027'), d('2027-04-14')]]),
    };
    expect(semainier(s(2027, 15), [], [asperges], realises, d('2027-04-14'))).toStrictEqual([]);
    expect(semainier(s(2027, 16), [], [asperges], realises, d('2027-04-19'))).toStrictEqual([]);
  });

  it('le dernier jour de récolte prévu, la tâche non commencée est encore listée', () => {
    expect(semainier(s(2027, 24), [], [asperges], AUCUN_REALISE, d('2027-06-20')).map(resume)).toStrictEqual([
      'asperges-2027:debut_recolte:2027-04-12:retard 69',
    ]);
  });

  it('une fois la fin de récolte prévue passée, la tâche n’est plus listée', () => {
    expect(semainier(s(2027, 25), [], [asperges], AUCUN_REALISE, d('2027-06-21'))).toStrictEqual([]);
  });

  it('asperges de la campagne 2025 jamais récoltées, consultées en 2027-S40 : absentes', () => {
    const dates2025 = calculerDatesCampagne(
      {
        datePlantation: d('2023-03-01'),
        perenne: {
          anneesAvantPremiereRecolte: 2,
          periodeRecolteAnnuelle: { semaineDebut: 15, semaineFin: 24 },
          rendementParPlantParAn: null,
        },
      },
      2025,
    );
    expect(dates2025).toStrictEqual({ debutRecolte: d('2025-04-07'), finRecolte: d('2025-06-15') });
    const asperges2025: CampagneSemainier = {
      ...asperges,
      id: id<'Campagne'>('asperges-2025'),
      debutRecoltePrevu: dates2025?.debutRecolte ?? null,
      finRecoltePrevue: dates2025?.finRecolte ?? null,
    };
    expect(semainier(s(2027, 40), [], [asperges2025], AUCUN_REALISE, d('2027-10-04'))).toStrictEqual([]);
  });

  it('sans fin de récolte prévue (null) : pas de borne, la tâche en retard reste listée', () => {
    const sansFin: CampagneSemainier = { ...asperges, finRecoltePrevue: null };
    expect(semainier(s(2027, 40), [], [sansFin], AUCUN_REALISE, d('2027-10-04')).map(resume)).toStrictEqual([
      'asperges-2027:debut_recolte:2027-04-12:retard 175',
    ]);
  });

  it('sans date de récolte prévue (null) : aucune tâche', () => {
    const sansRecolte: CampagneSemainier = { ...asperges, debutRecoltePrevu: null };
    expect(semainier(s(2027, 15), [], [sansRecolte], AUCUN_REALISE, d('2027-04-12'))).toStrictEqual([]);
  });

  it('séries et campagnes se mêlent dans le même ordre', () => {
    const realises = realisesDe([['batavia', { semisPepiniere: d('2027-03-08') }]]);
    expect(semainier(s(2027, 15), [batavia], [asperges], realises, d('2027-04-12')).map(resume)).toStrictEqual([
      'batavia:plantation:2027-04-05:retard 7',
      'asperges-2027:debut_recolte:2027-04-12',
    ]);
  });
});

describe('pureté', () => {
  it('ne modifie pas ses entrées et répond pareil à chaque appel', () => {
    const series = [batavia, serie('radis', miseEnPlaceSeule('2027-04-06'), { mode: 'semis_direct', emplacements: [T2_P04, T2_P03] })];
    const realises = realisesDe([['batavia', { semisPepiniere: d('2027-03-10') }]]);
    const avant = JSON.stringify({ series, realises: [...realises.series.entries()] });
    const premier = semainier(s(2027, 14), series, [], realises, d('2027-04-07'));
    const second = semainier(s(2027, 14), series, [], realises, d('2027-04-07'));
    expect(JSON.stringify({ series, realises: [...realises.series.entries()] })).toBe(avant);
    expect(second).toStrictEqual(premier);
  });
});

// ---------------------------------------------------------------------------------------------
// Performance : 3 000 séries en moins de 30 ms
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

describe('performance', () => {
  const NOMBRE = 3000;
  const hasard = generateur(20270412);
  const zones = ['Tunnel 1', 'Tunnel 2', 'Serre', 'Plein champ', 'Verger'];
  const modes: readonly ParametresDatesSerie['mode'][] = ['semis_direct', 'plant_maison', 'plant_achete'];
  const statuts: readonly StatutSerie[] = ['prevue', 'prevue', 'en_cours', 'en_cours', 'terminee', 'abandonnee'];
  const debut2027 = jourAbsolu(d('2027-01-01'));

  const series: SerieSemainier[] = [];
  const realises = new Map<Id<'Serie'>, RealisesSerie>();
  for (let i = 0; i < NOMBRE; i++) {
    const mode = modes[hasard(modes.length - 1)] ?? 'plant_maison';
    const parametres: ParametresDatesSerie =
      mode === 'plant_maison'
        ? { mode, dureePepiniereJours: 14 + hasard(40), dureeAvantRecolteJours: 20 + hasard(100), fenetreRecolteJours: hasard(60) }
        : { mode, dureeAvantRecolteJours: 20 + hasard(100), fenetreRecolteJours: hasard(60) };
    const datesPrevues = calculerDatesSerie(parametres, { type: 'plantation', date: dateDepuisJourAbsolu(debut2027 + hasard(300)) });
    const zone = zones[hasard(zones.length - 1)] ?? 'Tunnel 1';
    const nombreEmplacements = 1 + hasard(2);
    const emplacements = Array.from({ length: nombreEmplacements }, () => emplacement(`${zone.slice(0, 2)}-P${String(1 + hasard(40))}`, zone));
    const serieId = id<'Serie'>(`serie-${String(i)}`);
    series.push({
      id: serieId,
      statut: statuts[hasard(statuts.length - 1)] ?? 'prevue',
      mode,
      culture: `Culture ${String(hasard(30))}`,
      variete: hasard(3) === 0 ? null : `Variété ${String(hasard(50))}`,
      datesPrevues,
      taille: hasard(1) === 0 ? { unite: 'longueur', longueurM: 5 + hasard(25) } : { unite: 'plants', nombrePlants: 50 + hasard(500) },
      emplacements,
    });
    // Une série sur trois a sa mise en place saisie, avec un écart de −3 à +10 jours.
    if (hasard(2) === 0) {
      realises.set(serieId, { miseEnPlace: ajouterJours(datesPrevues.miseEnPlace, hasard(13) - 3) });
    }
  }
  const entrees: RealisesSemainier = { series: realises, campagnes: new Map() };
  const semaine = s(2027, 20);
  const aujourdhui = d('2027-05-19');

  it(`${String(NOMBRE)} séries traitées en moins de 30 ms (meilleure de 5 mesures après échauffement)`, () => {
    // Échauffement : laisse le moteur JavaScript compiler le code chaud.
    for (let i = 0; i < 3; i++) {
      semainier(semaine, series, [], entrees, aujourdhui);
    }
    let meilleure = Number.POSITIVE_INFINITY;
    let taches: readonly TacheSemainier[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      taches = semainier(semaine, series, [], entrees, aujourdhui);
      meilleure = Math.min(meilleure, performance.now() - t0);
    }
    // Le jeu produit bien du travail : des tâches de la semaine et des retards.
    expect(taches.some((t) => t.enRetard)).toBe(true);
    expect(taches.some((t) => !t.enRetard)).toBe(true);
    expect(meilleure).toBeLessThan(30);
  });
});

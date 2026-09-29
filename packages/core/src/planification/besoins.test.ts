/**
 * Tests d'acceptation T05 — besoins en semences et en plants (docs/backlog/T05-besoins-semences.md).
 *
 * API attendue, exportée par `packages/core/src/planification/besoins.ts` :
 *
 * ── Entrée d'une série : type local `ItineraireBesoins` ─────────────────────────────────────
 *
 *   Les types de T01 ne suffisent pas tels quels : la germination et le poids de mille graines
 *   sont portés par la Variété (en grammes décimaux, germination facultative), la dose à la volée
 *   est en g/m² décimaux et `grainesParPoquet` est facultatif quelle que soit la façon de compter.
 *   besoins.ts définit donc son propre type d'entrée, en entiers, où chaque combinaison
 *   mode × façon ne porte que ses paramètres (c'est l'appelant, T12, qui assemble itinéraire
 *   figé de la série et variété) :
 *
 *   type ItineraireBesoins =
 *     | { mode: 'semis_direct'; facon: 'ecartement'; densite: DensiteEcartement;     // T01
 *         grainesParPoquet: number; germination: Pourcentage;
 *         margeSecurite: Pourcentage; pmgMg: number | null }
 *     | { mode: 'semis_direct'; facon: 'metre_lineaire'; densite: DensiteMetreLineaire; // T01
 *         margeSecurite: Pourcentage; pmgMg: number | null }      // germination déjà comptée
 *     | { mode: 'semis_direct'; facon: 'volee'; densite: DensiteVoleeBesoins;
 *         margeSecurite: Pourcentage }
 *     | { mode: 'plant_maison'; densite: DensiteEcartement;
 *         grainesParMotte: number; plantsParMotte: number; germination: Pourcentage;
 *         pertePepiniere: Pourcentage; alveolesParPlaque: number | null;
 *         margeSecurite: Pourcentage; pmgMg: number | null }
 *     | { mode: 'plant_achete'; densite: DensiteEcartement; margeSecurite: Pourcentage }
 *
 *   interface DensiteVoleeBesoins { facon: 'volee'; largeurSemeeCm: Centimetres; doseMgParM2: number }
 *
 *   Pourquoi `facon` au premier niveau du semis direct, en plus de `densite.facon` : TypeScript
 *   ne discrimine une union (et ne signale les propriétés en trop d'un littéral) que sur des
 *   discriminants de premier niveau. Avec `facon` rangé seulement dans `densite`, les trois
 *   variantes du semis direct partagent `mode: 'semis_direct'` et un semis au mètre linéaire
 *   portant `germination` et `grainesParPoquet`, ou une volée portant `pmgMg`, compilaient sans
 *   erreur. Le couple (`mode`, `facon`) désigne maintenant une seule variante, et chaque variante
 *   lie `facon` à sa densité : `facon: 'volee'` avec une densité à l'écartement est refusé.
 *   `densite` garde sa forme T01 (avec son propre `facon`) pour être copiée telle quelle.
 *   Plant maison et plant acheté n'ont pas de `facon` : ils comptent toujours à l'écartement.
 *
 *   Tous les champs sont `readonly`. Unités entières, sans exception :
 *     - pourcentages entiers (Pourcentage de T01) : 80 pour 80 % ;
 *     - pmgMg : poids de mille graines en MILLIGRAMMES (1,2 g → 1200) ; `null` si inconnu ;
 *     - doseMgParM2 : dose à la volée en MILLIGRAMMES par m² (15 g/m² → 15 000) ;
 *     - longueur de la série en CENTIMÈTRES (30 m → 3000).
 *
 * ── besoinsSerie(itineraire: ItineraireBesoins, longueurCm: number): BesoinsSerie ─────────────
 *
 *   type BesoinsSerie =
 *     | { mode: 'semis_direct'; facon: 'ecartement'; plants; graines; poidsDg? }
 *     | { mode: 'semis_direct'; facon: 'metre_lineaire'; graines; poidsDg? }
 *     | { mode: 'semis_direct'; facon: 'volee'; poidsDg }
 *     | { mode: 'plant_maison'; mottesEnPlace; plants; mottesAPlanter; mottesASemer; graines;
 *         plaques?; poidsDg? }
 *     | { mode: 'plant_achete'; plants; plantsACommander }
 *   (tous `readonly`, tous des entiers `number`)
 *
 *   Un champ sans objet est ABSENT (pas `null`, pas `undefined`) : `plaques` sans alvéoles par
 *   plaque, `poidsDg` sans poids de mille graines. Les tests comparent avec `toStrictEqual`.
 *
 *   poidsDg : poids de semences en DIXIÈMES DE GRAMME entiers (6,6 g → 66), arrondi au-dessus.
 *   L'affichage divise par 10 ; le moteur ne manipule jamais de gramme décimal.
 *
 *   Formules, en entiers, un seul arrondi par grandeur (au-dessus, sauf plants en place) :
 *     placesParRang  = ⌊longueurCm ÷ ecartementSurRangCm⌋
 *     écartement     : plants = placesParRang × rangs
 *                      graines = ⌈plants × grainesParPoquet × 100 × (100 + marge) ÷ (germination × 100)⌉
 *     mètre linéaire : graines = ⌈longueurCm × rangs × grainesParMetre × (100 + marge) ÷ (100 × 100)⌉
 *     volée          : poidsDg = ⌈longueurCm × largeurSemeeCm × doseMgParM2 × (100 + marge) ÷ 10⁸⌉
 *                      (cm² → m² : ÷ 10⁴ ; mg → dg : ÷ 100 ; marge : ÷ 100)
 *     plant maison   : mottesEnPlace  = placesParRang × rangs
 *                      plants         = mottesEnPlace × plantsParMotte
 *                      mottesAPlanter = ⌈mottesEnPlace × (100 + marge) ÷ 100⌉
 *                      mottesASemer   = ⌈mottesAPlanter × 100 ÷ (100 − perte)⌉
 *                      graines        = ⌈mottesASemer × grainesParMotte × 100 ÷ germination⌉
 *                      plaques        = ⌈mottesASemer ÷ alveolesParPlaque⌉
 *     plant acheté   : plants = placesParRang × rangs ; plantsACommander = ⌈plants × (100 + marge) ÷ 100⌉
 *     poids          : poidsDg = ⌈graines × pmgMg ÷ 100 000⌉ (graines × mg/1000 graines → mg → dg)
 *
 *   Les grandeurs intermédiaires du plant maison sont arrondies (on sème des mottes entières) :
 *   c'est ce que donne le tableau du ticket (348 mottes → 387 graines, et non 386). Partout
 *   ailleurs, un seul arrondi : des cas où la division ne tombe pas juste (germination 85 % et
 *   86 %, 3001 cm) font échouer un arrondi au-dessous comme un double arrondi.
 *
 *   RangeError :
 *     - longueurCm n'est pas un entier ≥ 0 ;
 *     - écartement ≤ 0 ; rangsParPlanche, grainesParPoquet, grainesParMotte ou plantsParMotte < 1 ;
 *     - germination hors de ]0, 100] ; perte en pépinière hors de [0, 100[ ;
 *     - un résultat (ou un total de saison) dépasse Number.MAX_SAFE_INTEGER.
 *
 * ── besoinsSaison(series: readonly SerieBesoins[]): LigneBesoinsSaison[] ─────────────────────
 *
 *   type SerieBesoins =
 *     | { varieteId: Id<'Variete'>; itineraire: <ItineraireBesoins sauf plant_achete>;
 *         longueurCm: number; dateSemis: DateCalendaire }       // semis direct ; pépinière en plant maison
 *     | { varieteId: Id<'Variete'>; itineraire: <ItineraireBesoins plant_achete>;
 *         longueurCm: number; datePlantation: DateCalendaire }
 *
 *   interface LigneBesoinsSaison {
 *     varieteId: Id<'Variete'>;
 *     semaine: SemaineIso;             // semaineIso(dateSemis) ou semaineIso(datePlantation), de T01
 *     graines?; poidsDg?; mottesASemer?; plantsACommander?;         // entiers
 *     plaques?: readonly { alveoles: number; nombre: number }[];     // un élément par format
 *   }
 *
 *   Une ligne par (variété, semaine ISO). Chaque champ est la somme des besoinsSerie des séries
 *   de la ligne ; il est absent si aucune série de la ligne ne le fournit. Précisions :
 *     - plaques : une entrée par format (nombre d'alvéoles), triées par alvéoles croissantes ;
 *       `nombre` additionne les plaques de chaque série de ce format (chaque série a ses
 *       plaques), sans nouvel arrondi sur le total des mottes. Le champ est ABSENT dès qu'une
 *       série de la ligne a des mottes sans nombre d'alvéoles : une liste partielle ferait
 *       commander trop peu de plaques ;
 *     - poidsDg : somme des poids DÉJÀ ARRONDIS de chaque série, et non arrondi du poids total :
 *       le total est donc supérieur ou égal au poids exact, ce qui va dans le sens prudent.
 *       Absent dès qu'une série de la ligne a des graines sans poids connu, pour ne jamais
 *       afficher un poids total sous-estimé ;
 *     - une ligne peut mêler des graines comptées (écartement, mètre linéaire, plant maison) et
 *       le poids d'une volée de la même variété : poidsDg est alors le poids total à commander,
 *       graines ne compte que les séries comptées en graines. Si le poids est absent faute de
 *       PMG, celui de la volée l'est aussi (même règle : pas de total sous-estimé).
 *   Lignes triées par varieteId (ordre des chaînes), puis par semaine (année, puis numéro).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DateCalendaire, SemaineIso } from '../dates/index.ts';
import type { Id } from '../domaine/index.ts';
import { besoinsSaison, besoinsSerie } from './besoins.ts';
import type { BesoinsSerie, ItineraireBesoins, LigneBesoinsSaison, SerieBesoins } from './besoins.ts';

// ---------------------------------------------------------------------------------------------
// Itinéraires du tableau du ticket
// ---------------------------------------------------------------------------------------------

/** Carotte, semis direct à l'écartement : 4 rangs, 3 cm, 1 graine/poquet, 80 %, marge 10 %, PMG 1,2 g. */
const carotteEcartement = {
  mode: 'semis_direct',
  facon: 'ecartement',
  densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 3 },
  grainesParPoquet: 1,
  germination: 80,
  margeSecurite: 10,
  pmgMg: 1200,
} as const satisfies ItineraireBesoins;

/** Carotte au mètre linéaire : 4 rangs, 60 graines/m, marge 10 %, PMG 1,2 g. */
const carotteMetreLineaire = {
  mode: 'semis_direct',
  facon: 'metre_lineaire',
  densite: { facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 60 },
  margeSecurite: 10,
  pmgMg: 1200,
} as const satisfies ItineraireBesoins;

/** Batavia en plant maison : 3 rangs, 30 cm, 1 graine/motte, 90 %, marge 10 %, perte 0 %. */
const batavia = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
  grainesParMotte: 1,
  plantsParMotte: 1,
  germination: 90,
  pertePepiniere: 0,
  alveolesParPlaque: null,
  margeSecurite: 10,
  pmgMg: null,
} as const satisfies ItineraireBesoins;

/** Batavia avec 5 % de perte en pépinière et des plaques de 104 alvéoles. */
const bataviaPertePlaques = {
  ...batavia,
  pertePepiniere: 5,
  alveolesParPlaque: 104,
} as const satisfies ItineraireBesoins;

/** Oignon en mottes : 4 rangs, 25 cm, 4 plants et 6 graines par motte, 85 %, marge 10 %. */
const oignonMottes = {
  mode: 'plant_maison',
  densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 25 },
  grainesParMotte: 6,
  plantsParMotte: 4,
  germination: 85,
  pertePepiniere: 0,
  alveolesParPlaque: null,
  margeSecurite: 10,
  pmgMg: null,
} as const satisfies ItineraireBesoins;

/** Engrais vert à la volée : 80 cm semés, 15 g/m², marge 0 %. */
const engraisVert = {
  mode: 'semis_direct',
  facon: 'volee',
  densite: { facon: 'volee', largeurSemeeCm: 80, doseMgParM2: 15_000 },
  margeSecurite: 0,
} as const satisfies ItineraireBesoins;

/** Plant acheté : 2 rangs à 20 cm, marge 10 % (10 m donnent 100 plants). */
const plantAchete = {
  mode: 'plant_achete',
  densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 20 },
  margeSecurite: 10,
} as const satisfies ItineraireBesoins;

// ---------------------------------------------------------------------------------------------
// Les sept cas du tableau
// ---------------------------------------------------------------------------------------------

describe('besoinsSerie — les sept cas du ticket', () => {
  it('carotte en semis direct à l’écartement, 30 m : 4 000 plants, 5 500 graines, 6,6 g', () => {
    // 3000 ÷ 3 = 1000 places × 4 rangs = 4000 ; 4000 × 1 ÷ 0,80 = 5000 ; + 10 % = 5500 ;
    // 5500 × 1200 mg ÷ 1000 = 6600 mg = 66 dg.
    expect(besoinsSerie(carotteEcartement, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'ecartement',
      plants: 4000,
      graines: 5500,
      poidsDg: 66,
    });
  });

  it('carotte au mètre linéaire, 30 m : 7 920 graines, 9,6 g', () => {
    // 30 m × 4 rangs × 60 = 7200 ; + 10 % = 7920 ; 7920 × 1,2 ÷ 1000 = 9,504 g → 9,6 g.
    expect(besoinsSerie(carotteMetreLineaire, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'metre_lineaire',
      graines: 7920,
      poidsDg: 96,
    });
  });

  it('batavia en plant maison, 30 m : 300 plants, 330 mottes, 367 graines', () => {
    // 3000 ÷ 30 = 100 × 3 = 300 mottes ; + 10 % = 330 ; perte 0 → 330 à semer ;
    // 330 ÷ 0,90 = 366,7 → 367. Pas d'alvéoles ni de PMG : plaques et poids absents.
    expect(besoinsSerie(batavia, 3000)).toStrictEqual({
      mode: 'plant_maison',
      mottesEnPlace: 300,
      plants: 300,
      mottesAPlanter: 330,
      mottesASemer: 330,
      graines: 367,
    });
  });

  it('batavia avec 5 % de perte et plaques de 104 : 348 mottes à semer, 387 graines, 4 plaques', () => {
    // 330 ÷ 0,95 = 347,4 → 348 ; 348 ÷ 0,90 = 386,7 → 387 ; 348 ÷ 104 = 3,3 → 4.
    expect(besoinsSerie(bataviaPertePlaques, 3000)).toStrictEqual({
      mode: 'plant_maison',
      mottesEnPlace: 300,
      plants: 300,
      mottesAPlanter: 330,
      mottesASemer: 348,
      graines: 387,
      plaques: 4,
    });
  });

  it('oignon en mottes, 30 m : 480 mottes, 1 920 plants, 528 mottes, 3 728 graines', () => {
    // 3000 ÷ 25 = 120 × 4 = 480 mottes ; × 4 plants = 1920 ; + 10 % = 528 ;
    // 528 × 6 = 3168 ÷ 0,85 = 3727,06 → 3728.
    expect(besoinsSerie(oignonMottes, 3000)).toStrictEqual({
      mode: 'plant_maison',
      mottesEnPlace: 480,
      plants: 1920,
      mottesAPlanter: 528,
      mottesASemer: 528,
      graines: 3728,
    });
  });

  it('engrais vert à la volée, 30 m × 80 cm à 15 g/m² : 360 g', () => {
    // 30 × 0,80 = 24 m² × 15 g = 360 g = 3600 dg.
    expect(besoinsSerie(engraisVert, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'volee',
      poidsDg: 3600,
    });
  });

  it('piège d’arrondi : 100 plants achetés + 10 % = 110, pas 111', () => {
    // En flottant, 100 × 1.1 = 110.00000000000001, arrondi au-dessus à 111.
    expect(besoinsSerie(plantAchete, 1000)).toStrictEqual({
      mode: 'plant_achete',
      plants: 100,
      plantsACommander: 110,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Cas limites demandés par le ticket
// ---------------------------------------------------------------------------------------------

describe('besoinsSerie — longueur non multiple de l’écartement', () => {
  it('batavia sur 31 m : les places partielles ne comptent pas', () => {
    // 3100 ÷ 30 = 103,3 → 103 × 3 = 309 ; + 10 % = 339,9 → 340 ; 340 ÷ 0,90 = 377,8 → 378.
    expect(besoinsSerie(batavia, 3100)).toStrictEqual({
      mode: 'plant_maison',
      mottesEnPlace: 309,
      plants: 309,
      mottesAPlanter: 340,
      mottesASemer: 340,
      graines: 378,
    });
  });

  it('carotte sur 30,50 m : 1016 places par rang', () => {
    // 3050 ÷ 3 = 1016,7 → 1016 × 4 = 4064 ; × 110 ÷ 80 = 5588 ; 5588 × 1,2 g ÷ 1000 = 6,7056 → 6,8 g.
    expect(besoinsSerie(carotteEcartement, 3050)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'ecartement',
      plants: 4064,
      graines: 5588,
      poidsDg: 68,
    });
  });

  it('plant acheté sur une longueur plus courte que l’écartement : rien à planter', () => {
    expect(besoinsSerie(plantAchete, 19)).toStrictEqual({
      mode: 'plant_achete',
      plants: 0,
      plantsACommander: 0,
    });
  });
});

describe('besoinsSerie — germination à 100 %', () => {
  it('semis direct : seule la marge s’ajoute aux plants', () => {
    // 4000 + 10 % = 4400 ; 4400 × 1,2 g ÷ 1000 = 5,28 g → 5,3 g.
    expect(besoinsSerie({ ...carotteEcartement, germination: 100 }, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'ecartement',
      plants: 4000,
      graines: 4400,
      poidsDg: 53,
    });
  });

  it('plant maison : une graine par motte à semer', () => {
    expect(besoinsSerie({ ...batavia, germination: 100 }, 3000)).toStrictEqual({
      mode: 'plant_maison',
      mottesEnPlace: 300,
      plants: 300,
      mottesAPlanter: 330,
      mottesASemer: 330,
      graines: 330,
    });
  });
});

describe('besoinsSerie — marge à 0 %', () => {
  it('plant maison : mottes à planter = mottes en place', () => {
    // 300 ÷ 0,90 = 333,3 → 334.
    expect(besoinsSerie({ ...batavia, margeSecurite: 0 }, 3000)).toStrictEqual({
      mode: 'plant_maison',
      mottesEnPlace: 300,
      plants: 300,
      mottesAPlanter: 300,
      mottesASemer: 300,
      graines: 334,
    });
  });

  it('semis direct à l’écartement : graines = plants ÷ germination', () => {
    // 4000 ÷ 0,80 = 5000 ; 5000 × 1,2 g ÷ 1000 = 6 g.
    expect(besoinsSerie({ ...carotteEcartement, margeSecurite: 0 }, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'ecartement',
      plants: 4000,
      graines: 5000,
      poidsDg: 60,
    });
  });

  it('plant acheté : plants à commander = plants en place', () => {
    expect(besoinsSerie({ ...plantAchete, margeSecurite: 0 }, 1000)).toStrictEqual({
      mode: 'plant_achete',
      plants: 100,
      plantsACommander: 100,
    });
  });
});

describe('besoinsSerie — pièges du flottant', () => {
  it.each([
    [1000, 100, 110],
    [2000, 200, 220],
    [7000, 700, 770],
  ])('plant acheté sur %i cm : %i plants + 10 %% = %i', (longueurCm, plants, plantsACommander) => {
    // 200 × 1.1 et 700 × 1.1 dépassent aussi l'entier en flottant (221 et 771 après arrondi).
    expect(besoinsSerie(plantAchete, longueurCm)).toStrictEqual({
      mode: 'plant_achete',
      plants,
      plantsACommander,
    });
  });

  it('poids de semences : 7 000 graines à 1,1 g les mille font 7,7 g, pas 7,8', () => {
    // 35 m × 4 rangs × 50 graines/m = 7000 ; en flottant 7000 × 1.1 ÷ 1000 × 10 = 77,00000000000001.
    const itineraire = {
      mode: 'semis_direct',
      facon: 'metre_lineaire',
      densite: { facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 50 },
      margeSecurite: 0,
      pmgMg: 1100,
    } as const satisfies ItineraireBesoins;
    expect(besoinsSerie(itineraire, 3500)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'metre_lineaire',
      graines: 7000,
      poidsDg: 77,
    });
  });
});

describe('besoinsSerie — divisions qui ne tombent pas juste', () => {
  // Chaque cas fait échouer un arrondi au-dessous ; ceux marqués « double arrondi » font aussi
  // échouer un calcul qui arrondirait une étape intermédiaire avant la suivante.

  it('carotte à 85 % de germination : 5 177 graines', () => {
    // 4000 × 110 ÷ 85 = 5176,47 → 5177 (au-dessous : 5176) ; 5177 × 1,2 g ÷ 1000 = 6,2124 g → 6,3 g.
    expect(besoinsSerie({ ...carotteEcartement, germination: 85 }, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'ecartement',
      plants: 4000,
      graines: 5177,
      poidsDg: 63,
    });
  });

  it('carotte à 86 % de germination : 5 117 graines (double arrondi : 5 118)', () => {
    // 4000 × 110 ÷ 86 = 5116,28 → 5117. En deux temps : ⌈4000 ÷ 0,86⌉ = 4652, × 1,1 = 5117,2 → 5118.
    // 5117 × 1,2 g ÷ 1000 = 6,1404 g → 6,2 g.
    expect(besoinsSerie({ ...carotteEcartement, germination: 86 }, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'ecartement',
      plants: 4000,
      graines: 5117,
      poidsDg: 62,
    });
  });

  it('mètre linéaire sur 3001 cm : 7 923 graines (double arrondi : 7 924)', () => {
    // 30,01 × 4 × 60 = 7202,4 ; × 1,1 = 7922,64 → 7923. En deux temps : 7203 × 1,1 = 7923,3 → 7924.
    // 7923 × 1,2 g ÷ 1000 = 9,5076 g → 9,6 g.
    expect(besoinsSerie(carotteMetreLineaire, 3001)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'metre_lineaire',
      graines: 7923,
      poidsDg: 96,
    });
  });

  it('volée sur 3001 cm : 360,2 g', () => {
    // 30,01 × 0,80 = 24,008 m² × 15 g = 360,12 g → 360,2 g (au-dessous : 360,1).
    expect(besoinsSerie(engraisVert, 3001)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'volee',
      poidsDg: 3602,
    });
  });

  it('1 km de carotte à l’écartement', () => {
    // 100 000 ÷ 3 = 33 333 × 4 = 133 332 ; × 110 ÷ 80 = 183 331,5 → 183 332 ;
    // 183 332 × 1,2 g ÷ 1000 = 219,9984 g → 220 g.
    expect(besoinsSerie(carotteEcartement, 100_000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'ecartement',
      plants: 133_332,
      graines: 183_332,
      poidsDg: 2200,
    });
  });

  it('refuse un résultat au-delà des entiers sûrs', () => {
    // Number.MAX_SAFE_INTEGER cm à 1 cm sur 2 rangs : plus de 2⁵³ plants.
    const serre = { ...plantAchete, densite: { ...plantAchete.densite, ecartementSurRangCm: 1 } };
    expect(() => besoinsSerie(serre, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});

describe('besoinsSerie — champs sans objet', () => {
  it('sans poids de mille graines connu, le poids est absent', () => {
    expect(besoinsSerie({ ...carotteMetreLineaire, pmgMg: null }, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'metre_lineaire',
      graines: 7920,
    });
  });

  it('plant maison avec PMG : le poids suit les graines', () => {
    // 387 graines × 0,9 g ÷ 1000 = 0,3483 g → 0,4 g.
    expect(besoinsSerie({ ...bataviaPertePlaques, pmgMg: 900 }, 3000)).toStrictEqual({
      mode: 'plant_maison',
      mottesEnPlace: 300,
      plants: 300,
      mottesAPlanter: 330,
      mottesASemer: 348,
      graines: 387,
      plaques: 4,
      poidsDg: 4,
    });
  });

  it('à la volée, la marge s’applique au poids', () => {
    // 360 g + 10 % = 396 g.
    expect(besoinsSerie({ ...engraisVert, margeSecurite: 10 }, 3000)).toStrictEqual({
      mode: 'semis_direct',
      facon: 'volee',
      poidsDg: 3960,
    });
  });
});

describe('besoinsSerie — paramètres impossibles', () => {
  it('refuse une longueur non entière en centimètres', () => {
    expect(() => besoinsSerie(batavia, 3000.5)).toThrow(RangeError);
  });

  it('refuse une longueur négative', () => {
    expect(() => besoinsSerie(batavia, -100)).toThrow(RangeError);
  });

  it('refuse une germination nulle ou au-delà de 100 %', () => {
    expect(() => besoinsSerie({ ...batavia, germination: 0 }, 3000)).toThrow(RangeError);
    expect(() => besoinsSerie({ ...carotteEcartement, germination: 101 }, 3000)).toThrow(RangeError);
  });

  it('refuse une perte en pépinière de 100 %', () => {
    expect(() => besoinsSerie({ ...batavia, pertePepiniere: 100 }, 3000)).toThrow(RangeError);
  });

  it('refuse moins d’un rang par planche', () => {
    expect(() =>
      besoinsSerie({ ...plantAchete, densite: { ...plantAchete.densite, rangsParPlanche: 0 } }, 1000),
    ).toThrow(RangeError);
    expect(() =>
      besoinsSerie({ ...carotteMetreLineaire, densite: { ...carotteMetreLineaire.densite, rangsParPlanche: 0 } }, 3000),
    ).toThrow(RangeError);
  });

  it('refuse moins d’une graine par poquet ou par motte', () => {
    expect(() => besoinsSerie({ ...carotteEcartement, grainesParPoquet: 0 }, 3000)).toThrow(RangeError);
    expect(() => besoinsSerie({ ...batavia, grainesParMotte: 0 }, 3000)).toThrow(RangeError);
  });

  it('refuse moins d’un plant par motte', () => {
    expect(() => besoinsSerie({ ...batavia, plantsParMotte: 0 }, 3000)).toThrow(RangeError);
  });

  it('refuse un écartement nul', () => {
    expect(() =>
      besoinsSerie({ ...plantAchete, densite: { ...plantAchete.densite, ecartementSurRangCm: 0 } }, 1000),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------------------------
// Typage : un paramétrage incohérent ne compile pas
// ---------------------------------------------------------------------------------------------

describe('typage des itinéraires', () => {
  it('refuse une dose à la volée sur un plant maison', () => {
    const incoherent: ItineraireBesoins = {
      mode: 'plant_maison',
      // @ts-expect-error un plant maison se pose à l'écartement, pas à la volée.
      densite: { facon: 'volee', largeurSemeeCm: 80, doseMgParM2: 15_000 },
      grainesParMotte: 1,
      plantsParMotte: 1,
      germination: 90,
      pertePepiniere: 0,
      alveolesParPlaque: null,
      margeSecurite: 10,
      pmgMg: null,
    };
    expect(incoherent.mode).toBe('plant_maison');
  });

  it('refuse un plant acheté compté au mètre linéaire', () => {
    const incoherent: ItineraireBesoins = {
      mode: 'plant_achete',
      // @ts-expect-error un plant acheté se pose à l'écartement.
      densite: { facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 60 },
      margeSecurite: 10,
    };
    expect(incoherent.mode).toBe('plant_achete');
  });

  it('exige les graines par poquet et la germination en semis direct à l’écartement', () => {
    // @ts-expect-error il manque les graines par poquet.
    const sansPoquet: ItineraireBesoins = {
      mode: 'semis_direct',
      facon: 'ecartement',
      densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 3 },
      germination: 80,
      margeSecurite: 10,
      pmgMg: 1200,
    };
    // @ts-expect-error il manque la germination.
    const sansGermination: ItineraireBesoins = {
      mode: 'semis_direct',
      facon: 'ecartement',
      densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 3 },
      grainesParPoquet: 1,
      margeSecurite: 10,
      pmgMg: 1200,
    };
    expect([sansPoquet.mode, sansGermination.mode]).toStrictEqual(['semis_direct', 'semis_direct']);
  });

  it('exige la perte en pépinière et les plants par motte en plant maison', () => {
    // @ts-expect-error il manque la perte en pépinière.
    const sansPerte: ItineraireBesoins = {
      mode: 'plant_maison',
      densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
      grainesParMotte: 1,
      plantsParMotte: 1,
      germination: 90,
      alveolesParPlaque: null,
      margeSecurite: 10,
      pmgMg: null,
    };
    // @ts-expect-error il manque les plants par motte.
    const sansPlantsParMotte: ItineraireBesoins = {
      mode: 'plant_maison',
      densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
      grainesParMotte: 1,
      germination: 90,
      pertePepiniere: 0,
      alveolesParPlaque: null,
      margeSecurite: 10,
      pmgMg: null,
    };
    expect([sansPerte.mode, sansPlantsParMotte.mode]).toStrictEqual(['plant_maison', 'plant_maison']);
  });

  it('refuse une dose à la volée exprimée en grammes plutôt qu’en milligrammes', () => {
    const incoherent: ItineraireBesoins = {
      mode: 'semis_direct',
      facon: 'volee',
      // @ts-expect-error la dose est `doseMgParM2`, entière, pas `doseGParM2`.
      densite: { facon: 'volee', largeurSemeeCm: 80, doseGParM2: 15 },
      margeSecurite: 0,
    };
    expect(incoherent.mode).toBe('semis_direct');
  });

  it('refuse germination et graines par poquet sur un semis au mètre linéaire', () => {
    const incoherent: ItineraireBesoins = {
      mode: 'semis_direct',
      facon: 'metre_lineaire',
      densite: { facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 60 },
      // @ts-expect-error au mètre linéaire, la densité compte déjà la germination.
      germination: 80,
      grainesParPoquet: 1,
      margeSecurite: 10,
      pmgMg: 1200,
    };
    expect(incoherent.mode).toBe('semis_direct');
  });

  it('refuse un poids de mille graines sur une volée', () => {
    const incoherent: ItineraireBesoins = {
      mode: 'semis_direct',
      facon: 'volee',
      densite: { facon: 'volee', largeurSemeeCm: 80, doseMgParM2: 15_000 },
      margeSecurite: 0,
      // @ts-expect-error à la volée, on compte un poids par m², pas des graines.
      pmgMg: 1200,
    };
    expect(incoherent.mode).toBe('semis_direct');
  });

  it('refuse une façon de compter qui contredit la densité', () => {
    const incoherent: ItineraireBesoins = {
      mode: 'semis_direct',
      facon: 'volee',
      // @ts-expect-error `facon: 'volee'` exige une densité à la volée.
      densite: { facon: 'ecartement', rangsParPlanche: 4, ecartementSurRangCm: 3 },
      margeSecurite: 0,
    };
    expect(incoherent.mode).toBe('semis_direct');
  });

  it('le résultat ne porte que les champs du mode et de la façon', () => {
    expectTypeOf<Extract<BesoinsSerie, { facon: 'volee' }>>().not.toHaveProperty('graines');
    expectTypeOf<Extract<BesoinsSerie, { facon: 'volee' }>>().toHaveProperty('poidsDg').toEqualTypeOf<number>();
    expectTypeOf<Extract<BesoinsSerie, { facon: 'metre_lineaire' }>>().not.toHaveProperty('plants');
    expectTypeOf<Extract<BesoinsSerie, { mode: 'plant_achete' }>>().not.toHaveProperty('graines');
    expectTypeOf<Extract<BesoinsSerie, { mode: 'plant_achete' }>>().not.toHaveProperty('poidsDg');
    expectTypeOf<Extract<BesoinsSerie, { mode: 'plant_maison' }>>().toHaveProperty('mottesASemer');
    expectTypeOf<Extract<BesoinsSerie, { mode: 'semis_direct' }>>().not.toHaveProperty('mottesASemer');
  });

  it('la date d’agrégation suit le mode : semis, ou plantation pour les plants achetés', () => {
    const varieteId = '0190a5c8-0000-7000-8000-00000000000a' as Id<'Variete'>;
    const date = '2027-03-01' as DateCalendaire;
    // @ts-expect-error un plant acheté s'agrège à sa date de plantation, pas de semis.
    const acheteSeme: SerieBesoins = { varieteId, itineraire: plantAchete, longueurCm: 1000, dateSemis: date };
    // @ts-expect-error un plant maison s'agrège à son semis en pépinière.
    const maisonPlante: SerieBesoins = { varieteId, itineraire: batavia, longueurCm: 3000, datePlantation: date };
    expect([acheteSeme.varieteId, maisonPlante.varieteId]).toStrictEqual([varieteId, varieteId]);
  });
});

// ---------------------------------------------------------------------------------------------
// Agrégation par variété et par semaine
// ---------------------------------------------------------------------------------------------

describe('besoinsSaison', () => {
  const varieteA = '0190a5c8-0000-7000-8000-00000000000a' as Id<'Variete'>;
  const varieteB = '0190a5c8-0000-7000-8000-00000000000b' as Id<'Variete'>;
  const varieteC = '0190a5c8-0000-7000-8000-00000000000c' as Id<'Variete'>;
  const date = (d: string): DateCalendaire => d as DateCalendaire;
  const semaine = (annee: number, numero: number): SemaineIso => ({ annee, semaine: numero });

  it('sans série, aucune ligne', () => {
    expect(besoinsSaison([])).toStrictEqual([]);
  });

  it('agrège par variété et par semaine de semis ou de plantation, dans l’ordre', () => {
    const series: SerieBesoins[] = [
      // Plant acheté : à sa semaine de plantation (2027-S15), 110 + 220.
      { varieteId: varieteB, itineraire: plantAchete, longueurCm: 1000, datePlantation: date('2027-04-12') },
      { varieteId: varieteB, itineraire: plantAchete, longueurCm: 2000, datePlantation: date('2027-04-18') },
      // Variété A, 2027-S09 (lundi 1er et dimanche 7 mars) : 5500 + 5500 graines, 66 + 66 dg.
      { varieteId: varieteA, itineraire: carotteEcartement, longueurCm: 3000, dateSemis: date('2027-03-07') },
      { varieteId: varieteA, itineraire: carotteEcartement, longueurCm: 3000, dateSemis: date('2027-03-01') },
      // Variété A, 2027-S10 : mètre linéaire (7920 graines, 96 dg) + volée (3600 dg, sans graines).
      { varieteId: varieteA, itineraire: carotteMetreLineaire, longueurCm: 3000, dateSemis: date('2027-03-08') },
      { varieteId: varieteA, itineraire: engraisVert, longueurCm: 3000, dateSemis: date('2027-03-10') },
      // Variété A, 2027-S11 : une série sans PMG → poids de la ligne absent.
      {
        varieteId: varieteA,
        itineraire: { ...carotteMetreLineaire, pmgMg: null },
        longueurCm: 3000,
        dateSemis: date('2027-03-15'),
      },
      { varieteId: varieteA, itineraire: carotteEcartement, longueurCm: 3000, dateSemis: date('2027-03-16') },
      // Variété C en plant maison, à la semaine du semis en pépinière (2027-S09) :
      // 348 mottes, 387 graines, 4 plaques de 104 ; 330 mottes, 367 graines, ⌈330 ÷ 104⌉ = 4 plaques
      // de 104 ; 330 mottes, 367 graines, ⌈330 ÷ 77⌉ = 5 plaques de 77.
      { varieteId: varieteC, itineraire: bataviaPertePlaques, longueurCm: 3000, dateSemis: date('2027-03-03') },
      {
        varieteId: varieteC,
        itineraire: { ...batavia, alveolesParPlaque: 104 },
        longueurCm: 3000,
        dateSemis: date('2027-03-05'),
      },
      {
        varieteId: varieteC,
        itineraire: { ...batavia, alveolesParPlaque: 77 },
        longueurCm: 3000,
        dateSemis: date('2027-03-04'),
      },
      // Le 1er janvier 2027 est dans la semaine ISO 53 de 2026. Une des deux séries n'a pas de
      // nombre d'alvéoles : les plaques de la ligne sont absentes.
      {
        varieteId: varieteC,
        itineraire: { ...batavia, alveolesParPlaque: 104 },
        longueurCm: 3000,
        dateSemis: date('2027-01-01'),
      },
      { varieteId: varieteC, itineraire: batavia, longueurCm: 3000, dateSemis: date('2027-01-03') },
    ];

    const attendu: LigneBesoinsSaison[] = [
      { varieteId: varieteA, semaine: semaine(2027, 9), graines: 11_000, poidsDg: 132 },
      { varieteId: varieteA, semaine: semaine(2027, 10), graines: 7920, poidsDg: 3696 },
      { varieteId: varieteA, semaine: semaine(2027, 11), graines: 13_420 },
      { varieteId: varieteB, semaine: semaine(2027, 15), plantsACommander: 330 },
      { varieteId: varieteC, semaine: semaine(2026, 53), mottesASemer: 660, graines: 734 },
      // 8 plaques de 104 (4 + 4, une série = ses plaques) et non ⌈678 ÷ 104⌉ = 7 ; triées par alvéoles.
      {
        varieteId: varieteC,
        semaine: semaine(2027, 9),
        mottesASemer: 1008,
        graines: 1121,
        plaques: [
          { alveoles: 77, nombre: 5 },
          { alveoles: 104, nombre: 8 },
        ],
      },
    ];

    expect(besoinsSaison(series)).toStrictEqual(attendu);
  });

  it('le poids d’une ligne est la somme des poids arrondis de chaque série', () => {
    // Carotte sur 30,50 m : 5588 graines, 6,7056 g → 6,8 g par série. Deux séries : 13,6 g,
    // et non ⌈13,4112⌉ = 13,5 g : le total ne descend jamais sous le poids exact.
    const series: SerieBesoins[] = [
      { varieteId: varieteA, itineraire: carotteEcartement, longueurCm: 3050, dateSemis: date('2027-03-01') },
      { varieteId: varieteA, itineraire: carotteEcartement, longueurCm: 3050, dateSemis: date('2027-03-02') },
    ];
    expect(besoinsSaison(series)).toStrictEqual([
      { varieteId: varieteA, semaine: semaine(2027, 9), graines: 11_176, poidsDg: 136 },
    ]);
  });

  it('une même semaine de deux variétés donne deux lignes', () => {
    const series: SerieBesoins[] = [
      { varieteId: varieteB, itineraire: carotteEcartement, longueurCm: 3000, dateSemis: date('2027-03-01') },
      { varieteId: varieteA, itineraire: carotteEcartement, longueurCm: 3000, dateSemis: date('2027-03-01') },
    ];
    expect(besoinsSaison(series)).toStrictEqual([
      { varieteId: varieteA, semaine: semaine(2027, 9), graines: 5500, poidsDg: 66 },
      { varieteId: varieteB, semaine: semaine(2027, 9), graines: 5500, poidsDg: 66 },
    ]);
  });
});

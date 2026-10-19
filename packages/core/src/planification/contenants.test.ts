/**
 * Tests d'acceptation T51 — hors-sol : gouttières en pains, trous par pain selon la variété
 * (docs/backlog/T51-hors-sol-pains.md, règles 2 et 3).
 *
 * ── Contrat ──────────────────────────────────────────────────────────────────────────────────
 *
 * Densité « en contenants » (T01, `Densite`), le contenant étant un pain, un sac ou un pot :
 *
 *   interface DensiteContenants {
 *     facon: 'contenants';
 *     trousParContenant: number;   // entier, de 1 à BORNES_CONTENANTS.trousParContenantMax
 *     plantsParTrou?: number;      // plant maison ou acheté ; absent = 1
 *     grainesParTrou?: number;     // semis direct, obligatoire
 *   }
 *
 * Elle est permise en semis direct, en plant maison et en plant acheté (ParametresPlantMaison et
 * ParametresPlantAchete acceptent `DensiteEcartement | DensiteContenants`).
 *
 * Besoins (T05) : `besoinsSerie(itineraire, etendue)` ; pour une densité en contenants,
 * `etendue` est le NOMBRE DE CONTENANTS de la série (Σ des pains de ses gouttières,
 * `sommeContenants`), pas une longueur.
 *   - plant acheté : plants = contenants × trous × plants par trou ; plantsACommander avec la marge ;
 *   - plant maison : mottesEnPlace = contenants × trous × plants par trou (puis comme T05) ;
 *   - semis direct (variante `facon: 'contenants'`) : poquets = contenants × trous ;
 *     graines = ⌈poquets × graines par trou × (100 + marge) ÷ germination⌉ ; poids si PMG connu.
 * Les autres façons de compter ne changent pas.
 *
 * `painsParDefaut(longueurM)` : nombre de pains proposé pour une gouttière, 1 pain par mètre,
 * longueur arrondie, au moins 1.
 */
import { describe, expect, it } from 'vitest';
import {
  BORNES_CONTENANTS,
  besoinsSerie,
  detecterConflits,
  type DateCalendaire,
  type Emplacement,
  type Id,
  type Occupation,
  painsParDefaut,
  sommeContenants,
  type DensiteContenants,
  type ItineraireBesoins,
  type Pourcentage,
} from '../index.ts';

const pct = (n: number): Pourcentage => n;

const trous = (trousParContenant: number, plantsParTrou?: number): DensiteContenants =>
  plantsParTrou === undefined ? { facon: 'contenants', trousParContenant } : { facon: 'contenants', trousParContenant, plantsParTrou };

const achete = (densite: DensiteContenants, marge = 0): ItineraireBesoins => ({ mode: 'plant_achete', densite, margeSecurite: pct(marge) });

describe('T51 : nombre de pains d’une gouttière', () => {
  it('1 pain par mètre, longueur arrondie', () => {
    expect(painsParDefaut(30)).toBe(30);
    expect(painsParDefaut(29.6)).toBe(30);
    expect(painsParDefaut(12.4)).toBe(12);
  });

  it('au moins un pain, même pour une gouttière de moins d’un mètre', () => {
    expect(painsParDefaut(0.3)).toBe(1);
  });

  it('somme des pains de plusieurs gouttières', () => {
    expect(sommeContenants([30, 30])).toBe(60);
    expect(sommeContenants([])).toBe(0);
  });

  it('bornes des trous, plants et graines par trou', () => {
    expect(BORNES_CONTENANTS.trousParContenantMax).toBeGreaterThanOrEqual(12);
    expect(BORNES_CONTENANTS.plantsParTrouMax).toBeGreaterThanOrEqual(1);
    expect(BORNES_CONTENANTS.grainesParTrouMax).toBeGreaterThanOrEqual(3);
  });
});

describe('T51 : plants d’une série en contenants (Σ pains × trous par pain)', () => {
  it('2 gouttières de 30 pains, Gariguette 12 trous par pain, 1 plant par trou → 720 plants', () => {
    const b = besoinsSerie(achete(trous(12)), sommeContenants([30, 30]));
    expect(b).toStrictEqual({ mode: 'plant_achete', plants: 720, plantsACommander: 720 });
  });

  it('même gouttières, Manon ou Dream 10 trous par pain → 600 plants', () => {
    const b = besoinsSerie(achete(trous(10)), sommeContenants([30, 30]));
    expect(b).toStrictEqual({ mode: 'plant_achete', plants: 600, plantsACommander: 600 });
  });

  it('plants par trou absent = 1 ; 2 plants par trou doublent les plants', () => {
    expect(besoinsSerie(achete(trous(12, 1)), 60)).toStrictEqual(besoinsSerie(achete(trous(12)), 60));
    expect(besoinsSerie(achete(trous(12, 2)), 60)).toStrictEqual({ mode: 'plant_achete', plants: 1440, plantsACommander: 1440 });
  });

  it('marge de sécurité comme T05 : 720 plants + 10 % → 792 à commander', () => {
    expect(besoinsSerie(achete(trous(12), 10), 60)).toStrictEqual({ mode: 'plant_achete', plants: 720, plantsACommander: 792 });
  });

  it('plant maison en contenants : mottes en place = pains × trous, puis pépinière comme T05', () => {
    const b = besoinsSerie(
      {
        mode: 'plant_maison',
        densite: trous(12),
        grainesParMotte: 1,
        plantsParMotte: 1,
        germination: pct(100),
        pertePepiniere: pct(0),
        alveolesParPlaque: null,
        margeSecurite: pct(0),
        pmgMg: null,
      },
      60,
    );
    expect(b).toStrictEqual({ mode: 'plant_maison', mottesEnPlace: 720, plants: 720, mottesAPlanter: 720, mottesASemer: 720, graines: 720 });
  });

  it('semis direct : 3 graines par trou, germination 80 %, marge 10 % → graines attendues', () => {
    // 60 pains × 12 trous = 720 poquets ; 720 × 3 = 2 160 graines ; × 110 % ÷ 80 % = 2 970.
    const b = besoinsSerie(
      {
        mode: 'semis_direct',
        facon: 'contenants',
        densite: { facon: 'contenants', trousParContenant: 12, grainesParTrou: 3 },
        germination: pct(80),
        margeSecurite: pct(10),
        pmgMg: null,
      },
      sommeContenants([30, 30]),
    );
    expect(b).toStrictEqual({ mode: 'semis_direct', facon: 'contenants', poquets: 720, graines: 2970 });
  });

  it('semis direct : arrondi au-dessus et poids des semences si le PMG est connu', () => {
    // 1 pain × 1 trou × 1 graine, germination 90 % : ⌈1 × 100 ÷ 90⌉ = 2 graines ; PMG 250 g → 0,5 g → 5 dg.
    const b = besoinsSerie(
      {
        mode: 'semis_direct',
        facon: 'contenants',
        densite: { facon: 'contenants', trousParContenant: 1, grainesParTrou: 1 },
        germination: pct(90),
        margeSecurite: pct(0),
        pmgMg: 250_000,
      },
      1,
    );
    expect(b).toStrictEqual({ mode: 'semis_direct', facon: 'contenants', poquets: 1, graines: 2, poidsDg: 5 });
  });

  it('aucun pain → aucun plant', () => {
    expect(besoinsSerie(achete(trous(12)), 0)).toStrictEqual({ mode: 'plant_achete', plants: 0, plantsACommander: 0 });
  });

  it('trous par pain non entier ou nul : refusé (RangeError), jamais un calcul faux', () => {
    expect(() => besoinsSerie(achete(trous(0)), 60)).toThrow(RangeError);
    expect(() => besoinsSerie(achete(trous(12.5)), 60)).toThrow(RangeError);
    expect(() => besoinsSerie(achete(trous(12, 0)), 60)).toThrow(RangeError);
  });

  it('les autres façons de compter ne changent pas (écartement, 30 m, 2 rangs à 30 cm → 200 plants)', () => {
    const b = besoinsSerie(
      { mode: 'plant_achete', densite: { facon: 'ecartement', rangsParPlanche: 2, ecartementSurRangCm: 30 }, margeSecurite: pct(0) },
      3000,
    );
    expect(b).toStrictEqual({ mode: 'plant_achete', plants: 200, plantsACommander: 200 });
  });
});

describe('T51 : une gouttière se remplit par pains (conflits de T03)', () => {
  const d = (x: string) => x as DateCalendaire;
  // Ancienne gouttière : 360 « places » saisies avant T51, 30 pains (30 m).
  const g: Emplacement = {
    id: 'g1' as Id<'Emplacement'>,
    fermeId: 'f' as Id<'Ferme'>,
    supprimeLe: null,
    zoneId: 'z' as Id<'Zone'>,
    code: 'G1',
    sorte: 'gouttiere',
    longueurM: 30,
    largeurM: null,
    nombrePains: 30,
    nombrePlaces: 360,
    actifDu: d('2020-01-01'),
    actifAu: null,
    remplace: [],
    placementXM: null,
    placementYM: null,
    orientationDeg: null,
  };
  const occ = (nom: string, pains: number): Occupation => ({
    id: nom as Id<'Occupation'>,
    fermeId: 'f' as Id<'Ferme'>,
    supprimeLe: null,
    emplacementId: g.id,
    occupant: { sorte: 'serie', serieId: nom as Id<'Serie'> },
    place: { unite: 'places', nombrePlaces: pains },
    positionM: null,
    prevuDu: d('2027-03-01'),
    prevuAu: d('2027-07-01'),
    reel: null,
  });

  it('fraises sur 20 pains et haricots sur 10 : la gouttière est pleine juste', () => {
    expect(detecterConflits(g, [occ('fraises', 20), occ('haricots', 10)])).toEqual([]);
  });

  it('un pain de trop : conflit, l’ancien nombre de places ne compte plus', () => {
    const c = detecterConflits(g, [occ('fraises', 20), occ('haricots', 11)]);
    expect(c.map((x) => x.sorte)).toEqual(['surcharge']);
  });
});

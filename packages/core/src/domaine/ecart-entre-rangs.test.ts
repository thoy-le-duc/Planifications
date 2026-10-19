/**
 * Tests d'acceptation T43, côté cœur — l'écart entre rangs, une vraie donnée de l'itinéraire
 * (docs/backlog/T43-ecart-entre-rangs.md, règles 1 et 5).
 *
 * ── API attendue ─────────────────────────────────────────────────────────────────────────────
 *
 * packages/core/src/domaine/densite.ts (réexporté par domaine/index.ts, donc par @planif/core) :
 *
 *   const ECART_ENTRE_RANGS_MIN_CM = 5
 *   const ECART_ENTRE_RANGS_MAX_CM = 200
 *   function ecartEntreRangsDe(densite: Densite): Centimetres | null
 *     // la valeur saisie, à l'écartement ou au mètre linéaire ; absente ou à la volée → null
 *
 * packages/core/src/domaine/entites.ts : `DensiteEcartement` et `DensiteMetreLineaire` gagnent le
 *   champ FACULTATIF `readonly ecartEntreRangsCm?: Centimetres` (clé du jsonb `parametres`, comme
 *   `disposition` en T35a : absente = ancien comportement, aucune ligne réécrite).
 *
 * Validation (`lireParametres`, donc `validerItineraire` et `validerSerie`, rejoués par le
 * serveur) :
 *   - absente : acceptée, la densité est rendue TELLE QUELLE (aucune clé ajoutée) ;
 *   - nombre de 5 à 200 (bornes comprises, décimal permis) à l'écartement ou au mètre
 *     linéaire : acceptée, gardée ;
 *   - nombre hors de [5, 200] : { code: 'hors_bornes', champ: 'parametres.densite.ecartEntreRangsCm' } ;
 *   - autre chose qu'un nombre fini (texte, null, booléen, objet) : { code: 'champ_invalide', même champ } ;
 *   - sur une densité à la volée (pas de rangs) : { code: 'champ_invalide', même champ } ;
 *   message en français qui nomme l'écart entre rangs (et les bornes quand elles sont en cause).
 *   Rangs × écart plus large que la planche n'est PAS une règle du cœur (simple avertissement à l'écran).
 *
 * Besoins (T05) : l'écart entre rangs ne change PAS les besoins en semences ni en plants.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { besoinsSerie, type ItineraireBesoins } from '../planification/besoins.ts';
import { validerItineraire } from '../saisies/itineraire.ts';
import { validerSerie } from '../saisies/serie.ts';
import type { Densite } from './entites.ts';

interface ModuleEcart {
  readonly ECART_ENTRE_RANGS_MIN_CM: number;
  readonly ECART_ENTRE_RANGS_MAX_CM: number;
  ecartEntreRangsDe(densite: Densite): number | null;
}

const CHEMIN_DOMAINE = './index.ts';
let charge: Partial<ModuleEcart> = {};

beforeAll(async () => {
  charge = (await import(/* @vite-ignore */ CHEMIN_DOMAINE)) as Partial<ModuleEcart>;
});

function m(): ModuleEcart {
  if (typeof charge.ecartEntreRangsDe !== 'function') throw new Error('ecartEntreRangsDe absent du domaine');
  return charge as ModuleEcart;
}

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

/** Batavia de T02 : plant maison, 3 rangs, un plant tous les 30 cm (sans écart entre rangs : d'avant T43). */
const ECARTEMENT = { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 } as const;
const METRE_LINEAIRE = { facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 50 } as const;
const VOLEE = { facon: 'volee', largeurSemeeCm: 60, doseGParM2: 2 } as const;

const COMMUNS = {
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

const PLANT_MAISON = { mode: 'plant_maison', ...COMMUNS, dureePepiniereJours: 28, grainesParMotte: 1, plantsParMotte: 1, pertePepiniere: 10, alveolesParPlaque: 77 };
const SEMIS_DIRECT = { mode: 'semis_direct', ...COMMUNS };

function itineraire(parametres: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: uuid(1),
    ferme_id: uuid(2),
    espece_id: uuid(3),
    variete_id: null,
    nom: 'Itinéraire T43',
    mode: parametres.mode,
    parametres: JSON.stringify(parametres),
    supprime_le: null,
  };
}

const plantMaison = (densite: Readonly<Record<string, unknown>>) => itineraire({ ...PLANT_MAISON, densite });
const semisDirect = (densite: Readonly<Record<string, unknown>>, grainesParPoquet: number | null) => itineraire({ ...SEMIS_DIRECT, densite, grainesParPoquet });

/** Densité relue par le cœur, ou échec du test avec l'erreur rendue. */
function densiteRelue(ligne: Record<string, unknown>): unknown {
  const r = validerItineraire(ligne);
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return r.ok ? r.valeur.parametres.densite : undefined;
}

function refus(ligne: Record<string, unknown>): { code: string; champ: string | null; message: string } {
  const r = validerItineraire(ligne);
  expect(r.ok, JSON.stringify(r)).toBe(false);
  if (r.ok) throw new Error('accepté');
  return r.erreur;
}

describe('T43 : écart entre rangs dans le domaine', () => {
  it('bornes : 5 à 200 cm', () => {
    expect(m().ECART_ENTRE_RANGS_MIN_CM).toBe(5);
    expect(m().ECART_ENTRE_RANGS_MAX_CM).toBe(200);
  });

  it('ecartEntreRangsDe : la valeur saisie à l’écartement et au mètre linéaire ; absente ou à la volée → null', () => {
    expect(m().ecartEntreRangsDe({ ...ECARTEMENT, ecartEntreRangsCm: 30 })).toBe(30);
    expect(m().ecartEntreRangsDe({ ...METRE_LINEAIRE, ecartEntreRangsCm: 15 })).toBe(15);
    expect(m().ecartEntreRangsDe(ECARTEMENT)).toBeNull();
    expect(m().ecartEntreRangsDe(METRE_LINEAIRE)).toBeNull();
    expect(m().ecartEntreRangsDe(VOLEE)).toBeNull();
  });
});

describe('T43 : validation d’un itinéraire (rejouée par le serveur)', () => {
  it('absente : acceptée, densité rendue sans clé ajoutée (aucune ligne existante réécrite)', () => {
    expect(densiteRelue(plantMaison(ECARTEMENT))).toStrictEqual(ECARTEMENT);
    expect(densiteRelue(semisDirect(METRE_LINEAIRE, null))).toStrictEqual(METRE_LINEAIRE);
    expect(densiteRelue(semisDirect(VOLEE, null))).toStrictEqual(VOLEE);
  });

  it.each([[5], [12.5], [30], [120], [200]])('%j cm à l’écartement : accepté et gardé', (cm) => {
    const densite = { ...ECARTEMENT, ecartEntreRangsCm: cm };
    expect(densiteRelue(plantMaison(densite))).toStrictEqual(densite);
  });

  it('au mètre linéaire (carotte, 4 rangs à 15 cm) et en quinconce : accepté et gardé', () => {
    const ml = { ...METRE_LINEAIRE, ecartEntreRangsCm: 15 };
    expect(densiteRelue(semisDirect(ml, null))).toStrictEqual(ml);
    const quinconce = { ...ECARTEMENT, disposition: 'quinconce', ecartEntreRangsCm: 30 };
    expect(densiteRelue(plantMaison(quinconce))).toStrictEqual(quinconce);
  });

  it('rangs × écart plus large que la planche : accepté (avertissement seulement, à l’écran)', () => {
    const large = { facon: 'ecartement', rangsParPlanche: 6, ecartementSurRangCm: 30, ecartEntreRangsCm: 60 };
    expect(densiteRelue(plantMaison(large))).toStrictEqual(large);
  });

  it.each([[4.9], [0], [-10], [200.5], [1000]])('%j cm : refusé hors bornes, message en français', (cm) => {
    const e = refus(plantMaison({ ...ECARTEMENT, ecartEntreRangsCm: cm }));
    expect(e.code).toBe('hors_bornes');
    expect(e.champ).toBe('parametres.densite.ecartEntreRangsCm');
    expect(e.message).toMatch(/écart entre (les )?rangs/i);
    expect(e.message).toMatch(/5/);
    expect(e.message).toMatch(/200/);
    expect(e.message.length).toBeLessThanOrEqual(200);
  });

  it.each([['30'], [null], [true], [{ cm: 30 }], [[30]]])('%j : refusé, un nombre est attendu', (valeur) => {
    const e = refus(plantMaison({ ...ECARTEMENT, ecartEntreRangsCm: valeur }));
    expect(e.code).toBe('champ_invalide');
    expect(e.champ).toBe('parametres.densite.ecartEntreRangsCm');
    expect(e.message).toMatch(/écart entre (les )?rangs/i);
  });

  it('à la volée : refusé (pas de rangs)', () => {
    const e = refus(semisDirect({ ...VOLEE, ecartEntreRangsCm: 20 }, null));
    expect(e.code).toBe('champ_invalide');
    expect(e.champ).toBe('parametres.densite.ecartEntreRangsCm');
    expect(e.message).toMatch(/écart entre (les )?rangs/i);
  });

  it('l’instantané d’une série suit la même règle', () => {
    const serie = (densite: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
      id: uuid(10),
      ferme_id: uuid(2),
      saison_id: uuid(11),
      espece_id: uuid(3),
      variete_id: null,
      itineraire_id: uuid(1),
      parametres: JSON.stringify({ ...PLANT_MAISON, densite }),
      ancre_type: 'plantation',
      ancre_date: '2027-04-05',
      prevu_semis_pepiniere: '2027-03-08',
      prevu_mise_en_place: '2027-04-05',
      prevu_debut_recolte: '2027-05-24',
      prevu_fin_recolte: '2027-06-07',
      longueur_m: 30,
      nombre_plants: null,
      statut: 'prevue',
      rotation_acceptee: null,
      supprime_le: null,
    });
    const gardee = validerSerie(serie({ ...ECARTEMENT, ecartEntreRangsCm: 30 }));
    expect(gardee, JSON.stringify(gardee)).toMatchObject({ ok: true });
    if (gardee.ok) expect((JSON.parse(JSON.stringify(gardee.valeur.parametres)) as { densite: unknown }).densite).toStrictEqual({ ...ECARTEMENT, ecartEntreRangsCm: 30 });
    const refusee = validerSerie(serie({ ...ECARTEMENT, ecartEntreRangsCm: 300 }));
    expect(refusee.ok).toBe(false);
    if (!refusee.ok) expect(refusee.erreur.champ).toBe('parametres.densite.ecartEntreRangsCm');
    expect(validerSerie(serie(ECARTEMENT)), 'sans écart entre rangs : acceptée').toMatchObject({ ok: true });
  });
});

describe('T43 : les besoins en semences et en plants ne changent pas (T05)', () => {
  // Variables (pas de littéraux frais) : passent le typage avant comme après l'ajout du champ.
  const sans = { facon: 'ecartement' as const, rangsParPlanche: 3, ecartementSurRangCm: 30 };
  const avec = { facon: 'ecartement' as const, rangsParPlanche: 3, ecartementSurRangCm: 30, ecartEntreRangsCm: 25 };
  const large = { facon: 'ecartement' as const, rangsParPlanche: 3, ecartementSurRangCm: 30, ecartEntreRangsCm: 150 };
  const mlSans = { facon: 'metre_lineaire' as const, rangsParPlanche: 4, grainesParMetre: 50 };
  const mlAvec = { facon: 'metre_lineaire' as const, rangsParPlanche: 4, grainesParMetre: 50, ecartEntreRangsCm: 15 };

  const cas: readonly [string, (d: typeof sans) => ItineraireBesoins][] = [
    ['plant acheté', (densite) => ({ mode: 'plant_achete', densite, margeSecurite: 10 })],
    [
      'plant maison',
      (densite) => ({
        mode: 'plant_maison',
        densite,
        grainesParMotte: 1,
        plantsParMotte: 1,
        germination: 90,
        pertePepiniere: 10,
        alveolesParPlaque: 77,
        margeSecurite: 10,
        pmgMg: 1200,
      }),
    ],
    ['semis direct à l’écartement', (densite) => ({ mode: 'semis_direct', facon: 'ecartement', densite, grainesParPoquet: 2, germination: 80, margeSecurite: 10, pmgMg: 1200 })],
  ];

  it.each(cas)('%s : mêmes besoins sans écart entre rangs, à 25 cm et à 150 cm (30 m)', (_nom, it) => {
    const reference = besoinsSerie(it(sans), 3000);
    expect(besoinsSerie(it(avec), 3000)).toStrictEqual(reference);
    expect(besoinsSerie(it(large), 3000)).toStrictEqual(reference);
  });

  it('semis direct au mètre linéaire : mêmes graines avec ou sans écart entre rangs', () => {
    const reference = besoinsSerie({ mode: 'semis_direct', facon: 'metre_lineaire', densite: mlSans, margeSecurite: 10, pmgMg: 1200 }, 3000);
    expect(besoinsSerie({ mode: 'semis_direct', facon: 'metre_lineaire', densite: mlAvec, margeSecurite: 10, pmgMg: 1200 }, 3000)).toStrictEqual(reference);
  });

  it('plant acheté, 30 m, 3 rangs à 30 cm sur le rang, rangs à 25 cm : 300 plants, 330 à commander', () => {
    expect(besoinsSerie({ mode: 'plant_achete', densite: avec, margeSecurite: 10 }, 3000)).toStrictEqual({ mode: 'plant_achete', plants: 300, plantsACommander: 330 });
  });
});

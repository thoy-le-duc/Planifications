/**
 * Tests d'acceptation T35a, côté cœur — rangs alignés ou en quinconce
 * (docs/backlog/T35a-schema-rangs.md, Q34).
 *
 * ── API attendue ─────────────────────────────────────────────────────────────────────────────
 *
 * packages/core/src/domaine/densite.ts (réexporté par domaine/index.ts, donc par @planif/core) :
 *
 *   type DispositionRangs = 'alignee' | 'quinconce';
 *   const DISPOSITIONS_RANGS: readonly DispositionRangs[]   // ['alignee', 'quinconce']
 *   function dispositionDe(densite: DensiteEcartement): DispositionRangs
 *     // la disposition de la densité ; absente → 'alignee' (aucune ligne existante réécrite)
 *
 * packages/core/src/domaine/entites.ts : `DensiteEcartement` gagne le champ FACULTATIF
 *   `readonly disposition?: DispositionRangs`.
 *
 * Validation (packages/core/src/saisies/lignes.ts, `lireParametres`, donc `validerItineraire`
 * et `validerSerie`, rejoués par le serveur à chaque écriture) :
 *   - `parametres.densite.disposition` absente : acceptée, et la densité est rendue TELLE QUELLE
 *     (la clé n'est pas ajoutée : aucune ligne existante réécrite) ;
 *   - 'alignee' ou 'quinconce' : acceptée, gardée ;
 *   - toute autre valeur : refus { code: 'champ_invalide', champ: 'parametres.densite.disposition' }
 *     avec un message en français qui nomme la disposition et les deux valeurs permises
 *     (« alignés » / « quinconce »).
 *
 * Besoins (T05, packages/core/src/planification/besoins.ts) : la disposition ne change PAS le
 * nombre de plants. Aucun test T05 n'est modifié ; celui-ci le prouve.
 *
 * Le module densite.ts est chargé par import dynamique (chemin tenu dans une variable) : le
 * typage du test ne dépend pas du code pas encore écrit.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { besoinsSerie, type ItineraireBesoins } from '../planification/besoins.ts';
import { validerItineraire } from '../saisies/itineraire.ts';
import { validerSerie } from '../saisies/serie.ts';
import type { DensiteEcartement } from './entites.ts';

type DispositionRangs = 'alignee' | 'quinconce';

interface ModuleDensite {
  readonly DISPOSITIONS_RANGS: readonly DispositionRangs[];
  dispositionDe(densite: DensiteEcartement): DispositionRangs;
}

const CHEMIN_DENSITE = './densite.ts';
const CHEMIN_DOMAINE = './index.ts';

let charge: ModuleDensite | undefined;

beforeAll(async () => {
  // Module absent : seuls les tests qui s'en servent échouent ; ceux de la validation et des
  // besoins tournent quand même.
  charge = await (import(/* @vite-ignore */ CHEMIN_DENSITE) as Promise<ModuleDensite>).catch(() => undefined);
});

const m = {
  get DISPOSITIONS_RANGS(): readonly DispositionRangs[] {
    if (charge === undefined) throw new Error(`module ${CHEMIN_DENSITE} absent`);
    return charge.DISPOSITIONS_RANGS;
  },
  dispositionDe(densite: DensiteEcartement): DispositionRangs {
    if (charge === undefined) throw new Error(`module ${CHEMIN_DENSITE} absent`);
    return charge.dispositionDe(densite);
  },
};

const uuid = (n: number): string => `0192f0c1-7a6e-7cc3-9b1e-${n.toString(16).padStart(12, '0')}`;

/** Densité de la batavia de T02 : 3 rangs, un plant tous les 30 cm (sans disposition : d'avant T35a). */
const DENSITE = { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 } as const;

const BATAVIA = {
  mode: 'plant_maison',
  densite: DENSITE,
  dureePepiniereJours: 28,
  grainesParMotte: 1,
  plantsParMotte: 1,
  pertePepiniere: 10,
  alveolesParPlaque: 77,
  periodeUsage: null,
  typeAbri: 'tunnel',
  dureeAvantRecolteJours: 49,
  fenetreRecolteJours: 14,
  margeSecurite: 10,
  rendementAttendu: null,
  perenne: null,
};

function itineraire(densite: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: uuid(1),
    ferme_id: uuid(2),
    espece_id: uuid(3),
    variete_id: null,
    nom: 'Batavia de printemps',
    mode: 'plant_maison',
    parametres: JSON.stringify({ ...BATAVIA, densite }),
    supprime_le: null,
  };
}

/** Densité relue par le cœur, ou échec du test avec l'erreur rendue. */
function densiteRelue(densite: Readonly<Record<string, unknown>>): unknown {
  const r = validerItineraire(itineraire(densite));
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return r.ok ? r.valeur.parametres.densite : undefined;
}

describe('T35a : disposition des rangs dans la densité « écartement »', () => {
  it('deux valeurs : alignee et quinconce', () => {
    expect([...m.DISPOSITIONS_RANGS]).toStrictEqual(['alignee', 'quinconce']);
  });

  it('densité sans disposition (itinéraire d’avant T35a) → alignee', () => {
    expect(m.dispositionDe({ facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 })).toBe('alignee');
  });

  it('disposition donnée : rendue telle quelle', () => {
    const quinconce = { ...DENSITE, disposition: 'quinconce' as const };
    const alignee = { ...DENSITE, disposition: 'alignee' as const };
    expect(m.dispositionDe(quinconce)).toBe('quinconce');
    expect(m.dispositionDe(alignee)).toBe('alignee');
  });

  it('exporté par le domaine (donc par @planif/core)', async () => {
    const domaine = (await import(/* @vite-ignore */ CHEMIN_DOMAINE)) as Partial<ModuleDensite>;
    expect(typeof domaine.dispositionDe).toBe('function');
    expect(domaine.DISPOSITIONS_RANGS).toStrictEqual(['alignee', 'quinconce']);
  });
});

describe('T35a : validation d’un itinéraire (rejouée par le serveur)', () => {
  it('sans disposition : accepté, densité rendue sans clé ajoutée (aucune ligne existante réécrite)', () => {
    expect(densiteRelue(DENSITE)).toStrictEqual(DENSITE);
  });

  it('« quinconce » et « alignee » : acceptés et gardés', () => {
    expect(densiteRelue({ ...DENSITE, disposition: 'quinconce' })).toStrictEqual({ ...DENSITE, disposition: 'quinconce' });
    expect(densiteRelue({ ...DENSITE, disposition: 'alignee' })).toStrictEqual({ ...DENSITE, disposition: 'alignee' });
  });

  it.each([['zigzag'], ['Quinconce'], ['alignés'], [''], [2], [true], [{ valeur: 'quinconce' }]])('disposition %j : refusée, message en français', (valeur) => {
    const r = validerItineraire(itineraire({ ...DENSITE, disposition: valeur }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erreur.code).toBe('champ_invalide');
    expect(r.erreur.champ).toBe('parametres.densite.disposition');
    expect(r.erreur.message).toMatch(/disposition/i);
    expect(r.erreur.message).toMatch(/align/i);
    expect(r.erreur.message).toMatch(/quinconce/i);
    expect(r.erreur.message.length).toBeLessThanOrEqual(200);
  });

  it('l’instantané d’une série suit la même règle : disposition inconnue refusée', () => {
    const serie = (densite: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
      id: uuid(10),
      ferme_id: uuid(2),
      saison_id: uuid(11),
      espece_id: uuid(3),
      variete_id: null,
      itineraire_id: uuid(1),
      parametres: JSON.stringify({ ...BATAVIA, densite }),
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
    const refusee = validerSerie(serie({ ...DENSITE, disposition: 'zigzag' }));
    expect(refusee.ok).toBe(false);
    if (!refusee.ok) expect(refusee.erreur.champ).toBe('parametres.densite.disposition');
    const quinconce = validerSerie(serie({ ...DENSITE, disposition: 'quinconce' }));
    expect(quinconce, JSON.stringify(quinconce)).toMatchObject({ ok: true });
    expect(validerSerie(serie(DENSITE)), 'sans disposition : acceptée').toMatchObject({ ok: true });
  });
});

describe('T35a : le nombre de plants ne change pas (besoins de T05)', () => {
  // Variables (pas de littéraux frais) : passent le typage avant comme après l'ajout du champ.
  const alignee = { facon: 'ecartement' as const, rangsParPlanche: 3, ecartementSurRangCm: 30, disposition: 'alignee' as const };
  const quinconce = { facon: 'ecartement' as const, rangsParPlanche: 3, ecartementSurRangCm: 30, disposition: 'quinconce' as const };
  const sans = { facon: 'ecartement' as const, rangsParPlanche: 3, ecartementSurRangCm: 30 };

  const cas: readonly [string, (d: DensiteEcartement) => ItineraireBesoins][] = [
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

  it.each(cas)('%s : mêmes besoins sans disposition, alignés et en quinconce (30 m, 3 rangs, 30 cm)', (_nom, it) => {
    const reference = besoinsSerie(it(sans), 3000);
    expect(besoinsSerie(it(alignee), 3000)).toStrictEqual(reference);
    expect(besoinsSerie(it(quinconce), 3000)).toStrictEqual(reference);
  });

  it('plant acheté, 30 m, 3 rangs à 30 cm en quinconce : 300 plants, 330 à commander (comme alignés)', () => {
    expect(besoinsSerie({ mode: 'plant_achete', densite: quinconce, margeSecurite: 10 }, 3000)).toStrictEqual({ mode: 'plant_achete', plants: 300, plantsACommander: 330 });
  });
});

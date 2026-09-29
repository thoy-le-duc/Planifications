/**
 * Tests d'acceptation T08 — compatibilité des types du schéma Drizzle avec les entités de T01.
 *
 * Sans base de données : vérifié par `pnpm typecheck` (expectTypeOf) et par les allers-retours
 * exécutés ici.
 *
 * Pourquoi des fonctions de conversion : les entités de T01 sont imbriquées et discriminées
 * (Serie.ancre, Serie.taille, Occupation.occupant, Occupation.place, Evenement.detail…), alors
 * qu'une ligne SQL est plate. Un `$inferSelect` ne peut donc pas être égal à `Serie`. Le contrat
 * est une paire de fonctions pures par entité, sans perte dans les deux sens.
 *
 * ── API attendue de @planif/db (packages/db/src/index.ts) ───────────────────────────────────
 *
 * Tables Drizzle : serie, occupation, emplacement, evenement (et les 17 autres, voir
 * schema.integration.test.ts).
 *
 * Pour X ∈ { Serie, Occupation, Emplacement, Evenement }, table x :
 *   ligneDepuisX(entite: X): Ligne<typeof x>
 *   xDepuisLigne(ligne: Ligne<typeof x>): X
 * où Ligne<T> = Omit<T['$inferSelect'], 'creeLe' | 'modifieLe'> : une ligne complète, sans les
 * horodatages techniques que la base remplit par défaut. Elle s'insère telle quelle
 * (compatible avec `$inferInsert`), et une ligne lue (`$inferSelect`) se relit telle quelle.
 * Aller-retour exact : xDepuisLigne(ligneDepuisX(e)) est strictement égal à e.
 *
 * ── Correspondance attendue ─────────────────────────────────────────────────────────────────
 *
 * - Noms : clés camelCase côté TypeScript, colonnes snake_case côté base (`fermeId` ↔ `ferme_id`).
 * - Dates calendaires (DateCalendaire) : colonnes `date` en mode chaîne, 'AAAA-MM-JJ'
 *   (`date({ mode: 'string' })`), jamais d'objet Date. Seuls les instants (creeLe, modifieLe,
 *   supprimeLe, horodatage : `timestamptz`) peuvent être des Date côté ligne ; côté domaine ce
 *   sont des Instant (millisecondes).
 * - Les colonnes jsonb sont typées (`.$type<…>()`) : aucune colonne `unknown`.
 * - Un champ facultatif du domaine (null, ou absent comme DatesPrevuesSerie.semisPepiniere)
 *   devient NULL en base, et redevient null ou absent à la relecture.
 * - Serie : ancre → ancre_type + ancre_date ; datesPrevues → prevu_semis_pepiniere,
 *   prevu_mise_en_place, prevu_debut_recolte, prevu_fin_recolte ; taille → longueur_m ou
 *   nombre_plants ; parametres → jsonb (instantané, tel quel).
 * - Occupation : occupant → serie_id | plantation_id | evenement_id (couverture) ;
 *   place → longueur_m | nombre_places ; reel → reel_du + reel_au (reel null ⇔ les deux NULL).
 * - Emplacement : sorte ; nombre_places NULL sauf gouttière ; remplace → uuid[] `remplace`.
 * - Evenement : culture → serie_id | campagne_id ; emplacementIds → uuid[] `emplacement_ids` ;
 *   photos → text[] `photos` ; remplaceEvenement → remplace_sorte + remplace_evenement_id ;
 *   detail → jsonb, l'objet Detail* de T01 tel quel (clés camelCase), discriminé par `type`.
 */
import type { DateCalendaire, Emplacement, Evenement, Id, NomEntite, Occupation, Serie } from '@planif/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  emplacement,
  emplacementDepuisLigne,
  evenement,
  evenementDepuisLigne,
  ligneDepuisEmplacement,
  ligneDepuisEvenement,
  ligneDepuisOccupation,
  ligneDepuisSerie,
  occupation,
  occupationDepuisLigne,
  serie,
  serieDepuisLigne,
} from './index.ts';

// ---------------------------------------------------------------------------------------------
// Outils de typage
// ---------------------------------------------------------------------------------------------

type Lue<T extends { $inferSelect: object }> = T['$inferSelect'];

/** Clés dont le type admet un objet Date (ou `unknown`, qui l'admet aussi). */
type ClesDate<T> = { [K in keyof T]-?: Date extends T[K] ? K : never }[keyof T];

/** Clés qui ne sont pas en camelCase. */
type ClesSnake<T> = Extract<keyof T, `${string}_${string}`>;

type Instants = 'creeLe' | 'modifieLe' | 'supprimeLe' | 'horodatage';

const date = (s: string): DateCalendaire => s as DateCalendaire;
const id = <E extends NomEntite>(n: number): Id<E> =>
  `0190a5c8-0000-7000-8000-${n.toString(16).padStart(12, '0')}` as Id<E>;

const FERME = id<'Ferme'>(1);
const INSTANT_SUPPRESSION = Date.UTC(2027, 5, 1, 8, 30, 0, 123);

// ---------------------------------------------------------------------------------------------
// Serie
// ---------------------------------------------------------------------------------------------

describe('Serie ↔ table serie', () => {
  it('types : conversion dans les deux sens, colonnes camelCase, dates en chaîne', () => {
    expectTypeOf(serieDepuisLigne).returns.toEqualTypeOf<Serie>();
    expectTypeOf(ligneDepuisSerie).parameter(0).toEqualTypeOf<Serie>();
    expectTypeOf(ligneDepuisSerie).returns.toExtend<typeof serie.$inferInsert>();
    expectTypeOf<Lue<typeof serie>>().toExtend<Parameters<typeof serieDepuisLigne>[0]>();
    expectTypeOf<ReturnType<typeof ligneDepuisSerie>>().toExtend<Parameters<typeof serieDepuisLigne>[0]>();

    expectTypeOf<ClesSnake<Lue<typeof serie>>>().toEqualTypeOf<never>();
    expectTypeOf<ClesDate<Lue<typeof serie>>>().toExtend<Instants>();

    expectTypeOf<Lue<typeof serie>['id']>().toExtend<string>();
    expectTypeOf<Lue<typeof serie>['fermeId']>().toExtend<string>();
    expectTypeOf<Lue<typeof serie>>().toHaveProperty('supprimeLe');
    expectTypeOf<Lue<typeof serie>>().toHaveProperty('creeLe');
    expectTypeOf<Lue<typeof serie>>().toHaveProperty('modifieLe');
    expectTypeOf<Lue<typeof serie>['ancreDate']>().toExtend<string>();
    expectTypeOf<Lue<typeof serie>['prevuSemisPepiniere']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof serie>['prevuMiseEnPlace']>().toExtend<string>();
    expectTypeOf<Lue<typeof serie>['prevuDebutRecolte']>().toExtend<string>();
    expectTypeOf<Lue<typeof serie>['prevuFinRecolte']>().toExtend<string>();
  });

  const plantMaison: Serie = {
    id: id<'Serie'>(10),
    fermeId: FERME,
    supprimeLe: null,
    saisonId: id<'Saison'>(11),
    especeId: id<'Espece'>(12),
    varieteId: null,
    itineraireId: id<'Itineraire'>(13),
    parametres: {
      mode: 'plant_maison',
      densite: { facon: 'ecartement', rangsParPlanche: 3, ecartementSurRangCm: 30 },
      dureePepiniereJours: 28,
      grainesParMotte: 1,
      plantsParMotte: 1,
      pertePepiniere: 10,
      alveolesParPlaque: 77,
      periodeUsage: { semaineDebut: 10, semaineFin: 20 },
      typeAbri: 'tunnel',
      dureeAvantRecolteJours: 50,
      fenetreRecolteJours: 14,
      margeSecurite: 10,
      rendementAttendu: { par: 'plant', quantite: 1, unite: 'piece' },
      perenne: null,
    },
    ancre: { type: 'plantation', date: date('2027-04-05') },
    datesPrevues: {
      semisPepiniere: date('2027-03-08'),
      miseEnPlace: date('2027-04-05'),
      debutRecolte: date('2027-05-25'),
      finRecolte: date('2027-06-08'),
    },
    taille: { unite: 'longueur', longueurM: 30 },
    statut: 'prevue',
  };

  const semisDirect: Serie = {
    id: id<'Serie'>(20),
    fermeId: FERME,
    supprimeLe: INSTANT_SUPPRESSION,
    saisonId: id<'Saison'>(11),
    especeId: id<'Espece'>(21),
    varieteId: id<'Variete'>(22),
    itineraireId: id<'Itineraire'>(23),
    parametres: {
      mode: 'semis_direct',
      densite: { facon: 'metre_lineaire', rangsParPlanche: 4, grainesParMetre: 40 },
      grainesParPoquet: null,
      periodeUsage: null,
      typeAbri: null,
      dureeAvantRecolteJours: 70,
      fenetreRecolteJours: 21,
      margeSecurite: 10,
      rendementAttendu: null,
      perenne: null,
    },
    ancre: { type: 'debut_recolte', date: date('2027-07-01') },
    // Pas de pépinière en semis direct : la clé est absente, pas nulle.
    datesPrevues: {
      miseEnPlace: date('2027-04-22'),
      debutRecolte: date('2027-07-01'),
      finRecolte: date('2027-07-22'),
    },
    taille: { unite: 'plants', nombrePlants: 4000 },
    statut: 'abandonnee',
  };

  it('ligne : colonnes à plat, dates en chaîne AAAA-MM-JJ', () => {
    const l = ligneDepuisSerie(plantMaison);
    expect(l.id).toBe(plantMaison.id);
    expect(l.fermeId).toBe(FERME);
    expect(l.ancreType).toBe('plantation');
    expect(l.ancreDate).toBe('2027-04-05');
    expect(l.prevuSemisPepiniere).toBe('2027-03-08');
    expect(l.prevuMiseEnPlace).toBe('2027-04-05');
    expect(l.prevuDebutRecolte).toBe('2027-05-25');
    expect(l.prevuFinRecolte).toBe('2027-06-08');
    expect(Number(l.longueurM)).toBe(30);
    expect(l.nombrePlants).toBeNull();
    expect(l.parametres).toStrictEqual(plantMaison.parametres);
    expect(l.supprimeLe).toBeNull();

    const d = ligneDepuisSerie(semisDirect);
    expect(d.prevuSemisPepiniere).toBeNull();
    expect(d.longueurM).toBeNull();
    expect(d.nombrePlants).toBe(4000);
    expect(d.supprimeLe).not.toBeNull();
  });

  it('aller-retour sans perte', () => {
    expect(serieDepuisLigne(ligneDepuisSerie(plantMaison))).toStrictEqual(plantMaison);
    expect(serieDepuisLigne(ligneDepuisSerie(semisDirect))).toStrictEqual(semisDirect);
  });
});

// ---------------------------------------------------------------------------------------------
// Occupation
// ---------------------------------------------------------------------------------------------

describe('Occupation ↔ table occupation', () => {
  it('types : conversion dans les deux sens, colonnes camelCase, dates en chaîne', () => {
    expectTypeOf(occupationDepuisLigne).returns.toEqualTypeOf<Occupation>();
    expectTypeOf(ligneDepuisOccupation).parameter(0).toEqualTypeOf<Occupation>();
    expectTypeOf(ligneDepuisOccupation).returns.toExtend<typeof occupation.$inferInsert>();
    expectTypeOf<Lue<typeof occupation>>().toExtend<Parameters<typeof occupationDepuisLigne>[0]>();
    expectTypeOf<ReturnType<typeof ligneDepuisOccupation>>().toExtend<
      Parameters<typeof occupationDepuisLigne>[0]
    >();

    expectTypeOf<ClesSnake<Lue<typeof occupation>>>().toEqualTypeOf<never>();
    expectTypeOf<ClesDate<Lue<typeof occupation>>>().toExtend<Instants>();

    expectTypeOf<Lue<typeof occupation>['fermeId']>().toExtend<string>();
    expectTypeOf<Lue<typeof occupation>['emplacementId']>().toExtend<string>();
    expectTypeOf<Lue<typeof occupation>['serieId']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof occupation>['plantationId']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof occupation>['evenementId']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof occupation>['prevuDu']>().toExtend<string>();
    expectTypeOf<Lue<typeof occupation>['prevuAu']>().toExtend<string>();
    expectTypeOf<Lue<typeof occupation>['reelDu']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof occupation>['reelAu']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof occupation>>().toHaveProperty('supprimeLe');
  });

  const base = {
    fermeId: FERME,
    supprimeLe: null,
    emplacementId: id<'Emplacement'>(30),
    prevuDu: date('2027-04-05'),
    prevuAu: date('2027-06-09'),
  } as const;

  const deSerie: Occupation = {
    ...base,
    id: id<'Occupation'>(31),
    occupant: { sorte: 'serie', serieId: id<'Serie'>(10) },
    place: { unite: 'longueur', longueurM: 15 },
    positionM: null,
    reel: null,
  };

  const dePlantation: Occupation = {
    ...base,
    id: id<'Occupation'>(32),
    occupant: { sorte: 'plantation', plantationId: id<'Plantation'>(33) },
    place: { unite: 'places', nombrePlaces: 24 },
    positionM: null,
    prevuAu: date('2030-01-01'),
    reel: { du: date('2027-04-07'), au: null },
  };

  const couverture: Occupation = {
    ...base,
    id: id<'Occupation'>(34),
    supprimeLe: INSTANT_SUPPRESSION,
    occupant: { sorte: 'couverture', evenementId: id<'Evenement'>(35) },
    place: { unite: 'longueur', longueurM: 12.5 },
    positionM: 17.5,
    reel: { du: date('2027-04-06'), au: date('2027-05-18') },
  };

  it('ligne : une seule cible et une seule place renseignées', () => {
    const s = ligneDepuisOccupation(deSerie);
    expect([s.serieId, s.plantationId, s.evenementId]).toEqual([id(10), null, null]);
    expect(Number(s.longueurM)).toBe(15);
    expect(s.nombrePlaces).toBeNull();
    expect([s.prevuDu, s.prevuAu, s.reelDu, s.reelAu]).toEqual(['2027-04-05', '2027-06-09', null, null]);

    const p = ligneDepuisOccupation(dePlantation);
    expect([p.serieId, p.plantationId, p.evenementId]).toEqual([null, id(33), null]);
    expect(p.longueurM).toBeNull();
    expect(p.nombrePlaces).toBe(24);
    expect([p.reelDu, p.reelAu]).toEqual(['2027-04-07', null]);

    const c = ligneDepuisOccupation(couverture);
    expect([c.serieId, c.plantationId, c.evenementId]).toEqual([null, null, id(35)]);
  });

  it('aller-retour sans perte', () => {
    for (const o of [deSerie, dePlantation, couverture]) {
      expect(occupationDepuisLigne(ligneDepuisOccupation(o))).toStrictEqual(o);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Emplacement
// ---------------------------------------------------------------------------------------------

describe('Emplacement ↔ table emplacement', () => {
  it('types : conversion dans les deux sens, colonnes camelCase, dates en chaîne', () => {
    expectTypeOf(emplacementDepuisLigne).returns.toEqualTypeOf<Emplacement>();
    expectTypeOf(ligneDepuisEmplacement).parameter(0).toEqualTypeOf<Emplacement>();
    expectTypeOf(ligneDepuisEmplacement).returns.toExtend<typeof emplacement.$inferInsert>();
    expectTypeOf<Lue<typeof emplacement>>().toExtend<Parameters<typeof emplacementDepuisLigne>[0]>();
    expectTypeOf<ReturnType<typeof ligneDepuisEmplacement>>().toExtend<
      Parameters<typeof emplacementDepuisLigne>[0]
    >();

    expectTypeOf<ClesSnake<Lue<typeof emplacement>>>().toEqualTypeOf<never>();
    expectTypeOf<ClesDate<Lue<typeof emplacement>>>().toExtend<Instants>();

    expectTypeOf<Lue<typeof emplacement>['fermeId']>().toExtend<string>();
    expectTypeOf<Lue<typeof emplacement>['zoneId']>().toExtend<string>();
    expectTypeOf<Lue<typeof emplacement>['code']>().toExtend<string>();
    expectTypeOf<Lue<typeof emplacement>['actifDu']>().toExtend<string>();
    expectTypeOf<Lue<typeof emplacement>['actifAu']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof emplacement>['remplace']>().toExtend<readonly string[]>();
    expectTypeOf<Lue<typeof emplacement>>().toHaveProperty('supprimeLe');
  });

  const commun = {
    fermeId: FERME,
    supprimeLe: null,
    zoneId: id<'Zone'>(40),
    largeurM: 0.8,
    actifDu: date('2026-01-01'),
    actifAu: null,
    remplace: [],
  } as const;

  const planche: Emplacement = { ...commun, id: id<'Emplacement'>(41), sorte: 'planche', code: 'T2-P03', longueurM: 30 };
  const rang: Emplacement = {
    ...commun,
    id: id<'Emplacement'>(42),
    sorte: 'rang',
    code: 'V-R01',
    longueurM: 85,
    largeurM: null,
    actifAu: date('2031-12-31'),
    supprimeLe: INSTANT_SUPPRESSION,
  };
  const gouttiere: Emplacement = {
    ...commun,
    id: id<'Emplacement'>(43),
    sorte: 'gouttiere',
    code: 'HS-G12',
    longueurM: 40,
    largeurM: 0.25,
    nombrePlaces: 320,
    remplace: [id<'Emplacement'>(44), id<'Emplacement'>(45)],
  };

  it('ligne : sorte, nombre de places réservé à la gouttière, dates en chaîne', () => {
    const p = ligneDepuisEmplacement(planche);
    expect(p.sorte).toBe('planche');
    expect(p.nombrePlaces).toBeNull();
    expect(p.actifDu).toBe('2026-01-01');
    expect(p.actifAu).toBeNull();
    expect(p.remplace).toEqual([]);

    const g = ligneDepuisEmplacement(gouttiere);
    expect(g.nombrePlaces).toBe(320);
    expect(g.remplace).toEqual([id(44), id(45)]);
  });

  it('aller-retour sans perte', () => {
    for (const e of [planche, rang, gouttiere]) {
      expect(emplacementDepuisLigne(ligneDepuisEmplacement(e))).toStrictEqual(e);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Evenement
// ---------------------------------------------------------------------------------------------

describe('Evenement ↔ table evenement', () => {
  it('types : conversion dans les deux sens, colonnes camelCase, dates en chaîne', () => {
    expectTypeOf(evenementDepuisLigne).returns.toEqualTypeOf<Evenement>();
    expectTypeOf(ligneDepuisEvenement).parameter(0).toEqualTypeOf<Evenement>();
    expectTypeOf(ligneDepuisEvenement).returns.toExtend<typeof evenement.$inferInsert>();
    expectTypeOf<Lue<typeof evenement>>().toExtend<Parameters<typeof evenementDepuisLigne>[0]>();
    expectTypeOf<ReturnType<typeof ligneDepuisEvenement>>().toExtend<Parameters<typeof evenementDepuisLigne>[0]>();

    expectTypeOf<ClesSnake<Lue<typeof evenement>>>().toEqualTypeOf<never>();
    expectTypeOf<ClesDate<Lue<typeof evenement>>>().toExtend<Instants>();

    expectTypeOf<Lue<typeof evenement>['fermeId']>().toExtend<string>();
    expectTypeOf<Lue<typeof evenement>['type']>().toExtend<string>();
    expectTypeOf<Lue<typeof evenement>['date']>().toExtend<string>();
    expectTypeOf<Lue<typeof evenement>['serieId']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof evenement>['campagneId']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof evenement>['emplacementIds']>().toExtend<readonly string[]>();
    expectTypeOf<Lue<typeof evenement>['remplaceEvenementId']>().toExtend<string | null>();
    expectTypeOf<Lue<typeof evenement>>().toHaveProperty('horodatage');
    expectTypeOf<Lue<typeof evenement>>().toHaveProperty('detail');
    expectTypeOf<Lue<typeof evenement>>().toHaveProperty('creeLe');
  });

  const commun = {
    fermeId: FERME,
    date: date('2027-05-26'),
    horodatage: Date.UTC(2027, 4, 27, 6, 15, 42, 7),
    auteurId: id<'Utilisateur'>(50),
    source: 'tap',
    culture: { sorte: 'serie', serieId: id<'Serie'>(10) },
    emplacementIds: [id<'Emplacement'>(41)],
    note: null,
    photos: [],
    remplaceEvenement: null,
  } as const;

  const evenements: readonly Evenement[] = [
    { ...commun, id: id<'Evenement'>(51), type: 'realise', detail: { etape: 'plantation', quantiteReelle: 290 } },
    {
      ...commun,
      id: id<'Evenement'>(52),
      type: 'recolte',
      culture: { sorte: 'campagne', campagneId: id<'Campagne'>(53) },
      emplacementIds: [],
      source: 'voix',
      note: 'belle cueillette',
      photos: ['photo-1.jpg', 'photo-2.jpg'],
      detail: { quantite: 42.5, unite: 'kg', categorie: 'I' },
    },
    {
      ...commun,
      id: id<'Evenement'>(54),
      type: 'intervention',
      culture: null,
      emplacementIds: [id<'Emplacement'>(41), id<'Emplacement'>(42)],
      detail: {
        categorie: 'fertilisation',
        type: 'engrais',
        outil: null,
        produit: 'Orgasol',
        quantite: { valeur: 3, unite: 'kg' },
      },
    },
    {
      ...commun,
      id: id<'Evenement'>(55),
      type: 'irrigation',
      culture: null,
      detail: { secteurIrrigationId: id<'SecteurIrrigation'>(56), dureeMinutes: 45 },
    },
    {
      ...commun,
      id: id<'Evenement'>(57),
      type: 'traitement',
      detail: {
        produitPhytoId: id<'ProduitPhyto'>(58),
        dose: { valeur: 0.5, unite: 'kg/ha' },
        surfaceTraiteeM2: 36,
        cible: 'mildiou',
        operateur: 'Théophane',
        recolteAutoriseeLe: date('2027-06-16'),
      },
    },
    {
      ...commun,
      id: id<'Evenement'>(59),
      type: 'observation',
      remplaceEvenement: { sorte: 'correction', evenementId: id<'Evenement'>(51) },
      detail: { nature: 'ravageur', gravite: 'forte' },
    },
  ];

  it('ligne : cible à plat, détail jsonb tel quel, date en chaîne', () => {
    const [realise, recolte, intervention] = evenements;
    if (realise === undefined || recolte === undefined || intervention === undefined) {
      throw new Error('jeu d’événements incomplet');
    }
    const r = ligneDepuisEvenement(realise);
    expect(r.type).toBe('realise');
    expect(r.date).toBe('2027-05-26');
    expect([r.serieId, r.campagneId]).toEqual([id(10), null]);
    expect(r.emplacementIds).toEqual([id(41)]);
    expect(r.detail).toStrictEqual(realise.detail);

    const c = ligneDepuisEvenement(recolte);
    expect([c.serieId, c.campagneId]).toEqual([null, id(53)]);
    expect(c.photos).toEqual(['photo-1.jpg', 'photo-2.jpg']);
    expect(c.detail).toStrictEqual({ quantite: 42.5, unite: 'kg', categorie: 'I' });

    const i = ligneDepuisEvenement(intervention);
    expect([i.serieId, i.campagneId]).toEqual([null, null]);
    expect([i.remplaceSorte, i.remplaceEvenementId]).toEqual([null, null]);

    const o = ligneDepuisEvenement(evenements[5] ?? realise);
    expect([o.remplaceSorte, o.remplaceEvenementId]).toEqual(['correction', id(51)]);
  });

  it('aller-retour sans perte, pour chacun des six types', () => {
    expect(new Set(evenements.map((e) => e.type)).size).toBe(6);
    for (const e of evenements) {
      expect(evenementDepuisLigne(ligneDepuisEvenement(e))).toStrictEqual(e);
    }
  });
});

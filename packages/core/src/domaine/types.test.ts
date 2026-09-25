/**
 * Tests d'acceptation T01 — types du domaine (modèle v1, docs/modele-donnees.md).
 *
 * Ces tests sont surtout vérifiés par `pnpm typecheck` (expectTypeOf, @ts-expect-error) ;
 * les `switch` exécutés ici prouvent en plus que les unions sont exhaustives.
 *
 * API attendue, exportée par `packages/core/src/domaine/index.ts`
 * (et ré-exportée par `packages/core/src/index.ts`) :
 *
 *   type Id<E>  identifiant UUID v7 marqué par le nom de l'entité : Id<'Serie'>, Id<'Emplacement'>…
 *               assignable à string ; ni une string, ni un Id d'une autre entité ne lui est assignable.
 *
 *   Entités (une interface ou un type par entité, noms exacts) :
 *     Ferme, Zone, Emplacement, SecteurIrrigation, SecteurEmplacement, Famille, Espece, Variete,
 *     Itineraire, Saison, Serie, Plantation, Campagne, Occupation, Assolement, Evenement,
 *     ArticleStock, MouvementStock, ProduitPhyto, Proposition, Modification.
 *   Chaque entité a `id: Id<'<NomEntite>'>` ; toutes sauf Ferme ont `fermeId: Id<'Ferme'>`.
 *   Champs imposés par ces tests (le reste est libre, calqué sur le modèle) :
 *     Zone.zoneParenteId: Id<'Zone'> | null
 *     Emplacement.remplace: readonly Id<'Emplacement'>[]
 *     Saison.debut, Saison.fin: DateCalendaire
 *     Serie.ancre: AncreSerie, avec AncreSerie['date']: DateCalendaire
 *
 *   Unions discriminées (valeurs exactes, ASCII, snake_case) :
 *     SorteEmplacement  = 'planche' | 'rang' | 'gouttiere'           discriminant Emplacement['sorte']
 *                         (la variante 'gouttiere' porte nombrePlaces: number)
 *     TypeEvenement     = 'realise' | 'recolte' | 'intervention' | 'irrigation' | 'traitement' | 'observation'
 *                                                                     discriminant Evenement['type']
 *     ModeItineraire    = 'semis_direct' | 'plant_maison' | 'plant_achete'
 *                                                                     discriminant Itineraire['mode']
 *     TypeAncreSerie    = 'semis' | 'plantation' | 'debut_recolte'  discriminant AncreSerie['type']
 *     NatureAssolement  = 'prevu' | 'passe_saisi' | 'passe_importe' discriminant Assolement['nature']
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DateCalendaire } from '../dates/index.ts';
import type {
  AncreSerie,
  ArticleStock,
  Assolement,
  Campagne,
  Emplacement,
  Espece,
  Evenement,
  Famille,
  Ferme,
  Id,
  Itineraire,
  ModeItineraire,
  Modification,
  MouvementStock,
  NatureAssolement,
  Occupation,
  Plantation,
  ProduitPhyto,
  Proposition,
  Saison,
  SecteurEmplacement,
  SecteurIrrigation,
  Serie,
  SorteEmplacement,
  TypeAncreSerie,
  TypeEvenement,
  Variete,
  Zone,
} from './index.ts';
import type * as Racine from '../index.ts';

describe('identifiants marqués Id<Entite>', () => {
  it('un Id est une string, mais pas l’inverse', () => {
    expectTypeOf<Id<'Serie'>>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<Id<'Serie'>>();
  });

  it('les Id de deux entités différentes ne sont pas interchangeables', () => {
    expectTypeOf<Id<'Serie'>>().not.toExtend<Id<'Emplacement'>>();
    expectTypeOf<Id<'Emplacement'>>().not.toExtend<Id<'Serie'>>();
    expectTypeOf<Id<'Serie'>>().not.toEqualTypeOf<Id<'Plantation'>>();
  });

  it('un Id et une DateCalendaire ne sont pas interchangeables', () => {
    expectTypeOf<Id<'Serie'>>().not.toExtend<DateCalendaire>();
    expectTypeOf<DateCalendaire>().not.toExtend<Id<'Serie'>>();
  });

  it('le compilateur refuse de passer un Id d’emplacement là où on attend une série', () => {
    function nomDeSerie(id: Id<'Serie'>): string {
      return `série ${id}`;
    }
    const emplacement = '0190a5c8-0000-7000-8000-000000000000' as Id<'Emplacement'>;
    // @ts-expect-error Id<'Emplacement'> n'est pas un Id<'Serie'>.
    expect(nomDeSerie(emplacement)).toContain('série');
    // @ts-expect-error une string brute n'est pas un Id<'Serie'>.
    expect(nomDeSerie('0190a5c8-0000-7000-8000-000000000000')).toContain('série');
  });
});

describe('entités du modèle v1', () => {
  it('chaque entité porte son propre Id', () => {
    expectTypeOf<Ferme['id']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Zone['id']>().toEqualTypeOf<Id<'Zone'>>();
    expectTypeOf<Emplacement['id']>().toEqualTypeOf<Id<'Emplacement'>>();
    expectTypeOf<SecteurIrrigation['id']>().toEqualTypeOf<Id<'SecteurIrrigation'>>();
    expectTypeOf<SecteurEmplacement['id']>().toEqualTypeOf<Id<'SecteurEmplacement'>>();
    expectTypeOf<Famille['id']>().toEqualTypeOf<Id<'Famille'>>();
    expectTypeOf<Espece['id']>().toEqualTypeOf<Id<'Espece'>>();
    expectTypeOf<Variete['id']>().toEqualTypeOf<Id<'Variete'>>();
    expectTypeOf<Itineraire['id']>().toEqualTypeOf<Id<'Itineraire'>>();
    expectTypeOf<Saison['id']>().toEqualTypeOf<Id<'Saison'>>();
    expectTypeOf<Serie['id']>().toEqualTypeOf<Id<'Serie'>>();
    expectTypeOf<Plantation['id']>().toEqualTypeOf<Id<'Plantation'>>();
    expectTypeOf<Campagne['id']>().toEqualTypeOf<Id<'Campagne'>>();
    expectTypeOf<Occupation['id']>().toEqualTypeOf<Id<'Occupation'>>();
    expectTypeOf<Assolement['id']>().toEqualTypeOf<Id<'Assolement'>>();
    expectTypeOf<Evenement['id']>().toEqualTypeOf<Id<'Evenement'>>();
    expectTypeOf<ArticleStock['id']>().toEqualTypeOf<Id<'ArticleStock'>>();
    expectTypeOf<MouvementStock['id']>().toEqualTypeOf<Id<'MouvementStock'>>();
    expectTypeOf<ProduitPhyto['id']>().toEqualTypeOf<Id<'ProduitPhyto'>>();
    expectTypeOf<Proposition['id']>().toEqualTypeOf<Id<'Proposition'>>();
    expectTypeOf<Modification['id']>().toEqualTypeOf<Id<'Modification'>>();
  });

  it('chaque ligne porte ferme_id (frontière de la synchro et de l’export)', () => {
    expectTypeOf<Zone['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Emplacement['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<SecteurIrrigation['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<SecteurEmplacement['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Famille['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Espece['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Variete['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Itineraire['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Saison['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Serie['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Plantation['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Campagne['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Occupation['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Assolement['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Evenement['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<ArticleStock['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<MouvementStock['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<ProduitPhyto['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Proposition['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Modification['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
  });

  it('zone parente facultative, emplacements remplacés, dates calendaires', () => {
    expectTypeOf<Zone['zoneParenteId']>().toEqualTypeOf<Id<'Zone'> | null>();
    expectTypeOf<Emplacement['remplace']>().toEqualTypeOf<readonly Id<'Emplacement'>[]>();
    expectTypeOf<Saison['debut']>().toEqualTypeOf<DateCalendaire>();
    expectTypeOf<Saison['fin']>().toEqualTypeOf<DateCalendaire>();
    expectTypeOf<Serie['ancre']>().toEqualTypeOf<AncreSerie>();
    expectTypeOf<AncreSerie['date']>().toEqualTypeOf<DateCalendaire>();
  });
});

describe('unions discriminées', () => {
  it('les valeurs des discriminants sont exactement celles du modèle', () => {
    expectTypeOf<SorteEmplacement>().toEqualTypeOf<'planche' | 'rang' | 'gouttiere'>();
    expectTypeOf<Emplacement['sorte']>().toEqualTypeOf<SorteEmplacement>();
    expectTypeOf<TypeEvenement>().toEqualTypeOf<
      'realise' | 'recolte' | 'intervention' | 'irrigation' | 'traitement' | 'observation'
    >();
    expectTypeOf<Evenement['type']>().toEqualTypeOf<TypeEvenement>();
    expectTypeOf<ModeItineraire>().toEqualTypeOf<'semis_direct' | 'plant_maison' | 'plant_achete'>();
    expectTypeOf<Itineraire['mode']>().toEqualTypeOf<ModeItineraire>();
    expectTypeOf<TypeAncreSerie>().toEqualTypeOf<'semis' | 'plantation' | 'debut_recolte'>();
    expectTypeOf<AncreSerie['type']>().toEqualTypeOf<TypeAncreSerie>();
    expectTypeOf<NatureAssolement>().toEqualTypeOf<'prevu' | 'passe_saisi' | 'passe_importe'>();
    expectTypeOf<Assolement['nature']>().toEqualTypeOf<NatureAssolement>();
  });

  it('le discriminant restreint la variante : une gouttière a un nombre de places', () => {
    expectTypeOf<Extract<Emplacement, { sorte: 'gouttiere' }>['nombrePlaces']>().toEqualTypeOf<number>();
    // Si la variante n'existait pas, Extract donnerait `never` et ces égalités échoueraient.
    expectTypeOf<Extract<Emplacement, { sorte: 'gouttiere' }>['sorte']>().toEqualTypeOf<'gouttiere'>();
    expectTypeOf<Extract<Evenement, { type: 'recolte' }>['type']>().toEqualTypeOf<'recolte'>();
    expectTypeOf<Extract<Evenement, { type: 'traitement' }>['type']>().toEqualTypeOf<'traitement'>();
    expectTypeOf<Extract<Itineraire, { mode: 'plant_achete' }>['mode']>().toEqualTypeOf<'plant_achete'>();
    expectTypeOf<Extract<AncreSerie, { type: 'debut_recolte' }>['type']>().toEqualTypeOf<'debut_recolte'>();
    expectTypeOf<Extract<Assolement, { nature: 'passe_importe' }>['nature']>().toEqualTypeOf<'passe_importe'>();
  });

  it('un switch exhaustif compile, et chaque cas oublié serait une erreur de typage', () => {
    // Le `default` reçoit `never` : ajouter une variante sans la traiter casse la compilation.
    function libelleSorte(sorte: SorteEmplacement): string {
      switch (sorte) {
        case 'planche':
          return 'Planche';
        case 'rang':
          return 'Rang';
        case 'gouttiere':
          return 'Gouttière';
        default: {
          const reste: never = sorte;
          return reste;
        }
      }
    }
    function libelleEvenement(type: TypeEvenement): string {
      switch (type) {
        case 'realise':
          return 'Réalisé';
        case 'recolte':
          return 'Récolte';
        case 'intervention':
          return 'Intervention';
        case 'irrigation':
          return 'Irrigation';
        case 'traitement':
          return 'Traitement';
        case 'observation':
          return 'Observation';
        default: {
          const reste: never = type;
          return reste;
        }
      }
    }
    function libelleMode(mode: ModeItineraire): string {
      switch (mode) {
        case 'semis_direct':
          return 'Semis direct';
        case 'plant_maison':
          return 'Plant maison';
        case 'plant_achete':
          return 'Plant acheté';
        default: {
          const reste: never = mode;
          return reste;
        }
      }
    }
    function libelleAncre(type: TypeAncreSerie): string {
      switch (type) {
        case 'semis':
          return 'Semis';
        case 'plantation':
          return 'Plantation';
        case 'debut_recolte':
          return 'Début de récolte';
        default: {
          const reste: never = type;
          return reste;
        }
      }
    }
    function libelleNature(nature: NatureAssolement): string {
      switch (nature) {
        case 'prevu':
          return 'Prévu';
        case 'passe_saisi':
          return 'Passé saisi';
        case 'passe_importe':
          return 'Passé importé';
        default: {
          const reste: never = nature;
          return reste;
        }
      }
    }
    function libelleIncomplet(sorte: SorteEmplacement): string {
      switch (sorte) {
        case 'planche':
          return 'Planche';
        case 'rang':
          return 'Rang';
        default: {
          // @ts-expect-error 'gouttiere' n'est pas traitée : le typage le détecte.
          const reste: never = sorte;
          return reste;
        }
      }
    }

    expect(libelleSorte('gouttiere')).toBe('Gouttière');
    expect(libelleEvenement('traitement')).toBe('Traitement');
    expect(libelleMode('plant_achete')).toBe('Plant acheté');
    expect(libelleAncre('debut_recolte')).toBe('Début de récolte');
    expect(libelleNature('passe_importe')).toBe('Passé importé');
    expect(libelleIncomplet('gouttiere')).toBe('gouttiere');
  });
});

describe('ré-export depuis la racine du paquet', () => {
  it('packages/core/src/index.ts expose les types du domaine', () => {
    expectTypeOf<Racine.Id<'Serie'>>().toEqualTypeOf<Id<'Serie'>>();
    expectTypeOf<Racine.Serie>().toEqualTypeOf<Serie>();
    expectTypeOf<Racine.Evenement>().toEqualTypeOf<Evenement>();
    expectTypeOf<Racine.DateCalendaire>().toEqualTypeOf<DateCalendaire>();
  });
});

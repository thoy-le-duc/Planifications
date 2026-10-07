/**
 * Tests d'acceptation T28a — types du domaine pour le placement (modèle v1.x, Q31), vérifiés
 * surtout par `pnpm typecheck`. Avant le code, ce fichier casse le typage sur les seuls exports
 * manquants (`./index.ts`, `Batiment`, `TypeBatiment`, `PointLocal`, `Degres`) : c'est attendu.
 *
 * Attendu de `packages/core/src/domaine` (entites.ts, identifiants.ts), en camelCase :
 *   NomEntite         + 'Batiment'
 *   Degres            = number (cap, sens horaire depuis le nord, [0, 360[)
 *   PointLocal        { readonly x: number; readonly y: number } (mètres du repère local)
 *   Ferme.originePlan : PositionGeographique | null (origine du plan, distincte de `position`)
 *   Zone.contour      : readonly PointLocal[] | null
 *   Emplacement (les trois sortes) :
 *     placementXM: Metres | null ; placementYM: Metres | null ; orientationDeg: Degres | null
 *   TypeBatiment      = 'serre_tunnel' | 'serre_chapelle' | 'hangar' | 'magasin' | 'autre'
 *   Batiment          ligne de ferme (id: Id<'Batiment'>, fermeId, supprimeLe) + nom: string,
 *                     type: TypeBatiment, longueurM, largeurM, hauteurM, centreXM, centreYM:
 *                     Metres, orientationDeg: Degres, zoneId: Id<'Zone'> | null
 *
 * Et `packages/core/src/placement/index.ts` satisfait `ModulePlacement` (./test/contrat.ts).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  Batiment,
  Degres,
  Emplacement,
  Ferme,
  Id,
  Instant,
  Metres,
  NomEntite,
  PointLocal,
  PositionGeographique,
  TypeBatiment,
  Zone,
} from '../domaine/index.ts';
import type * as Placement from './index.ts';
import type { ModulePlacement, PointLocal as PointLocalContrat, TypeBatiment as TypeBatimentContrat } from './test/contrat.ts';

describe('T28a : types du domaine', () => {
  it('Batiment est une entité nommée', () => {
    expectTypeOf<'Batiment'>().toExtend<NomEntite>();
    expectTypeOf<Batiment['id']>().toEqualTypeOf<Id<'Batiment'>>();
    expectTypeOf<Batiment['fermeId']>().toEqualTypeOf<Id<'Ferme'>>();
    expectTypeOf<Batiment['supprimeLe']>().toEqualTypeOf<Instant | null>();
  });

  it('Batiment : champs du modèle', () => {
    expectTypeOf<Batiment['nom']>().toEqualTypeOf<string>();
    expectTypeOf<Batiment['type']>().toEqualTypeOf<TypeBatiment>();
    expectTypeOf<Batiment['longueurM']>().toEqualTypeOf<Metres>();
    expectTypeOf<Batiment['largeurM']>().toEqualTypeOf<Metres>();
    expectTypeOf<Batiment['hauteurM']>().toEqualTypeOf<Metres>();
    expectTypeOf<Batiment['centreXM']>().toEqualTypeOf<Metres>();
    expectTypeOf<Batiment['centreYM']>().toEqualTypeOf<Metres>();
    expectTypeOf<Batiment['orientationDeg']>().toEqualTypeOf<Degres>();
    expectTypeOf<Batiment['zoneId']>().toEqualTypeOf<Id<'Zone'> | null>();
  });

  it('TypeBatiment : les cinq valeurs du ticket, rien d’autre', () => {
    expectTypeOf<TypeBatiment>().toEqualTypeOf<'serre_tunnel' | 'serre_chapelle' | 'hangar' | 'magasin' | 'autre'>();
    expectTypeOf<TypeBatiment>().toEqualTypeOf<TypeBatimentContrat>();
  });

  it('PointLocal et Degres', () => {
    expectTypeOf<PointLocal>().toEqualTypeOf<PointLocalContrat>();
    expectTypeOf<Degres>().toEqualTypeOf<number>();
  });

  it('Ferme.originePlan, distincte de la position météo', () => {
    expectTypeOf<Ferme['originePlan']>().toEqualTypeOf<PositionGeographique | null>();
    expectTypeOf<Ferme['position']>().toEqualTypeOf<PositionGeographique | null>();
  });

  it('Zone.contour : polygone libre, nul = pas placée (ou abritée)', () => {
    expectTypeOf<Zone['contour']>().toEqualTypeOf<readonly PointLocal[] | null>();
  });

  it('Emplacement : placement dans le repère de sa zone, nul = rangement automatique', () => {
    expectTypeOf<Emplacement['placementXM']>().toEqualTypeOf<Metres | null>();
    expectTypeOf<Emplacement['placementYM']>().toEqualTypeOf<Metres | null>();
    expectTypeOf<Emplacement['orientationDeg']>().toEqualTypeOf<Degres | null>();
  });
});

describe('T28a : le module de placement suit le contrat', () => {
  it('src/placement/index.ts satisfait ModulePlacement', () => {
    expectTypeOf<typeof Placement>().toExtend<ModulePlacement>();
    expect(true).toBe(true);
  });
});

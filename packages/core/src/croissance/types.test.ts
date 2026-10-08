/**
 * Tests d'acceptation T32a — types, vérifiés surtout par `pnpm typecheck`. Avant le code, ce
 * fichier casse le typage sur les seuls exports manquants (`./index.ts`, `ProfilCroissance`,
 * `Espece.profilCroissance`…) : c'est attendu.
 *
 * Attendu :
 *   - `@planif/core` (src/index.ts) exporte les types du contrat : ProfilCroissance, FormePlant,
 *     AllureCroissance, FinDeCycle, DureeCroissance, CycleAnnuel, ProfilParDefaut,
 *     StadeCroissance, EtatCroissance, DatesCroissance, DateRepere, EntreePerenne,
 *     CodeErreurCroissance, ErreurCroissance, ResultatCroissance ; identiques à ceux de
 *     ./test/contrat.ts.
 *   - Espece (domaine/entites.ts) : `readonly profilCroissance?: ProfilCroissance` — clé absente
 *     = profil par défaut (comme `Serie.rotationAcceptee`) ; en base, `profil_croissance` nul.
 *   - `src/croissance/index.ts` satisfait `ModuleCroissance`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as Coeur from '../index.ts';
import type * as Croissance from './index.ts';
import type * as Contrat from './test/contrat.ts';

describe('T32a : types exportés par @planif/core', () => {
  it('mêmes types que le contrat', () => {
    expectTypeOf<Coeur.ProfilCroissance>().toEqualTypeOf<Contrat.ProfilCroissance>();
    expectTypeOf<Coeur.FormePlant>().toEqualTypeOf<Contrat.FormePlant>();
    expectTypeOf<Coeur.AllureCroissance>().toEqualTypeOf<Contrat.AllureCroissance>();
    expectTypeOf<Coeur.FinDeCycle>().toEqualTypeOf<Contrat.FinDeCycle>();
    expectTypeOf<Coeur.DureeCroissance>().toEqualTypeOf<Contrat.DureeCroissance>();
    expectTypeOf<Coeur.CycleAnnuel>().toEqualTypeOf<Contrat.CycleAnnuel>();
    expectTypeOf<Coeur.ProfilParDefaut>().toEqualTypeOf<Contrat.ProfilParDefaut>();
    expectTypeOf<Coeur.StadeCroissance>().toEqualTypeOf<Contrat.StadeCroissance>();
    expectTypeOf<Coeur.EtatCroissance>().toEqualTypeOf<Contrat.EtatCroissance>();
    expectTypeOf<Coeur.DatesCroissance>().toEqualTypeOf<Contrat.DatesCroissance>();
    expectTypeOf<Coeur.DateRepere>().toEqualTypeOf<Contrat.DateRepere>();
    expectTypeOf<Coeur.EntreePerenne>().toEqualTypeOf<Contrat.EntreePerenne>();
    expectTypeOf<Coeur.CodeErreurCroissance>().toEqualTypeOf<Contrat.CodeErreurCroissance>();
    expectTypeOf<Coeur.ErreurCroissance>().toEqualTypeOf<Contrat.ErreurCroissance>();
    expectTypeOf<Coeur.ResultatCroissance<number>>().toEqualTypeOf<Contrat.ResultatCroissance<number>>();
  });

  it('Espece.profilCroissance : facultatif, absent = profil par défaut', () => {
    expectTypeOf<Coeur.Espece['profilCroissance']>().toEqualTypeOf<Contrat.ProfilCroissance | undefined>();
    // Une espèce écrite avant T32a (sans la clé) reste une Espece valide.
    expectTypeOf<Omit<Coeur.Espece, 'profilCroissance'>>().toExtend<Coeur.Espece>();
  });
});

describe('T32a : le module de croissance suit le contrat', () => {
  it('src/croissance/index.ts satisfait ModuleCroissance, et @planif/core le réexporte', () => {
    expectTypeOf<typeof Croissance>().toExtend<Contrat.ModuleCroissance>();
    expectTypeOf<typeof Coeur>().toExtend<Contrat.ModuleCroissance>();
    expect(true).toBe(true);
  });
});

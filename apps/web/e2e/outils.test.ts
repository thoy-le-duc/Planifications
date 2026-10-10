/**
 * Tests d'acceptation T11b — garde-fou des mesures e2e (relecture de T20). La médiane ne suffit
 * pas : une mesure dont une répétition a explosé doit aussi échouer.
 *
 * ── Contrat (dans apps/web/e2e/outils.ts) ─────────────────────────────────────────────────────
 *
 *   FACTEUR_MAX_BUDGET = 1.5
 *   jugerSerie(serie: SerieMesures, budgetMs: number): VerdictSerie
 *     VerdictSerie = {
 *       ok: boolean;            // medianeOk && maximumOk
 *       medianeOk: boolean;     // serie.mediane < budgetMs   (comme aujourd'hui : strictement)
 *       maximumOk: boolean;     // plus haute valeur <= FACTEUR_MAX_BUDGET * budgetMs
 *       maximum: number;        // la plus haute valeur de serie.valeurs
 *       raisons: readonly string[];  // une phrase par critère manqué, vide si ok ; celle du maximum
 *                                    // contient « plus haute valeur », la valeur et la limite
 *     }
 *   La médiane utilisée est celle de la série (serie.mediane), pas recalculée.
 *   plan.e2e.ts juge ses trois séries (réouverture, Planches, retour) par jugerSerie.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

interface SerieMesures {
  readonly valeurs: readonly number[];
  readonly mediane: number;
}

interface VerdictSerie {
  readonly ok: boolean;
  readonly medianeOk: boolean;
  readonly maximumOk: boolean;
  readonly maximum: number;
  readonly raisons: readonly string[];
}

interface ModuleOutils {
  readonly FACTEUR_MAX_BUDGET: number;
  mediane(valeurs: readonly number[]): number;
  jugerSerie(serie: SerieMesures, budgetMs: number): VerdictSerie;
}

const CHEMIN = './outils.ts';
let o: ModuleOutils;

beforeAll(async () => {
  o = (await import(/* @vite-ignore */ CHEMIN)) as ModuleOutils;
});

/** Série à partir de ses valeurs, avec sa vraie médiane (comme repeterMesures). */
const serie = (valeurs: readonly number[]): SerieMesures => ({ valeurs, mediane: o.mediane(valeurs) });

describe('T11b : garde-fou — la plus haute valeur d’une mesure ne dépasse pas 1,5 fois le budget', () => {
  it('le facteur est 1,5', () => {
    expect(o.FACTEUR_MAX_BUDGET).toBe(1.5);
  });

  it('médiane et maximum sous les limites : la mesure passe', () => {
    const v = o.jugerSerie(serie([212, 230, 198, 250, 221]), 300);
    expect(v.ok).toBe(true);
    expect(v.medianeOk).toBe(true);
    expect(v.maximumOk).toBe(true);
    expect(v.maximum).toBe(250);
    expect(v.raisons).toEqual([]);
  });

  it('médiane bonne mais une répétition à 460 ms (> 450 = 1,5 × 300) : la mesure échoue', () => {
    const s = serie([200, 210, 220, 230, 460]);
    expect(s.mediane).toBe(220);
    const v = o.jugerSerie(s, 300);
    expect(v.medianeOk).toBe(true);
    expect(v.maximumOk).toBe(false);
    expect(v.ok).toBe(false);
    expect(v.maximum).toBe(460);
    expect(v.raisons).toHaveLength(1);
    expect(v.raisons[0]).toMatch(/plus haute valeur/);
    expect(v.raisons[0]).toContain('460');
    expect(v.raisons[0]).toContain('450');
  });

  it('exactement 1,5 fois le budget (450 ms sur 300) : passe ; au-delà (450,1) : échoue', () => {
    expect(o.jugerSerie(serie([200, 210, 220, 230, 450]), 300).ok).toBe(true);
    expect(o.jugerSerie(serie([200, 210, 220, 230, 450.1]), 300).ok).toBe(false);
  });

  it('le facteur suit le budget (budget 50 ms : limite 75 ms)', () => {
    expect(o.jugerSerie(serie([30, 31, 32, 33, 75]), 50).ok).toBe(true);
    expect(o.jugerSerie(serie([30, 31, 32, 33, 76]), 50).ok).toBe(false);
  });

  it('médiane au budget ou au-dessus : échoue, comme avant (strictement sous le budget)', () => {
    const v = o.jugerSerie(serie([300, 300, 300, 300, 300]), 300);
    expect(v.medianeOk).toBe(false);
    expect(v.maximumOk).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.raisons).toHaveLength(1);
    expect(o.jugerSerie(serie([299, 299, 299, 299, 299]), 300).ok).toBe(true);
  });

  it('les deux critères manqués : deux raisons', () => {
    const v = o.jugerSerie(serie([400, 410, 420, 430, 500]), 300);
    expect(v.medianeOk).toBe(false);
    expect(v.maximumOk).toBe(false);
    expect(v.raisons).toHaveLength(2);
  });

  it('une seule répétition : la médiane et le maximum sont cette valeur', () => {
    const v = o.jugerSerie(serie([280]), 300);
    expect(v.ok).toBe(true);
    expect(v.maximum).toBe(280);
    expect(o.jugerSerie(serie([460]), 300).ok).toBe(false);
  });

  it('plan.e2e.ts juge ses mesures de temps par jugerSerie', () => {
    const source = readFileSync(join(import.meta.dirname, 'plan.e2e.ts'), 'utf8');
    expect(source).toMatch(/jugerSerie\(/);
    expect(source, 'plus de comparaison de la seule médiane au budget').not.toMatch(/\.mediane[^;\n]*\)\.toBeLessThan\(BUDGET_MS\)/);
  });
});

/**
 * Tests d'acceptation T76 — E-Phy : le DAR proposé vient de l'usage de la culture réellement
 * traitée, jamais de celui d'une autre culture de la ferme (docs/backlog/T76-ephy-dar-culture-traitee.md).
 * Règle sanitaire : un produit homologué sur le seul fraisier ne donne pas « le DAR de la fraise »
 * pour une tomate.
 *
 * Contrat attendu de ./ephy.ts (exporté par `@planif/core/ephy`) :
 *   - `propositionUsage(produit, especes)` (niveau ferme, fiche produit) : DAR et dose restent
 *     null dès qu'UNE espèce de la ferme n'a aucun usage (le DAR d'une culture ne vaut pas pour
 *     l'autre) ; `candidats` inchangés (les usages des espèces qui en ont) ;
 *   - `usagesParEspece(produit, especes)` : un élément par espèce distincte (ordre d'entrée,
 *     doublons et casse ignorés) : `{ espece, usages }` ; `usages` vide = non homologué ;
 *   - `propositionUsagePourCulture(produit, espece)` : `{ homologue, candidats, dar, dose }` pour
 *     UNE culture traitée : `homologue` vrai s'il existe au moins un usage pour elle ; `dar`
 *     proposé seulement si tous ses usages sont d'accord et donnés en jours (Q47 : absent → null,
 *     jamais deviné) ; sinon null (le maraîcher choisit ou saisit).
 */
import { describe, expect, it } from 'vitest';
import * as index from '../index.ts';
import * as ephy from './ephy.ts';
import { propositionUsage, type ProduitEphy, type UsageEphy } from './ephy.ts';

interface Prop {
  readonly homologue: boolean;
  readonly candidats: readonly UsageEphy[];
  readonly dar: number | null;
  readonly dose: { readonly valeur: number; readonly unite: string } | null;
}
type ParEspece = readonly { readonly espece: string; readonly usages: readonly UsageEphy[] }[];
const usagesParEspece = (ephy as unknown as { usagesParEspece: (p: ProduitEphy, e: readonly string[]) => ParEspece }).usagesParEspece;
const pourCulture = (ephy as unknown as { propositionUsagePourCulture: (p: ProduitEphy, e: string) => Prop }).propositionUsagePourCulture;

const u = (culture: string, cible: string, dar: number | null, dose: UsageEphy['dose'] = { valeur: 0.2, unite: 'L/ha' }): UsageEphy => ({ culture, mode: 'Trt Part.Aer.', cible, dose, dar });
const produit = (usages: readonly UsageEphy[]): ProduitEphy => ({ amm: '2060098', nom: 'SUCCESS 4', autresNoms: [], substances: ['spinosad'], bio: true, retire: false, retireLe: null, usages });

const FRAISIER_SEUL = produit([u('Fraisier', 'Thrips', 1)]);

describe('T76 : fonctions attendues du cœur', () => {
  it('usagesParEspece et propositionUsagePourCulture existent dans @planif/core/ephy, pas dans l’index du cœur', () => {
    expect(typeof usagesParEspece).toBe('function');
    expect(typeof pourCulture).toBe('function');
    expect(Object.keys(index)).not.toContain('propositionUsagePourCulture');
  });
});

describe('T76 : niveau ferme — pas de DAR unique quand une culture n’a pas d’usage', () => {
  it('ferme tomate + fraise, produit sur Fraisier seul : aucun DAR ni dose proposés (le DAR de la fraise ne vaut pas pour la tomate)', () => {
    const r = propositionUsage(FRAISIER_SEUL, ['Tomate', 'Fraise']);
    expect(r.dar).toBeNull();
    expect(r.dose).toBeNull();
    expect(r.candidats).toEqual(FRAISIER_SEUL.usages);
  });

  it('ordre des espèces indifférent, et un doublon ne change rien', () => {
    expect(propositionUsage(FRAISIER_SEUL, ['Fraise', 'Tomate']).dar).toBeNull();
    expect(propositionUsage(FRAISIER_SEUL, ['Fraise', 'Fraisier', 'Tomate', 'Tomate']).dar).toBeNull();
  });

  it('toutes les espèces de la ferme ont un usage de même DAR : DAR proposé comme avant', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', 3), u('Fraisier', 'Thrips', 3)]);
    expect(propositionUsage(p, ['Tomate', 'Fraise']).dar).toBe(3);
  });

  it('une seule espèce cultivée et homologuée : DAR proposé (cas T53 inchangé)', () => {
    expect(propositionUsage(FRAISIER_SEUL, ['Fraise']).dar).toBe(1);
  });

  it('une espèce sans usage parmi trois : toujours rien de proposé, même si les deux autres sont d’accord', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', 3), u('Fraisier', 'Thrips', 3)]);
    expect(propositionUsage(p, ['Tomate', 'Fraise', 'Kiwi']).dar).toBeNull();
  });
});

describe('T76 : usages par culture de la ferme (affichage de la fiche)', () => {
  it('une entrée par espèce, dans l’ordre ; non homologuée = liste vide', () => {
    expect(usagesParEspece(FRAISIER_SEUL, ['Tomate', 'Fraise'])).toEqual([
      { espece: 'Tomate', usages: [] },
      { espece: 'Fraise', usages: FRAISIER_SEUL.usages },
    ]);
  });

  it('doublons et casse ignorés ; ferme sans culture : liste vide', () => {
    expect(usagesParEspece(FRAISIER_SEUL, ['Fraise', 'fraise', 'FRAISE']).map((x) => x.espece)).toEqual(['Fraise']);
    expect(usagesParEspece(FRAISIER_SEUL, [])).toEqual([]);
  });
});

describe('T76 : culture réellement traitée (saisie d’un traitement)', () => {
  it('Fraisier seul : sur la tomate, non homologué, aucun DAR ni dose proposés', () => {
    expect(pourCulture(FRAISIER_SEUL, 'Tomate')).toEqual({ homologue: false, candidats: [], dar: null, dose: null });
  });

  it('Fraisier seul : sur la fraise, le DAR de l’usage Fraisier', () => {
    expect(pourCulture(FRAISIER_SEUL, 'Fraise')).toEqual({ homologue: true, candidats: FRAISIER_SEUL.usages, dar: 1, dose: { valeur: 0.2, unite: 'L/ha' } });
  });

  it('une variété s’appuie sur son espèce (« Tomate Cœur de bœuf »), casse et accents ignorés', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', 3)]);
    expect(pourCulture(p, 'Tomate Cœur de bœuf').dar).toBe(3);
    expect(pourCulture(p, 'tomate').homologue).toBe(true);
    expect(pourCulture(p, 'Fraise Mara des bois').homologue).toBe(false);
  });

  it('deux usages de DAR différents pour la culture traitée : aucun DAR proposé, les deux candidats rendus pour que l’utilisateur choisisse', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', 3), u('Tomate - Aubergine', 'Mildiou', 7), u('Fraisier', 'Thrips', 1)]);
    const r = pourCulture(p, 'Tomate');
    expect(r.homologue).toBe(true);
    expect(r.dar).toBeNull();
    expect(r.candidats).toEqual([p.usages[0], p.usages[1]]);
  });

  it('deux usages de même DAR : DAR proposé ; doses différentes : pas de dose', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', 3), u('Tomate - Aubergine', 'Chenilles', 3, { valeur: 0.015, unite: 'L/hL' })]);
    const r = pourCulture(p, 'Tomate');
    expect(r.dar).toBe(3);
    expect(r.dose).toBeNull();
  });

  it('Q47 : usage de la culture sans DAR en jours — homologué, mais DAR vide (jamais deviné, pas celui d’une autre culture)', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', null), u('Fraisier', 'Thrips', 1)]);
    const r = pourCulture(p, 'Tomate');
    expect(r.homologue).toBe(true);
    expect(r.dar).toBeNull();
  });

  it('un usage de DAR connu et un autre sans DAR : pas de DAR proposé', () => {
    const p = produit([u('Tomate - Aubergine', 'Thrips', 3), u('Tomate - Aubergine', 'Mildiou', null)]);
    expect(pourCulture(p, 'Tomate').dar).toBeNull();
  });

  it('DAR de 0 jour : proposé (0 n’est pas « absent »)', () => {
    const p = produit([u('Kiwi', 'Cochenilles', 0)]);
    const r = pourCulture(p, 'Kiwi');
    expect(r.homologue).toBe(true);
    expect(r.dar).toBe(0);
  });

  it('usage générique « Cultures légumières » : couvre la tomate, pas la fraise', () => {
    const p = produit([u('Cultures légumières', 'Oïdium(s)', 3)]);
    expect(pourCulture(p, 'Tomate')).toMatchObject({ homologue: true, dar: 3 });
    expect(pourCulture(p, 'Fraise')).toMatchObject({ homologue: false, dar: null });
  });

  it('espèce inconnue : seul l’usage qui porte son nom ; produit sans usage : non homologué ; espèce vide : non homologué', () => {
    expect(pourCulture(produit([u('Safran', 'Thrips', 5)]), 'Safran')).toMatchObject({ homologue: true, dar: 5 });
    expect(pourCulture(produit([]), 'Tomate')).toEqual({ homologue: false, candidats: [], dar: null, dose: null });
    expect(pourCulture(FRAISIER_SEUL, '')).toMatchObject({ homologue: false, dar: null });
  });

  it('pur : le produit n’est pas modifié', () => {
    const avant = JSON.stringify(FRAISIER_SEUL);
    pourCulture(FRAISIER_SEUL, 'Tomate');
    usagesParEspece(FRAISIER_SEUL, ['Tomate', 'Fraise']);
    expect(JSON.stringify(FRAISIER_SEUL)).toBe(avant);
  });
});

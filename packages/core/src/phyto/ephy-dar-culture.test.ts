/**
 * Tests d'acceptation T76 (docs/backlog/T76-ephy-dar-culture-traitee.md) : le DAR proposé vient de
 * l'usage de la culture RÉELLEMENT traitée, pas de toutes les espèces de la ferme. Pur, sans réseau.
 *
 * ── API attendue de ./ephy.ts (exportée par `@planif/core/ephy`, jamais par l'index du cœur) ──
 *
 *   darPourCulture(produit: ProduitEphy, espece: string): DarPourCulture
 *
 *   type DarPourCulture =
 *     | { sorte: 'propose'; dar: number; dose: DoseEphy | null; usages: readonly UsageEphy[] }
 *     | { sorte: 'a_choisir'; usages: readonly UsageEphy[] }
 *     | { sorte: 'dar_absent'; usages: readonly UsageEphy[] }
 *     | { sorte: 'non_homologue' }
 *
 *   `espece` : le nom de l'espèce de la culture traitée (« Tomate », pas « Tomate Cœur de bœuf » ;
 *   la correspondance espèce → culture e-phy est celle de T53/T75, `usagesPourEspeces`).
 *   - 'non_homologue' : aucun usage du produit pour cette espèce : avertissement, aucun DAR.
 *   - 'propose'      : au moins un usage, tous avec le même DAR (un nombre) ; `dose` est la dose
 *                      commune (même valeur, même unité), sinon null ; `usages` dans l'ordre du catalogue.
 *   - 'a_choisir'    : plusieurs usages dont les DAR diffèrent (un DAR absent compte comme différent) :
 *                      jamais de choix automatique, l'utilisateur choisit parmi `usages`.
 *   - 'dar_absent'   : au moins un usage, aucun n'a de DAR en jours : laissé vide (Q47), jamais deviné.
 *
 *   propositionUsage(produit, especes) (niveau ferme) change de règle : `candidats` inchangé, mais
 *   `dar` n'est fixé que si CHAQUE espèce de la ferme a au moins un usage et que tous sont d'accord.
 */
import { describe, expect, it } from 'vitest';
import * as index from '../index.ts';
import * as ephy from './ephy.ts';
import type { DoseEphy, ProduitEphy, PropositionUsage, UsageEphy } from './ephy.ts';

type DarPourCulture =
  | { readonly sorte: 'propose'; readonly dar: number; readonly dose: DoseEphy | null; readonly usages: readonly UsageEphy[] }
  | { readonly sorte: 'a_choisir'; readonly usages: readonly UsageEphy[] }
  | { readonly sorte: 'dar_absent'; readonly usages: readonly UsageEphy[] }
  | { readonly sorte: 'non_homologue' };

const propositionUsage: (produit: ProduitEphy, especes: readonly string[]) => PropositionUsage = ephy.propositionUsage;

function darPourCulture(produit: ProduitEphy, espece: string): DarPourCulture {
  const f = (ephy as unknown as Record<string, unknown>).darPourCulture;
  if (typeof f !== 'function') throw new Error('./ephy.ts n’exporte pas darPourCulture (T76)');
  return (f as (p: ProduitEphy, e: string) => DarPourCulture)(produit, espece);
}

const DOSE = { valeur: 0.2, unite: 'L/ha' };
const u = (culture: string, cible: string, dar: number | null, dose: UsageEphy['dose'] = DOSE): UsageEphy => ({ culture, mode: 'Trt Part.Aer.', cible, dose, dar });
const produit = (usages: readonly UsageEphy[]): ProduitEphy => ({ amm: '2200777', nom: 'FRAISIPRO', autresNoms: [], substances: ['spinosad'], bio: true, retire: false, retireLe: null, usages });

const FRAISIER_SEUL = produit([u('Fraisier', 'Thrips', 1)]);

describe('T76 : DAR de la culture traitée', () => {
  it('ferme tomate + fraise, produit homologué sur Fraisier seul : tomate → non homologué, aucun DAR ; fraise → DAR de l’usage Fraisier', () => {
    expect(darPourCulture(FRAISIER_SEUL, 'Tomate')).toEqual({ sorte: 'non_homologue' });
    expect(darPourCulture(FRAISIER_SEUL, 'Fraise')).toEqual({ sorte: 'propose', dar: 1, dose: DOSE, usages: FRAISIER_SEUL.usages });
  });

  it('deux usages de DAR différents pour la culture traitée : pas de choix automatique, les deux usages sont proposés', () => {
    const p = produit([u('Tomate', 'Thrips', 3), u('Tomate', 'Mineuses', 7), u('Fraisier', 'Thrips', 1)]);
    expect(darPourCulture(p, 'Tomate')).toEqual({ sorte: 'a_choisir', usages: [p.usages[0], p.usages[1]] });
    // L'autre culture de la ferme ne change rien à la tomate.
    expect(darPourCulture(p, 'Fraise')).toEqual({ sorte: 'propose', dar: 1, dose: DOSE, usages: [p.usages[2]] });
  });

  it('usages d’accord sur le DAR : DAR proposé ; doses différentes : pas de dose', () => {
    const p = produit([u('Tomate', 'Thrips', 3), u('Tomate', 'Chenilles', 3, { valeur: 0.015, unite: 'L/hL' })]);
    expect(darPourCulture(p, 'Tomate')).toEqual({ sorte: 'propose', dar: 3, dose: null, usages: p.usages });
  });

  it('DAR absent dans E-Phy (Q47) : laissé vide, jamais deviné', () => {
    const seul = produit([u('Fraisier', 'Oïdium(s)', null)]);
    expect(darPourCulture(seul, 'Fraise')).toEqual({ sorte: 'dar_absent', usages: seul.usages });
    const tous = produit([u('Tomate', 'Oïdium(s)', null), u('Tomate', 'Mildiou', null)]);
    expect(darPourCulture(tous, 'Tomate')).toEqual({ sorte: 'dar_absent', usages: tous.usages });
  });

  it('un usage avec DAR et un sans DAR pour la même culture : à choisir, le DAR n’est pas repris de l’autre', () => {
    const p = produit([u('Tomate', 'Thrips', 3), u('Tomate', 'Oïdium(s)', null)]);
    const r = darPourCulture(p, 'Tomate');
    expect(r.sorte).toBe('a_choisir');
    expect(r).not.toHaveProperty('dar');
  });

  it('le DAR d’une autre culture ne fuit jamais : Kiwi, espèce inconnue, nom vide → non homologué', () => {
    const p = produit([u('Tomate', 'Thrips', 3), u('Vigne', 'Thrips', 14)]);
    expect(darPourCulture(p, 'Kiwi')).toEqual({ sorte: 'non_homologue' });
    expect(darPourCulture(p, 'Plante mystère')).toEqual({ sorte: 'non_homologue' });
    expect(darPourCulture(p, '')).toEqual({ sorte: 'non_homologue' });
    expect(darPourCulture(produit([]), 'Tomate')).toEqual({ sorte: 'non_homologue' });
  });

  it('correspondance T53/T75 conservée : usage générique « Cultures légumières » pour une tomate cerise ; la fraise n’en hérite pas', () => {
    const p = produit([u('Cultures légumières', 'Oïdium(s)', 3)]);
    expect(darPourCulture(p, 'Tomate')).toEqual({ sorte: 'propose', dar: 3, dose: DOSE, usages: p.usages });
    expect(darPourCulture(p, 'Tomate cerise')).toMatchObject({ sorte: 'propose', dar: 3 });
    expect(darPourCulture(p, 'Fraise')).toEqual({ sorte: 'non_homologue' });
  });

  it('un DAR de 0 jour est un vrai DAR (pas « absent »)', () => {
    const p = produit([u('Kiwi', 'Cochenilles', 0)]);
    expect(darPourCulture(p, 'Kiwi')).toEqual({ sorte: 'propose', dar: 0, dose: DOSE, usages: p.usages });
  });

  it('ne touche pas au produit reçu', () => {
    const copie = JSON.parse(JSON.stringify(FRAISIER_SEUL)) as ProduitEphy;
    darPourCulture(FRAISIER_SEUL, 'Tomate');
    darPourCulture(FRAISIER_SEUL, 'Fraise');
    expect(FRAISIER_SEUL).toEqual(copie);
  });

  it('hors de l’index du cœur (rien du catalogue au démarrage)', () => {
    expect(Object.keys(index)).not.toContain('darPourCulture');
  });
});

describe('T76 : niveau ferme, propositionUsage ne fixe plus un DAR qui n’est pas celui de toutes les cultures', () => {
  it('ferme tomate + fraise, produit sur Fraisier seul : aucun DAR fixé (la tomate n’a pas d’usage), usages de la fraise gardés en candidats', () => {
    expect(propositionUsage(FRAISIER_SEUL, ['Tomate', 'Fraise'])).toEqual({ candidats: FRAISIER_SEUL.usages, dar: null, dose: null });
  });

  it('une espèce de la ferme sans usage empêche de fixer le DAR des autres', () => {
    const p = produit([u('Tomate', 'Thrips', 3)]);
    expect(propositionUsage(p, ['Tomate', 'Kiwi']).dar).toBeNull();
    expect(propositionUsage(p, ['Tomate', 'Kiwi']).candidats).toEqual(p.usages);
  });

  it('toutes les espèces couvertes et d’accord : DAR fixé (comportement T53 conservé)', () => {
    const p = produit([u('Tomate', 'Thrips', 3), u('Laitue', 'Thrips', 3)]);
    expect(propositionUsage(p, ['Tomate', 'Laitue']).dar).toBe(3);
    expect(propositionUsage(FRAISIER_SEUL, ['Fraise'])).toEqual({ candidats: FRAISIER_SEUL.usages, dar: 1, dose: DOSE });
  });

  it('toutes couvertes mais DAR différents, ou DAR absent d’un usage : aucun DAR fixé', () => {
    expect(propositionUsage(produit([u('Tomate', 'Thrips', 3), u('Fraisier', 'Thrips', 1)]), ['Tomate', 'Fraise']).dar).toBeNull();
    expect(propositionUsage(produit([u('Tomate', 'Thrips', 3), u('Fraisier', 'Thrips', null)]), ['Tomate', 'Fraise']).dar).toBeNull();
  });
});

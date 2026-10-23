/**
 * Tests d'acceptation T84 — E-Phy : chercher un produit par culture, ravageur ou maladie
 * (docs/backlog/T84-ephy-recherche-culture-cible.md). Catalogue figé de la règle 7.
 *
 * Contrat attendu de ./ephy.ts, en plus de `chercherProduitsEphy` (inchangée de forme) :
 *   `rechercherEphy(catalogue, texte, max = 8)` → `{ resultats, autres }` ; chaque résultat est
 *   `{ produit, usage, usagesEnPlus }` : `usage` est le premier usage qui a fait trouver le
 *   produit par sa culture ou sa cible (null si le produit n'est trouvé que par son nom, son AMM
 *   ou sa substance), `usagesEnPlus` le nombre d'autres usages qui correspondent aussi ;
 *   `autres` le nombre de produits trouvés au-delà de `max`.
 */
import { describe, expect, it } from 'vitest';
import { chercherProduitsEphy, rechercherEphy, type CatalogueEphy, type ProduitEphy, type UsageEphy } from './ephy.ts';

const usage = (culture: string, cible: string, dar: number | null): UsageEphy => ({ culture, mode: 'Trt Part.Aer.', cible, dose: null, dar });

const produit = (amm: string, nom: string, substance: string, retire: boolean, usages: UsageEphy[]): ProduitEphy => ({
  amm,
  nom,
  autresNoms: [],
  substances: [substance],
  bio: false,
  retire,
  retireLe: retire ? '2026-03-01' : null,
  usages,
});

// Règle 7 : A (soufre : tomate/oïdium et vigne/oïdium), B (deltaméthrine : tomate/pucerons),
// C (spinosad : fraisier/thrips), D (retiré : tomate/pucerons). Noms choisis pour que l'ordre
// alphabétique soit B, A (B avant A) et que D, retiré, passe après.
const A = produit('2000001', 'SOUFRIX', 'soufre', false, [usage('Tomate - Aubergine', 'Oïdium(s)', 3), usage('Vigne', 'Oïdium(s)', 5)]);
const B = produit('2000002', 'DELTAGARD', 'deltaméthrine', false, [usage('Tomate - Aubergine', 'Pucerons', 3)]);
const C = produit('2000003', 'SPINOFRAIS', 'spinosad', false, [usage('Fraisier', 'Thrips', 1)]);
const D = produit('2000004', 'ANCIENPUCE', 'deltaméthrine', true, [usage('Tomate - Aubergine', 'Pucerons', 3)]);
const CATALOGUE: CatalogueEphy = { format: 1, source: 'test', licence: 'test', dateBase: '2026-10-14', produits: [A, B, C, D] };

const noms = (texte: string): string[] => chercherProduitsEphy(CATALOGUE, texte).map((p) => p.nom);

describe('T84 règle 7 : catalogue figé', () => {
  it('« tomate » → B, A, D (autorisés d’abord, puis alphabétique)', () => {
    expect(noms('tomate')).toEqual(['DELTAGARD', 'SOUFRIX', 'ANCIENPUCE']);
  });
  it('« pucerons » → B, D', () => {
    expect(noms('pucerons')).toEqual(['DELTAGARD', 'ANCIENPUCE']);
  });
  it('« tomate pucerons » → B, D', () => {
    expect(noms('tomate pucerons')).toEqual(['DELTAGARD', 'ANCIENPUCE']);
  });
  it('« soufre oidium » → A : le mot du produit vaut pour tous ses usages', () => {
    expect(noms('soufre oidium')).toEqual(['SOUFRIX']);
  });
  it('« fraise thrips » → C : l’espèce « fraise » est traduite en culture « Fraisier »', () => {
    expect(noms('fraise thrips')).toEqual(['SPINOFRAIS']);
  });
  it('« tomate thrips » → aucun : les deux mots doivent tomber sur un même usage', () => {
    expect(noms('tomate thrips')).toEqual([]);
  });
  it('« vigne pucerons » → aucun, même si A a un usage vigne et B un usage pucerons', () => {
    expect(noms('vigne pucerons')).toEqual([]);
  });
  it('« oidium vigne » : combinaison sur le même usage de A', () => {
    expect(noms('oidium vigne')).toEqual(['SOUFRIX']);
  });
  it('accents et majuscules ignorés, singulier par inclusion', () => {
    expect(noms('OÏDIUM')).toEqual(['SOUFRIX']);
    expect(noms('Puceron')).toEqual(['DELTAGARD', 'ANCIENPUCE']);
  });
  it('un mot présent tel quel dans le nom de culture e-phy compte (« aubergine », « vigne »)', () => {
    expect(noms('aubergine')).toEqual(['DELTAGARD', 'SOUFRIX', 'ANCIENPUCE']);
    expect(noms('vigne')).toEqual(['SOUFRIX']);
  });
});

describe('T84 règle 5 : l’usage trouvé', () => {
  it('« tomate pucerons » : l’usage de B, aucun autre', () => {
    const { resultats } = rechercherEphy(CATALOGUE, 'tomate pucerons');
    expect(resultats.map((r) => r.produit.nom)).toEqual(['DELTAGARD', 'ANCIENPUCE']);
    expect(resultats[0]?.usage).toEqual(B.usages[0]);
    expect(resultats[0]?.usagesEnPlus).toBe(0);
  });
  it('« oidium » : le premier usage de A et un usage en plus', () => {
    const { resultats } = rechercherEphy(CATALOGUE, 'oidium');
    expect(resultats[0]?.usage).toEqual(A.usages[0]);
    expect(resultats[0]?.usagesEnPlus).toBe(1);
  });
  it('« tomate » ne compte pour A que son usage tomate : pas d’usage en plus', () => {
    const a = rechercherEphy(CATALOGUE, 'tomate').resultats.find((r) => r.produit === A);
    expect(a?.usage).toEqual(A.usages[0]);
    expect(a?.usagesEnPlus).toBe(0);
  });
  it('trouvé par son nom ou sa substance seulement : pas d’usage affiché', () => {
    expect(rechercherEphy(CATALOGUE, 'soufre').resultats.map((r) => r.usage)).toEqual([null]);
    expect(rechercherEphy(CATALOGUE, 'deltagard').resultats.map((r) => r.usage)).toEqual([null]);
  });
});

describe('T84 règle 4 : ordre et nombre de résultats', () => {
  const beaucoup: CatalogueEphy = {
    ...CATALOGUE,
    produits: [
      ...Array.from({ length: 11 }, (_, i) => produit(`30000${String(10 + i)}`, `PRODUIT ${String.fromCharCode(75 - i)}`, 'cuivre', false, [usage('Tomate - Aubergine', 'Mildiou', 2)])),
      produit('3000099', 'TOMATEX', 'cuivre', false, []),
    ],
  };
  it('au plus 8 résultats, et le nombre des autres', () => {
    const { resultats, autres } = rechercherEphy(beaucoup, 'tomate');
    expect(resultats).toHaveLength(8);
    expect(autres).toBe(4);
    expect(chercherProduitsEphy(beaucoup, 'tomate')).toHaveLength(8);
  });
  it('ceux dont le nom commence par la recherche passent avant les autres autorisés', () => {
    expect(rechercherEphy(beaucoup, 'tomate').resultats[0]?.produit.nom).toBe('TOMATEX');
  });
  it('pas d’autres quand tout tient', () => {
    expect(rechercherEphy(CATALOGUE, 'tomate').autres).toBe(0);
  });
  it('moins de 2 lettres : rien', () => {
    expect(rechercherEphy(CATALOGUE, 't')).toEqual({ resultats: [], autres: 0 });
  });
});

describe('T84 : la recherche par nom, AMM et substance ne change pas', () => {
  it('nom, AMM, substance', () => {
    expect(noms('deltagard')).toEqual(['DELTAGARD']);
    expect(noms('2000003')).toEqual(['SPINOFRAIS']);
    expect(noms('spinosad')).toEqual(['SPINOFRAIS']);
  });
  it('un produit sans usage reste trouvé par son nom', () => {
    const seul: CatalogueEphy = { ...CATALOGUE, produits: [produit('1', 'VIDE', 'x', false, [])] };
    expect(chercherProduitsEphy(seul, 'vide').map((p) => p.nom)).toEqual(['VIDE']);
  });
});

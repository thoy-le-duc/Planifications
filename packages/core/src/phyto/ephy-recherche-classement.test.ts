/**
 * Tests T84 (suites de relecture) — classement par spécificité de la culture, espèces en plusieurs
 * mots, indexation par tranches.
 *
 * Contrat ajouté à ./ephy.ts : `indexerTrancheEphy(catalogue, taille = TRANCHE_INDEX_EPHY)` indexe
 * au plus `taille` produits de plus et rend true quand l'index du catalogue est complet (false
 * sinon) ; `rechercherEphy` termine l'index lui-même s'il n'est pas fini.
 */
import { describe, expect, it } from 'vitest';
import { indexerTrancheEphy, rechercherEphy, TRANCHE_INDEX_EPHY, type CatalogueEphy, type ProduitEphy, type UsageEphy } from './ephy.ts';

const usage = (culture: string, cible: string): UsageEphy => ({ culture, mode: 'Trt Part.Aer.', cible, dose: null, dar: 3 });
const produit = (amm: string, nom: string, usages: UsageEphy[], retire = false): ProduitEphy => ({ amm, nom, autresNoms: [], substances: ['cuivre'], bio: false, retire, retireLe: null, usages });
const catalogue = (produits: ProduitEphy[]): CatalogueEphy => ({ format: 1, source: 't', licence: 't', dateBase: '2026-10-14', produits });
const noms = (c: CatalogueEphy, t: string): string[] => rechercherEphy(c, t).resultats.map((r) => r.produit.nom);

describe('T84 : usage spécifique avant usage générique', () => {
  const GENERIQUE = produit('1', 'AAGENERIQUE', [usage('Cultures légumières', 'Mildiou')]);
  const SPECIFIQUE = produit('2', 'ZZSPECIFIQUE', [usage('Tomate - Aubergine', 'Mildiou')]);
  const MIXTE = produit('3', 'MMMIXTE', [usage('Cultures légumières', 'Botrytis'), usage('Tomate', 'Botrytis')]);
  const RETIRE = produit('4', 'BBRETIRE', [usage('Tomate - Aubergine', 'Mildiou')], true);
  const TOMATEX = produit('5', 'TOMATEX', [usage('Cultures légumières', 'Mildiou')]);
  const c = catalogue([GENERIQUE, SPECIFIQUE, MIXTE, RETIRE, TOMATEX]);

  it('spécifiques (alphabétique), puis génériques ; le retiré reste en dernier', () => {
    expect(noms(c, 'tomate')).toEqual(['MMMIXTE', 'ZZSPECIFIQUE', 'AAGENERIQUE', 'TOMATEX', 'BBRETIRE']);
  });
  it('l’usage affiché est le plus spécifique, même s’il vient après un usage générique', () => {
    const m = rechercherEphy(c, 'tomate').resultats.find((r) => r.produit === MIXTE);
    expect(m?.usage?.culture).toBe('Tomate');
    expect(m?.usagesEnPlus).toBe(1);
  });
  it('un usage générique ne passe pas avant parce que le nom commence par la recherche', () => {
    expect(noms(c, 'tomate').indexOf('TOMATEX')).toBeGreaterThan(noms(c, 'tomate').indexOf('ZZSPECIFIQUE'));
  });
});

describe('T84 : espèce en plusieurs mots', () => {
  const POMMES = produit('1', 'CHENILLEX', [usage('Choux pommés', 'Chenilles phytophages')]);
  const HARICOT = produit('2', 'HARICOTEX', [usage('Haricots et pois non écossés frais', 'Thrips')]);
  const VERT = produit('3', 'VERTIGO', [usage('Vigne', 'Oïdium(s)')]);
  const c = catalogue([POMMES, HARICOT, VERT]);
  it('« chou rouge » est une espèce (Choux pommés), pas « chou » et « rouge »', () => {
    expect(noms(c, 'chou rouge')).toEqual(['CHENILLEX']);
    expect(noms(c, 'chou rouge chenilles')).toEqual(['CHENILLEX']);
    expect(noms(c, 'chou rouge thrips')).toEqual([]);
  });
  it('« haricot vert » ne remonte pas VERTIGO parce que « vert » est dans son nom', () => {
    expect(noms(c, 'haricot vert')).toEqual(['HARICOTEX']);
    expect(noms(c, 'haricot vert thrips')).toEqual(['HARICOTEX']);
  });
  it('un mot de cible après l’espèce reste un mot à part (« tomate pucerons » ne devient pas une espèce)', () => {
    const t = catalogue([produit('1', 'DELTA', [usage('Tomate - Aubergine', 'Pucerons')])]);
    expect(noms(t, 'tomate pucerons')).toEqual(['DELTA']);
  });
});

describe('T84 : indexation par tranches', () => {
  const grand = catalogue(Array.from({ length: 2 * TRANCHE_INDEX_EPHY + 10 }, (_, i) => produit(String(i), `P${String(1000 + i)}`, [usage('Tomate - Aubergine', 'Mildiou')])));
  it('3 tranches pour 2 tranches et 10 produits : false, false, true', () => {
    expect(indexerTrancheEphy(grand)).toBe(false);
    expect(indexerTrancheEphy(grand)).toBe(false);
    expect(indexerTrancheEphy(grand)).toBe(true);
    expect(indexerTrancheEphy(grand)).toBe(true);
  });
  it('un catalogue vide est complet d’emblée', () => {
    expect(indexerTrancheEphy(catalogue([]))).toBe(true);
  });
  it('la recherche donne les mêmes résultats, index fini ou à moitié fait', () => {
    const moitie = catalogue([...grand.produits]);
    indexerTrancheEphy(moitie);
    expect(rechercherEphy(moitie, 'tomate')).toEqual(rechercherEphy(catalogue([...grand.produits]), 'tomate'));
    expect(rechercherEphy(moitie, 'tomate').autres).toBe(grand.produits.length - 8);
  });
});

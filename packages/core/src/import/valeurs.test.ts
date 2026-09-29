/**
 * Tests d'acceptation T14 — correspondance des valeurs : une culture inconnue est rapprochée de la
 * bibliothèque avec un score (« Batavia blonde » → batavia). Contrat : ./test/contrat.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerImport, type ModuleImport } from './test/contrat.ts';
import { ESPECES, FAMILLES, geler } from './test/fixtures.ts';

let m: ModuleImport;

beforeAll(async () => {
  m = await chargerImport();
});

describe('rapprocher : valeur exacte', () => {
  it.each([
    ['Laitue', 'esp-laitue'],
    ['laitue', 'esp-laitue'],
    ['  LAITUE ', 'esp-laitue'],
    ['Salade', 'esp-laitue'],
    ['epinard', 'esp-epinard'],
    ['ÉPINARD', 'esp-epinard'],
    ['fraise', 'esp-fraisier'],
    ['esp-tomate', 'esp-tomate'],
    ['ESP-TOMATE', 'esp-tomate'],
  ])('« %s » → %s, score 1', (valeur, id) => {
    const r = m.rapprocher(valeur, ESPECES);
    expect(r.exact).toBe(true);
    expect(r.propositions[0]).toMatchObject({ id, score: 1 });
  });

  it('famille : « solanacees » → Solanacées', () => {
    expect(m.rapprocher('solanacees', FAMILLES)).toMatchObject({ exact: true, propositions: [{ id: 'fam-solanacees', nom: 'Solanacées', score: 1 }] });
  });
});

describe('rapprocher : valeur inconnue', () => {
  it('« Batavia blonde » → batavia en tête, score entre 0,7 et 1 exclu, pas exact', () => {
    const r = m.rapprocher('Batavia blonde', ESPECES);
    expect(r.exact).toBe(false);
    const [premiere] = r.propositions;
    expect(premiere).toMatchObject({ id: 'esp-batavia', nom: 'Batavia' });
    expect(premiere?.score).toBeGreaterThanOrEqual(0.7);
    expect(premiere?.score).toBeLessThan(1);
  });

  it('« Chou pommé » → chou en tête', () => {
    const r = m.rapprocher('Chou pommé', ESPECES);
    expect(r.exact).toBe(false);
    expect(r.propositions[0]?.id).toBe('esp-chou');
  });

  it('propositions : scores ≥ 0,5 et < 1, décroissants, 5 au plus', () => {
    for (const valeur of ['Batavia blonde', 'Tomates cerises', 'Carottes', 'Poireaux d’hiver', 'Chou pommé', 'Radis rose']) {
      const { propositions } = m.rapprocher(valeur, ESPECES);
      expect(propositions.length, valeur).toBeLessThanOrEqual(5);
      for (const p of propositions) {
        expect(p.score, valeur).toBeGreaterThanOrEqual(0.5);
        expect(p.score, valeur).toBeLessThan(1);
      }
      const scores = propositions.map((p) => p.score);
      expect(scores, valeur).toStrictEqual([...scores].sort((a, b) => b - a));
    }
  });

  it('rien d’approchant → aucune proposition', () => {
    expect(m.rapprocher('Rutabaga', ESPECES)).toStrictEqual({ exact: false, propositions: [] });
    expect(m.rapprocher('', ESPECES)).toStrictEqual({ exact: false, propositions: [] });
  });

  it('bibliothèque vide → aucune proposition', () => {
    expect(m.rapprocher('Laitue', [])).toStrictEqual({ exact: false, propositions: [] });
  });

  it('déterministe, et la bibliothèque n’est pas modifiée', () => {
    const biblio = geler(ESPECES.map((e) => ({ ...e })));
    expect(m.rapprocher('Batavia blonde', biblio)).toStrictEqual(m.rapprocher('Batavia blonde', biblio));
  });

  it('ne lève jamais, même sur un texte très long', () => {
    expect(() => m.rapprocher('batavia '.repeat(20_000), ESPECES)).not.toThrow();
  });
});

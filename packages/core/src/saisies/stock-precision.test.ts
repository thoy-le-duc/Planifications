/**
 * T10c, relecture (décision du chef « Précision ») : une quantité de mouvement de stock à plus de
 * 6 décimales est refusée par le cœur, code 'champ_invalide' (champ 'quantite'). Le millionième
 * est accepté. Même règle côté serveur : apps/api/src/sync/stock.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { validerMouvementStock } from './stock.ts';

const mouvement = (quantite: number) => ({
  id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  ferme_id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20',
  article_stock_id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b40',
  date: '2026-10-01',
  quantite,
  motif: 'recolte',
  recolte_id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50',
});

describe('validerMouvementStock : 6 décimales au plus', () => {
  it.each([12.0000004, 1e-7, -12.0000004])('%s : champ_invalide sur quantite', (q) => {
    const r = validerMouvementStock(mouvement(q));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatchObject({ code: 'champ_invalide', champ: 'quantite' });
  });

  it.each([0.000001, 12.5, 12.123456, -12.000001])('%s : accepté', (q) => {
    expect(validerMouvementStock(mouvement(q)).ok).toBe(true);
  });
});

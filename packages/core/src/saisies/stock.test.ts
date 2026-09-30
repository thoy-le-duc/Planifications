/**
 * Règles pures d'une saisie de stock (T10c) : article, mouvement, mouvement inverse borné.
 * Les tests d'acceptation côté serveur sont dans apps/api/src/sync/stock.integration.test.ts ;
 * ceux-ci fixent les règles du cœur, sans base.
 *
 * T10g (Q13) : test adapté. `PLAFONDS_PROVISOIRES` est renommé `PLAFONDS_SAISIES` (valeurs
 * inchangées) ; le plafond est lu sous le nouveau nom, par le contrat (chemin dynamique, comme
 * saisies.test.ts, pour que le typage ne dépende pas du renommage pas encore fait).
 */
import { describe, expect, it } from 'vitest';
import { chargerSaisies } from './test/contrat.ts';
import { mouvementAttendu, validerArticleStock, validerMouvementStock, verifierMouvementRecolte } from './stock.ts';

const ID = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10';
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20';
const ESPECE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b30';
const ARTICLE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b40';
const RECOLTE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50';
const PLAFOND = (await chargerSaisies()).PLAFONDS_SAISIES.recolteQuantite;

const article = (autres: Record<string, unknown> = {}) => ({
  id: ID,
  ferme_id: FERME,
  espece_id: ESPECE,
  variete_id: null,
  unite: 'kg',
  categorie: null,
  ...autres,
});

const mouvement = (autres: Record<string, unknown> = {}) => ({
  id: ID,
  ferme_id: FERME,
  article_stock_id: ARTICLE,
  date: '2026-10-01',
  quantite: 12,
  motif: 'recolte',
  recolte_id: RECOLTE,
  ...autres,
});

describe('validerArticleStock', () => {
  it('article complet : accepté, horodatages tolérés', () => {
    const r = validerArticleStock(article({ categorie: 'extra', cree_le: '2026-10-01T05:58:00.000Z', modifie_le: null, supprime_le: null }));
    expect(r).toEqual({
      ok: true,
      valeur: { id: ID, fermeId: FERME, especeId: ESPECE, varieteId: null, unite: 'kg', categorie: 'extra', supprimeLe: null },
    });
  });

  it.each([
    ['colonne inconnue', { prix: 4 }, 'colonne_inconnue'],
    ['espèce absente', { espece_id: null }, 'champ_manquant'],
    ['variété invalide', { variete_id: 'x' }, 'champ_invalide'],
    ['unité inconnue', { unite: 'tonne' }, 'champ_invalide'],
    ['catégorie non texte', { categorie: 3 }, 'champ_invalide'],
    ['catégorie trop longue', { categorie: 'x'.repeat(101) }, 'trop_long'],
    ['créé supprimé', { supprime_le: '2026-10-01T05:58:00.000Z' }, 'incoherent'],
  ])('%s : refusé', (_cas, autres, code) => {
    const r = validerArticleStock(article(autres));
    expect(r.ok ? null : r.erreur.code).toBe(code);
  });

  it('entrée illisible : refusée sans lever', () => {
    expect(validerArticleStock(null).ok).toBe(false);
    expect(validerArticleStock([]).ok).toBe(false);
  });
});

describe('validerMouvementStock', () => {
  it('mouvement de récolte : accepté, identifiants en minuscules', () => {
    const r = validerMouvementStock(mouvement({ recolte_id: RECOLTE.toUpperCase(), cree_le: '2026-10-01T05:58:00.000Z' }));
    expect(r.ok && r.valeur).toMatchObject({ articleStockId: ARTICLE, quantite: 12, motif: 'recolte', recolteId: RECOLTE, date: '2026-10-01' });
  });

  it('plafond compris dans les deux sens, décimales gardées', () => {
    expect(validerMouvementStock(mouvement({ quantite: PLAFOND })).ok).toBe(true);
    expect(validerMouvementStock(mouvement({ quantite: -PLAFOND })).ok).toBe(true);
    const r = validerMouvementStock(mouvement({ quantite: 12.5 }));
    expect(r.ok && r.valeur.quantite).toBe(12.5);
  });

  it.each([
    ['nulle', 0],
    ['texte', '12'],
    ['absente', null],
    ['infinie', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['au-delà du plafond', PLAFOND + 1],
    ['au-delà du plafond négatif', -(PLAFOND + 1)],
  ])('quantité %s : refusée', (_cas, quantite) => {
    expect(validerMouvementStock(mouvement({ quantite })).ok).toBe(false);
  });

  it('motif : récolte seulement depuis un téléphone (décision 5), recolte_id obligatoire', () => {
    for (const motif of ['vente', 'perte', 'ajustement', 'don', null]) {
      expect(validerMouvementStock(mouvement({ motif, recolte_id: null })).ok, String(motif)).toBe(false);
      expect(validerMouvementStock(mouvement({ motif })).ok, String(motif)).toBe(false);
    }
    expect(validerMouvementStock(mouvement({ recolte_id: null })).ok).toBe(false);
  });

  it('date invalide ou hors bornes, colonne inconnue, id dans les colonnes inconnues : refusés', () => {
    for (const date of ['2026-02-30', '01/10/2026', '1999-12-31', '2101-01-01', null]) {
      expect(validerMouvementStock(mouvement({ date })).ok, String(date)).toBe(false);
    }
    expect(validerMouvementStock(mouvement({ prix: 4 })).ok).toBe(false);
  });
});

describe('mouvement inverse borné (décision 3)', () => {
  const origine = { remplaceSorte: null, quantite: 12 } as const;
  const annulation = { remplaceSorte: 'annulation', quantite: 12 } as const;
  const correction = (quantite: number) => ({ remplaceSorte: 'correction', quantite }) as const;

  it('récolte d’origine : entrée positive seulement, sans valeur imposée', () => {
    expect(mouvementAttendu(origine, 0)).toBeNull();
    expect(verifierMouvementRecolte(12, origine, 0)).toBeNull();
    expect(verifierMouvementRecolte(2, origine, 10)).toBeNull();
    expect(verifierMouvementRecolte(-1, origine, 1)?.code).toBe('incoherent');
  });

  it('annulation : exactement l’opposé de la somme de la chaîne', () => {
    expect(mouvementAttendu(annulation, 12)).toBe(-12);
    expect(verifierMouvementRecolte(-12, annulation, 12)).toBeNull();
    expect(verifierMouvementRecolte(-50, annulation, 12)?.code).toBe('incoherent');
    expect(verifierMouvementRecolte(-12, annulation, 15)?.code).toBe('incoherent');
    expect(verifierMouvementRecolte(-15, annulation, 15)).toBeNull();
    // Autre article : rien de la chaîne dessus, aucun mouvement possible.
    expect(mouvementAttendu(annulation, 0)).toBe(0);
    expect(Object.is(mouvementAttendu(annulation, 0), -0)).toBe(false);
    expect(verifierMouvementRecolte(-12, annulation, 0)?.code).toBe('incoherent');
  });

  it('correction : nouvelle quantité − quantité en vigueur', () => {
    expect(verifierMouvementRecolte(3, correction(15), 12)).toBeNull();
    expect(verifierMouvementRecolte(5, correction(15), 12)?.code).toBe('incoherent');
    expect(verifierMouvementRecolte(-2, correction(10), 12)).toBeNull();
    expect(verifierMouvementRecolte(-3, correction(10), 12)?.code).toBe('incoherent');
    // Après une première correction (12 → 15), la suivante part de 15.
    expect(verifierMouvementRecolte(-5, correction(10), 15)).toBeNull();
  });

  it('décimales : comparées au millionième, sans erreur de virgule flottante', () => {
    expect(15.3 - 12.1).not.toBe(3.2);
    expect(verifierMouvementRecolte(3.2, correction(15.3), 12.1)).toBeNull();
    expect(verifierMouvementRecolte(-0.3, annulation, 0.1 + 0.2)).toBeNull();
    expect(verifierMouvementRecolte(-0.31, annulation, 0.3)?.code).toBe('incoherent');
  });
});

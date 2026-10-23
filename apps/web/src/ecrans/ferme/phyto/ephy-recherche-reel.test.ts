/**
 * Tests T84 (suites de relecture) sur le catalogue RÉEL du dépôt : classement par spécificité,
 * espèces en plusieurs mots, indexation par tranches bornées (aucune tâche de plus de 50 ms).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { indexerTrancheEphy, rechercherEphy, TRANCHE_INDEX_EPHY, validerCatalogueEphy, type CatalogueEphy } from '@planif/core/ephy';

const lire = (): CatalogueEphy => {
  const c = validerCatalogueEphy(JSON.parse(readFileSync(new URL('../../../../public/ephy/catalogue.json', import.meta.url), 'utf8')) as unknown);
  if (c === null) throw new Error('catalogue illisible');
  return c;
};

describe('T84 : catalogue réel', () => {
  it('« tomate » : un produit à usage Tomate passe avant ACLON, qui n’a que « Cultures légumières »', () => {
    const noms = rechercherEphy(lire(), 'tomate', 100_000).resultats.map((r) => r.produit.nom);
    expect(noms).toContain('ACLON');
    expect(noms.indexOf('ACOIDAL WG')).toBeGreaterThanOrEqual(0);
    expect(noms.indexOf('ACOIDAL WG')).toBeLessThan(noms.indexOf('ACLON'));
    const premier = rechercherEphy(lire(), 'tomate').resultats[0];
    expect(premier?.usage?.culture).toMatch(/^Tomate/);
  });
  it('« chou rouge » trouve des produits, par une culture de chou', () => {
    const { resultats } = rechercherEphy(lire(), 'chou rouge');
    expect(resultats.length).toBeGreaterThan(0);
    for (const r of resultats) expect(r.usage?.culture, r.produit.nom).toMatch(/chou|légumières/i);
  });
  it('« haricot vert » ne trouve que par un usage haricot, jamais par « vert » dans un nom', () => {
    const { resultats } = rechercherEphy(lire(), 'haricot vert', 100_000);
    expect(resultats.length).toBeGreaterThan(0);
    for (const r of resultats) expect(r.usage, r.produit.nom).not.toBeNull();
  });
  it('l’index se construit en tranches de 50 produits, chacune sous 50 ms (à froid)', () => {
    const c = lire();
    const durees: number[] = [];
    let fini = false;
    while (!fini) {
      const t0 = performance.now();
      fini = indexerTrancheEphy(c);
      durees.push(performance.now() - t0);
    }
    expect(durees.length).toBe(Math.ceil(c.produits.length / TRANCHE_INDEX_EPHY));
    expect(durees.length).toBeGreaterThan(30);
    expect(Math.max(...durees), durees.map((d) => d.toFixed(1)).join(' ')).toBeLessThan(50);
  });
});

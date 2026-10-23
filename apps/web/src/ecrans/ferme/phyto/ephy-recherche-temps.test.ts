/**
 * Test de temps T84 : la recherche par culture et cible sur le catalogue RÉEL du dépôt
 * (apps/web/public/ephy/catalogue.json) reste sous 50 ms. Médiane d'au moins 5 mesures
 * (helper commun, T31).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rechercherEphy, validerCatalogueEphy } from '@planif/core/ephy';
import { mesurer } from '../../../../../../packages/core/src/test/mesurer.ts';

const BORNE_MS = 50;
const catalogue = validerCatalogueEphy(JSON.parse(readFileSync(new URL('../../../../public/ephy/catalogue.json', import.meta.url), 'utf8')) as unknown);

describe('T84 : recherche sur le catalogue réel', () => {
  it('le catalogue réel est lisible et rempli', () => {
    expect(catalogue?.produits.length).toBeGreaterThan(1000);
  });
  it.each(['tomate', 'tomate pucerons', 'fraise thrips', 'oidium', 'soufre oidium', 'chou chenilles'])('« %s » en moins de 50 ms (médiane)', (texte) => {
    if (catalogue === null) throw new Error('catalogue illisible');
    const { mediane, detail, resultat } = mesurer(() => rechercherEphy(catalogue, texte), { echauffement: 2, mesures: 7, borneMs: BORNE_MS });
    expect(resultat.resultats.length, texte).toBeGreaterThan(0);
    expect(mediane, `${texte} : ${detail}`).toBeLessThan(BORNE_MS);
  });
});

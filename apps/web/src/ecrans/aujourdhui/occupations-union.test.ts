/**
 * T13v — `SQL_OCCUPATIONS` (deux branches en UNION ALL) rend exactement les mêmes lignes que
 * l'ancienne requête en `OR` (recopiée ici comme référence), avec des occupations de série et des
 * occupations de plantation (sans série).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import { SQL_OCCUPATIONS } from './calculs.ts';
import { creerBasePowerSync, type BasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { ecrireGrandeFerme, FERME_GRANDE } from './test/grande-ferme.ts';

/** Requête d'avant T13u : un OR entre la liste des séries et celle des plantations. */
const SQL_OCCUPATIONS_OR = `SELECT o.serie_id, o.plantation_id, o.emplacement_id FROM occupation o
  WHERE o.ferme_id = ?1 AND o.supprime_le IS NULL
  AND (o.serie_id IN (SELECT value FROM json_each(?2)) OR o.plantation_id IN (SELECT value FROM json_each(?3)))`;

let base: BasePowerSync;

beforeAll(async () => {
  base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
  await ecrireGrandeFerme(base, '2026-09-30');
}, 120_000);

afterAll(() => {
  base.fermer();
});

type Ligne = Readonly<Record<string, unknown>>;
const triees = (l: readonly Ligne[]) => l.map((x) => JSON.stringify([x.serie_id, x.plantation_id, x.emplacement_id])).sort();
const ids = (l: readonly Ligne[], col: string, n: number) => l.slice(0, n).map((x) => String(x[col]));

describe('T13v : SQL_OCCUPATIONS = ancienne requête en OR', () => {
  it('mêmes lignes pour des séries et des plantations mêlées', async () => {
    const series = await base.getAll<Ligne>('SELECT serie_id FROM occupation WHERE ferme_id = ? AND serie_id IS NOT NULL AND supprime_le IS NULL LIMIT 5', [FERME_GRANDE]);
    const plantations = await base.getAll<Ligne>(
      'SELECT plantation_id FROM occupation WHERE ferme_id = ? AND serie_id IS NULL AND plantation_id IS NOT NULL AND supprime_le IS NULL LIMIT 5',
      [FERME_GRANDE],
    );
    expect(series.length, 'des occupations de série').toBeGreaterThan(0);
    expect(plantations.length, 'des occupations de plantation (sans série)').toBeGreaterThan(0);
    const s = JSON.stringify(ids(series, 'serie_id', 5));
    const p = JSON.stringify(ids(plantations, 'plantation_id', 5));
    for (const [liste2, liste3] of [
      [s, p],
      [s, '[]'],
      ['[]', p],
    ] as const) {
      const neuf = await base.getAll<Ligne>(SQL_OCCUPATIONS, [FERME_GRANDE, liste2, liste3]);
      const ancien = await base.getAll<Ligne>(SQL_OCCUPATIONS_OR, [FERME_GRANDE, liste2, liste3]);
      expect(ancien.length).toBeGreaterThan(0);
      expect(triees(neuf)).toEqual(triees(ancien));
    }
  });
});

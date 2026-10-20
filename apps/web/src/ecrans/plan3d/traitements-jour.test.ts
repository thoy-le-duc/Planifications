/**
 * T55 — garde-fou de vitesse de la lecture des traitements du jour (./traitements-jour.ts), sur le
 * double FIDÈLE du stockage de PowerSync (../aujourdhui/test/base-powersync.ts) : les traitements du
 * jour par l'index ferme_type, leurs remplacements par l'index remplacement, jamais un parcours du
 * journal entier (il retardait les travaux de la 3D sur la grande ferme).
 */
import { describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import { creerBasePowerSync, type SchemaJson } from '../aujourdhui/test/base-powersync.ts';
import { SQL_TRAITEMENTS_DU_JOUR } from './traitements-jour.ts';

describe('T55 : lecture des traitements du jour par les index', () => {
  it('aucun parcours de ps_data__evenement : ferme_type pour le jour, remplacement pour les chaînes', () => {
    const base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
    try {
      const plan = base.plan(SQL_TRAITEMENTS_DU_JOUR, ['f', '2026-09-30', 'f']);
      const evenement = plan.filter((l) => /ps_data__evenement\b/.test(l));
      expect(evenement.length, plan.join('\n')).toBeGreaterThanOrEqual(2);
      for (const l of evenement) expect(l, plan.join('\n')).not.toMatch(/SCAN .*ps_data__evenement\b(?! USING)/);
      expect(plan.join('\n')).toMatch(/USING INDEX ps_data__evenement__ferme_type/);
      expect(plan.join('\n')).toMatch(/USING INDEX ps_data__evenement__remplacement/);
    } finally {
      base.fermer();
    }
  });
});

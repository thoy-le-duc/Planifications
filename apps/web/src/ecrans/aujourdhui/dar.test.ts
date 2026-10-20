/**
 * T52 — garde-fou de vitesse du suivi des délais avant récolte (./dar.ts) : la lecture des
 * traitements passe par l'index local ferme_type (ferme_id, type, date), sur le double FIDÈLE
 * du stockage de PowerSync (./test/base-powersync.ts) : jamais un parcours du journal entier,
 * qui disputerait la base à la relecture de la journée (e2e de la grande ferme).
 */
import { describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import { creerBasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { SQL_TRAITEMENTS } from './dar.ts';

describe('T52 : lecture des traitements par l’index ferme_type', () => {
  it('les deux parties de la requête cherchent dans l’index, aucun parcours de ps_data__evenement', () => {
    const base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
    try {
      const plan = base.plan(SQL_TRAITEMENTS, ['f', '2026-01-01', 'f', '2026-01-01']);
      const evenement = plan.filter((l) => /ps_data__evenement\b/.test(l));
      expect(evenement.length, plan.join('\n')).toBeGreaterThanOrEqual(2);
      for (const l of evenement) expect(l, plan.join('\n')).toMatch(/SEARCH .*USING INDEX ps_data__evenement__ferme_type/);
    } finally {
      base.fermer();
    }
  });
});

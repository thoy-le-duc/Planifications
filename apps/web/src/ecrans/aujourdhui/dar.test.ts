/**
 * T52 — garde-fou de vitesse du suivi des délais avant récolte (./dar.ts) : la lecture des
 * traitements passe par l'index local ferme_type (ferme_id, type, date), sur le double FIDÈLE
 * du stockage de PowerSync (./test/base-powersync.ts) : jamais un parcours du journal entier,
 * qui disputerait la base à la relecture de la journée (e2e de la grande ferme).
 *
 * T68 : la seconde partie (les corrections et annulations datées d'avant la fenêtre) passe par
 * l'index remplacement, qui ne porte que les remplacements. Par ferme_type, elle relisait tous les
 * traitements plus anciens qu'un an (3 304 sur la grande ferme de T07, et chaque année de plus) pour
 * n'en garder que les remplacements ; la 3D lance cette lecture pendant qu'on fait défiler les
 * semaines (e2e vue-3d-jumeau).
 */
import { describe, expect, it } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import { creerBasePowerSync, type SchemaJson } from './test/base-powersync.ts';
import { SQL_TRAITEMENTS } from './dar.ts';

describe('T52 : lecture des traitements par l’index ferme_type', () => {
  it('les deux parties de la requête cherchent dans un index, aucun parcours de ps_data__evenement', () => {
    const base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
    try {
      const plan = base.plan(SQL_TRAITEMENTS, ['f', '2026-01-01', 'f', '2026-01-01']);
      const evenement = plan.filter((l) => /ps_data__evenement\b/.test(l));
      expect(evenement.length, plan.join('\n')).toBe(2);
      // Les traitements de la fenêtre : ferme, type et date (index ferme_type).
      expect(evenement[0], plan.join('\n')).toMatch(/SEARCH .*USING INDEX ps_data__evenement__ferme_type \(<expr>=\? AND <expr>=\? AND <expr>>\?\)/);
      // T68 : leurs remplacements plus anciens, par l'index remplacement (et non tous les traitements d'avant la fenêtre).
      expect(evenement[1], plan.join('\n')).toMatch(/SEARCH .*USING INDEX ps_data__evenement__remplacement/);
    } finally {
      base.fermer();
    }
  });
});

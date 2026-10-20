/**
 * T55 — garde-fou de vitesse de la lecture des traitements du jour (./traitements-jour.ts), sur le
 * double FIDÈLE du stockage de PowerSync (../aujourdhui/test/base-powersync.ts) : les traitements du
 * jour par l'index ferme_type, leurs remplacements par l'index remplacement, jamais un parcours du
 * journal entier (il retardait les travaux de la 3D sur la grande ferme).
 *
 * T68 : la jointure finale relit chaque maillon par sa clé. Filtrée par `e.ferme_id = ? AND e.type`,
 * SQLite partait de l'index ferme_type et relisait TOUS les traitements de la ferme (4 331 sur la
 * grande ferme de T07, 0,35 à 2,8 s dans le navigateur, CPU ×4) pour n'en garder que ceux du jour :
 * la base, occupée, retardait la 3D au repos (e2e vue-3d-jumeau, « rendu à la demande »).
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

  it('T68 : la jointure finale cherche chaque maillon par son id, sans relire les traitements de la ferme', () => {
    const base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
    try {
      const plan = base.plan(SQL_TRAITEMENTS_DU_JOUR, ['f', '2026-09-30', 'f']);
      const texte = plan.join('\n');
      // Hors de la CTE, ps_data__evenement n'est lu que par sa clé primaire.
      const finale = plan.filter((l) => !l.startsWith('CO-ROUTINE chaine') && !l.startsWith('MATERIALIZE chaine') && /ps_data__evenement\b/.test(l));
      expect(finale.length, texte).toBe(1);
      expect(finale[0], texte).toMatch(/SEARCH ps_data__evenement USING INDEX sqlite_autoindex_ps_data__evenement_1 \(id=\?\)/);
      // L'index ferme_type ne sert qu'au départ : les traitements du jour (ferme, type ET date).
      const fermeType = plan.filter((l) => l.includes('ps_data__evenement__ferme_type'));
      expect(fermeType.length, texte).toBe(1);
      expect(fermeType[0], texte).toMatch(/\(<expr>=\? AND <expr>=\? AND <expr>=\?\)/);
    } finally {
      base.fermer();
    }
  });
});

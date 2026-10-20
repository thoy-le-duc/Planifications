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
import { AUTRE_FERME, chargerJeuVarie, FERME, JOURS_PIVOTS, multiensemble } from './test/jeu-traitements-varies.ts';

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

/** La requête d'avant T68 (origin/main), telle quelle : la référence. */
const SQL_TRAITEMENTS_AVANT_T68 = SQL_TRAITEMENTS.slice(0, SQL_TRAITEMENTS.lastIndexOf('WHERE ')) +
  `WHERE e.ferme_id = ? AND e.type = 'traitement' AND e.date < ? AND e.remplace_evenement_id IS NOT NULL AND json_valid(e.detail)`;

describe('T68 (relecture) : la requête réécrite rend exactement les lignes d’avant', () => {
  it('même multiensemble de lignes sur un jeu varié, pour chaque ferme et chaque borne', () => {
    expect(SQL_TRAITEMENTS_AVANT_T68).toContain('IS NOT NULL');
    expect(SQL_TRAITEMENTS_AVANT_T68).not.toContain(">= ''");
    for (const graine of [68, 1, 2026]) {
      const base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
      try {
        chargerJeuVarie(base, graine);
        for (const ferme of [FERME, AUTRE_FERME, 'inconnue']) {
          for (const pivot of JOURS_PIVOTS) {
            for (const decalage of [0, -1, 1, -365, -366, -367]) {
              const d = new Date(`${pivot}T00:00:00Z`);
              d.setUTCDate(d.getUTCDate() + decalage);
              const depuis = d.toISOString().slice(0, 10);
              const p = [ferme, depuis, ferme, depuis];
              const avant = multiensemble(base.lireDirect(SQL_TRAITEMENTS_AVANT_T68, p));
              const apres = multiensemble(base.lireDirect(SQL_TRAITEMENTS, p));
              expect(apres, `${ferme} depuis ${depuis} (graine ${String(graine)})`).toEqual(avant);
              if (ferme === FERME && decalage === -366) expect(avant.length).toBeGreaterThan(0);
            }
          }
        }
        // Le jeu exerce bien la seconde partie : des remplacements d'avant la fenêtre sont rendus.
        const anciens = base.lireDirect<{ n: number }>(
          `SELECT count(*) AS n FROM evenement WHERE ferme_id = ? AND type = 'traitement' AND date < ? AND remplace_evenement_id IS NOT NULL AND json_valid(detail)`,
          [FERME, '2025-09-29'],
        );
        expect(anciens[0]?.n).toBeGreaterThan(0);
        // Et des valeurs vides ou non textuelles de remplace_evenement_id, que `>= ''` doit garder.
        const bizarres = base.lireDirect<{ n: number }>(
          `SELECT count(*) AS n FROM ps_data__evenement WHERE json_type(data, '$.remplace_evenement_id') NOT IN ('text') OR json_extract(data, '$.remplace_evenement_id') = ''`,
        );
        expect(bizarres[0]?.n).toBeGreaterThan(0);
      } finally {
        base.fermer();
      }
    }
  });

  it('`>= \'\'` garde toute valeur non nulle de la colonne, comme IS NOT NULL', () => {
    const base = creerBasePowerSync(SCHEMA_LOCAL.toJSON() as SchemaJson);
    try {
      chargerJeuVarie(base, 7);
      const ecart = base.lireDirect<{ n: number }>(
        `SELECT count(*) AS n FROM evenement WHERE (remplace_evenement_id IS NOT NULL) <> coalesce(remplace_evenement_id >= '', 0)`,
      );
      expect(ecart[0]?.n).toBe(0);
    } finally {
      base.fermer();
    }
  });
});

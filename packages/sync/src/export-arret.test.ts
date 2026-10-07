/**
 * T15c, relecture : la construction de l'archive échoue pendant la lecture → la lecture
 * s'arrête aussitôt (plus aucune table lue ensuite), et l'erreur d'origine est rendue.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { type Id } from '@planif/core';
import { exporterFerme } from './export.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { PorteDonnees } from './types.ts';

const FERME = '0192f0c1-7a6e-7cc3-a000-00000000f00a';
const UTILISATEUR = '0192f0c1-7a6e-7cc3-a111-00000000000a';
const C = '2026-01-01T00:00:00.000Z';

describe('T15c relecture : construction en échec, lecture arrêtée', () => {
  let base: BaseMemoire | undefined;
  afterAll(() => {
    base?.fermer();
  });

  it('avancement qui lève à la première table : rejet avec son erreur, plus aucune lecture après', async () => {
    const b = creerBaseMemoire(SCHEMA_LOCAL);
    base = b;
    await b.writeTransaction(async (tx) => {
      await tx.execute('INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?)', [FERME, 'Ferme', 'Europe/Paris', C, C]);
    });
    const porte = creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
    const lectures: string[] = [];
    let lecturesALEchec = -1;
    const espion: PorteDonnees = {
      ...porte,
      lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
        lectures.push(sql);
        return porte.lire<T>(sql, parametres);
      },
    };
    const issue = await exporterFerme(espion, {
      fermeId: FERME,
      genereLe: C,
      jour: '2026-09-29',
      avancement: () => {
        lecturesALEchec = lectures.length;
        throw new Error('barre cassée');
      },
    }).then(
      () => 'export réussi malgré l’échec de la construction',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(issue).toBe('barre cassée');
    const auRejet = lectures.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(lectures.length, 'lectures après le rejet').toBe(auRejet);
    // Après l'échec : au plus la lecture déjà partie, jamais la suite de la base.
    expect(lecturesALEchec).toBeGreaterThan(0);
    expect(auRejet - lecturesALEchec, lectures.join('\n')).toBeLessThanOrEqual(1);
    expect(lectures.some((s) => s.includes('FROM "zone"'))).toBe(false);
  });
});

/**
 * T13m, relecture : `chaineDe` refuse (annulee) sur deux données corrompues que la journée
 * n'affiche pas non plus en vigueur :
 *   1. une origine dont `origine_id` désigne une autre ligne ;
 *   2. une chaîne remplacée sans correction ni annulation lisible (`cle` nulle) : EN_VIGUEUR n'y
 *      met rien en vigueur (l'origine est dans les origines, aucun gagnant).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAINES, chaineDe } from './fait-unique.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';

const FERME = '0192f0c1-13ad-7000-8000-00000000000a';
const O = '0192f0c1-13ad-7000-8000-0000000000d0';
const X = '0192f0c1-13ad-7000-8000-0000000000d1';
const AUTRE = '0192f0c1-13ad-7000-8000-0000000000d9';

let base: BaseMemoire;
const lire = <T>(sql: string, parametres?: readonly unknown[]): Promise<T[]> => base.getAll<T>(sql, parametres);

function poser(id: string, sorte: string | null, remplace: string | null, origine: string | null): void {
  base.recevoir(
    `INSERT INTO evenement (id, ferme_id, type, date, horodatage, source, serie_id, remplace_sorte, remplace_evenement_id, detail, origine_id)
     VALUES (?, ?, 'realise', '2026-10-01', '2026-10-01T06:00:00.000Z', 'tap', '0192f0c1-13ad-7000-8000-0000000000ff', ?, ?, '{"etape":"plantation","quantiteReelle":null}', ?)`,
    [id, FERME, sorte, remplace, origine],
  );
}

beforeEach(() => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
});

afterEach(() => {
  base.fermer();
});

describe('T13m : chaineDe refuse sur données corrompues', () => {
  it('témoin : origine reçue (origine_id = elle-même) → en vigueur', async () => {
    poser(O, null, null, O);
    expect(await chaineDe(lire, FERME, O)).toEqual({ annulee: false, enVigueur: O });
  });

  it('1. origine dont origine_id désigne une autre ligne → annulée, rien en vigueur', async () => {
    poser(O, null, null, AUTRE);
    expect(await chaineDe(lire, FERME, O)).toEqual({ annulee: true, enVigueur: null });
  });

  it('2. chaîne remplacée sans correction ni annulation (cle nulle) → annulée, comme EN_VIGUEUR', async () => {
    poser(O, null, null, null);
    poser(X, null, O, null);
    const ch = await lire<{ cle: string | null }>(`${CHAINES}SELECT cle FROM chaine WHERE origine = ?`, [FERME, O]);
    expect(ch, 'la journée voit une chaîne pour O, sans gagnant').toEqual([{ cle: null }]);
    expect(await chaineDe(lire, FERME, O)).toEqual({ annulee: true, enVigueur: null });
  });
});

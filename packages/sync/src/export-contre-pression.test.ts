/**
 * T15d (suite de la relecture T15c) : contre-pression de la lecture vers la construction. Au-delà
 * de `lignesEnAttenteMax` lignes lues d'avance, la table k+1 n'est lue qu'une fois la table k−1
 * entièrement écrite dans l'archive : les tables lues ne s'empilent plus en mémoire quand la
 * construction prend du retard.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { TABLES_EXPORTEES, type Compresseur, type Id } from '@planif/core';
import { compresseurParDefaut, exporterFerme } from './export.ts';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { PorteDonnees } from './types.ts';

const FERME = '0192f0c1-7a6e-7cc3-a000-00000000f15d';
const UTILISATEUR = '0192f0c1-7a6e-7cc3-a111-00000000015d';
const C = '2026-01-01T00:00:00.000Z';

/** Le deflate de @planif/sync, ralenti : la construction prend du retard sur la lecture. */
function compresseurLent(ms: number): Compresseur {
  const vrai = compresseurParDefaut();
  if (vrai === undefined) throw new Error('CompressionStream absent');
  return async function* (brut) {
    for await (const morceau of vrai(brut)) {
      await new Promise((ok) => setTimeout(ok, ms));
      yield morceau;
    }
    await new Promise((ok) => setTimeout(ok, ms));
  };
}

describe('T15d : contre-pression de la lecture', () => {
  let base: BaseMemoire | undefined;
  afterAll(() => {
    base?.fermer();
  });

  it('construction lente : la table k+1 n’est lue qu’une fois la table k−1 écrite', async () => {
    const b = creerBaseMemoire(SCHEMA_LOCAL);
    base = b;
    await b.writeTransaction(async (tx) => {
      await tx.execute('INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?)', [FERME, 'Ferme', 'Europe/Paris', C, C]);
    });
    const porte = creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
    const noms = Object.keys(TABLES_EXPORTEES);
    // Part de la barre de chaque table : le total compte une part par table et une pour la fin.
    let part = 0;
    let fait = 0;
    /** Avancement au moment de la première lecture de chaque table. */
    const auDebut = new Map<string, number>();
    const espion: PorteDonnees = {
      ...porte,
      lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
        const table = /FROM "([a-z_]+)"/.exec(sql)?.[1];
        if (table !== undefined && !auDebut.has(table)) auDebut.set(table, fait);
        return porte.lire<T>(sql, parametres);
      },
    };
    const archive = await exporterFerme(espion, {
      fermeId: FERME,
      genereLe: C,
      jour: '2026-10-10',
      compresseur: compresseurLent(5),
      // Contre-pression à chaque table, quel que soit le nombre de lignes lues d'avance.
      lignesEnAttenteMax: 0,
      avancement: (a) => {
        part = a.total / (noms.length + 1);
        fait = a.fait;
      },
    });
    expect(archive.octets.length).toBeGreaterThan(0);
    expect(part).toBeGreaterThan(0);
    expect(auDebut.size).toBe(noms.length);
    for (let k = 2; k < noms.length; k++) {
      const nom = noms[k] ?? '';
      // Tables 0 … k−2 entièrement écrites : leurs parts sont pleines.
      expect(auDebut.get(nom), `avancement à la lecture de ${nom}`).toBeGreaterThanOrEqual((k - 1) * part);
    }
  });

  it('peu de lignes lues d’avance (sous la limite par défaut) : la lecture n’attend pas la construction', async () => {
    const b = base;
    if (b === undefined) throw new Error('base du test précédent absente');
    const porte = creerPorte(b, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'> });
    const noms = Object.keys(TABLES_EXPORTEES);
    let part = 0;
    let fait = 0;
    const auDebut = new Map<string, number>();
    const espion: PorteDonnees = {
      ...porte,
      lire: <T,>(sql: string, parametres?: readonly unknown[]) => {
        const table = /FROM "([a-z_]+)"/.exec(sql)?.[1];
        if (table !== undefined && !auDebut.has(table)) auDebut.set(table, fait);
        return porte.lire<T>(sql, parametres);
      },
    };
    await exporterFerme(espion, {
      fermeId: FERME,
      genereLe: C,
      jour: '2026-10-10',
      compresseur: compresseurLent(5),
      avancement: (a) => {
        part = a.total / (noms.length + 1);
        fait = a.fait;
      },
    });
    // Une ferme de quelques lignes : toutes les tables lues bien avant d'être écrites.
    const enAvance = noms.filter((nom, k) => k >= 2 && (auDebut.get(nom) ?? 0) < (k - 1) * part);
    expect(enAvance.length, 'tables lues avant l’écriture de la table k−1').toBeGreaterThan(0);
  });
});

/**
 * T10f, règle 1 — la porte refuse une transaction trop LOURDE, avant d'écrire.
 *
 * Pourquoi : le serveur refuse un corps de plus de 5 Mio ('lot_trop_gros', la saisie est perdue)
 * et coupe au-delà de 8 Mio par un 413, qui bloquerait la file PowerSync pour toujours. La porte
 * garde donc la même borne que le serveur (5 Mio) : une transaction légitime n'atteint jamais le
 * serveur trop grosse, et l'erreur est visible tout de suite, au moment de la saisie.
 *
 * Contrat :
 *   - `TAILLE_MAX_PAR_LOT` exporté par @planif/sync : 5 × 1 048 576 octets (comme
 *     TAILLE_MAX_CORPS de l'API) ;
 *   - taille d'une transaction = octets UTF-8 de `JSON.stringify(ordres)` (la liste passée à
 *     `ecrireEnsemble`, `{ sql, parametres }`). Même unité que le serveur, qui mesure les octets du
 *     corps JSON : un accent compte deux octets, pas un caractère ;
 *   - exactement TAILLE_MAX_PAR_LOT : accepté ; un octet de plus : la promesse est rejetée, AUCUNE
 *     transaction ouverte, rien d'écrit (tout ou rien), comme la limite des 500 ordres.
 */
import type { Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type BaseLocale, type ModuleSync, type PorteDonnees } from './test/contrat.ts';

const UTILISATEUR = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>;
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'>;
const ESPECE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b80';
const MIO = 1_048_576;

interface Ordre {
  readonly sql: string;
  readonly parametres?: readonly unknown[];
}

type PorteEnsemble = PorteDonnees & { ecrireEnsemble?: (ordres: readonly Ordre[]) => Promise<void> };

const octets = (ordres: readonly Ordre[]): number => new TextEncoder().encode(JSON.stringify(ordres)).length;

/** Un article de stock dont la catégorie porte `remplissage` (texte libre, sans contrainte locale). */
function article(i: number, remplissage: string): Ordre {
  return {
    sql: `INSERT INTO article_stock (id, ferme_id, espece_id, variete_id, unite, categorie) VALUES (?, ?, ?, NULL, 'kg', ?)`,
    parametres: [`0192f0c1-7a6e-7cc3-9b1e-${String(i).padStart(12, '0')}`, FERME, ESPECE, remplissage],
  };
}

/** Deux ordres dont la taille totale fait exactement `cible` octets (remplissage ASCII). */
function transactionDe(cible: number): Ordre[] {
  const vide = [article(1, ''), article(2, '')];
  const manque = cible - octets(vide);
  const moitie = Math.floor(manque / 2);
  const ordres = [article(1, 'x'.repeat(moitie)), article(2, 'x'.repeat(manque - moitie))];
  expect(octets(ordres), 'taille construite').toBe(cible);
  return ordres;
}

describe('T10f : la porte refuse une transaction de plus de 5 Mio, avant d’écrire', () => {
  let sync: ModuleSync;
  let base: BaseMemoire;
  let porte: PorteEnsemble;
  let transactions: number;

  beforeAll(async () => {
    sync = await chargerSync();
  });

  beforeEach(() => {
    base = creerBaseMemoire(sync.SCHEMA_LOCAL);
    transactions = 0;
    const compteuse: BaseLocale = {
      getAll: (sql, p) => base.getAll(sql, p),
      execute: (sql, p) => base.execute(sql, p),
      writeTransaction: (fn) => {
        transactions++;
        return base.writeTransaction(fn);
      },
      onChange: (g, o) => base.onChange(g, o),
    };
    porte = sync.creerPorte(compteuse, { utilisateurId: UTILISATEUR, fermeId: FERME });
  });

  afterEach(() => {
    base.fermer();
  });

  function ecrireEnsemble(ordres: readonly Ordre[]): Promise<void> {
    expect(typeof porte.ecrireEnsemble, 'porte.ecrireEnsemble').toBe('function');
    return porte.ecrireEnsemble?.(ordres) ?? Promise.reject(new Error('porte.ecrireEnsemble absente'));
  }

  const compter = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM article_stock')[0]?.n ?? -1;

  it('TAILLE_MAX_PAR_LOT exporté par @planif/sync : 5 Mio (5 × 1 048 576 octets), comme le serveur', () => {
    const max: unknown = (sync as unknown as Record<string, unknown>).TAILLE_MAX_PAR_LOT;
    expect(max, 'TAILLE_MAX_PAR_LOT exporté par @planif/sync').toBe(5 * MIO);
  });

  it('5 Mio + 1 octet : rejet, aucune transaction ouverte, rien d’écrit', async () => {
    await expect(ecrireEnsemble(transactionDe(5 * MIO + 1))).rejects.toThrow();
    expect(transactions, 'rien n’est ouvert').toBe(0);
    expect(compter()).toBe(0);
  });

  it('exactement 5 Mio : écrit, en une transaction', async () => {
    await ecrireEnsemble(transactionDe(5 * MIO));
    expect(transactions).toBe(1);
    expect(compter()).toBe(2);
  });

  it('la taille se compte en octets UTF-8 : 3 Mi caractères accentués (6 Mio) sont refusés', async () => {
    const ordres = [article(1, 'é'.repeat(3 * MIO))];
    expect(JSON.stringify(ordres).length, 'moins de 5 Mi caractères').toBeLessThan(5 * MIO);
    await expect(ecrireEnsemble(ordres)).rejects.toThrow();
    expect(transactions).toBe(0);
    expect(compter()).toBe(0);
  });

  it('un seul ordre très lourd (une note de 9 Mio) : rejet, jamais le 413 du serveur', async () => {
    await expect(ecrireEnsemble([article(1, 'x'.repeat(9 * MIO))])).rejects.toThrow();
    expect(transactions).toBe(0);
    expect(compter()).toBe(0);
  });

  it('après un rejet, la porte reste utilisable : une saisie normale passe', async () => {
    await expect(ecrireEnsemble(transactionDe(5 * MIO + 1))).rejects.toThrow();
    await ecrireEnsemble([article(7, 'légumes')]);
    expect(compter()).toBe(1);
  });
});

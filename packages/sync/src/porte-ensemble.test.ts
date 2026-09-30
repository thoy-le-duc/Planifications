/**
 * T10c — la porte écrit plusieurs lignes en UNE transaction locale (une saisie = une transaction
 * PowerSync = un seul envoi à POST /sync/upload, accepté ou refusé en entier par le serveur).
 * T13 la réutilise pour la récolte (événement + article + mouvement) et son annulation.
 *
 * Contrat (nom proposé ; le contrat de T13 ne nomme pas de méthode, il compte seulement les
 * `writeTransaction`) :
 *
 *   porte.ecrireEnsemble(ordres: readonly { sql: string; parametres?: readonly unknown[] }[]): Promise<void>
 *
 * - UN seul appel à `writeTransaction` de la base, qui exécute les ordres dans l'ordre donné ;
 * - un ordre qui échoue : la promesse est rejetée et RIEN n'est écrit (retour arrière) ;
 * - liste vide : aucune transaction ouverte ;
 * - aucun réseau ; les requêtes surveillées sont prévenues une fois l'ensemble validé.
 * À ajouter au type `PorteDonnees` (packages/sync/src/types.ts).
 */
import type { Id } from '@planif/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import { chargerSync, type BaseLocale, type ModuleSync, type PorteDonnees } from './test/contrat.ts';

const UTILISATEUR = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>;
const FERME = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'>;
const ARTICLE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50';
const MOUVEMENT = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b60';
const RECOLTE = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b70';

interface Ordre {
  readonly sql: string;
  readonly parametres?: readonly unknown[];
}

type PorteEnsemble = PorteDonnees & { ecrireEnsemble?: (ordres: readonly Ordre[]) => Promise<void> };

const ARTICLE_SQL: Ordre = {
  sql: `INSERT INTO article_stock (id, ferme_id, espece_id, variete_id, unite, categorie) VALUES (?, ?, ?, NULL, 'kg', NULL)`,
  parametres: [ARTICLE, FERME, '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b80'],
};
const MOUVEMENT_SQL: Ordre = {
  sql: `INSERT INTO mouvement_stock (id, ferme_id, article_stock_id, date, quantite, motif, recolte_id) VALUES (?, ?, ?, '2026-10-01', 12, 'recolte', ?)`,
  parametres: [MOUVEMENT, FERME, ARTICLE, RECOLTE],
};

describe('T10c : la porte écrit plusieurs lignes en une transaction', () => {
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

  const compter = (table: string): number => base.lireDirect<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)[0]?.n ?? -1;

  it('article et mouvement : écrits tous les deux, en UNE transaction', async () => {
    await ecrireEnsemble([ARTICLE_SQL, MOUVEMENT_SQL]);
    expect(transactions).toBe(1);
    expect(compter('article_stock')).toBe(1);
    expect(base.lireDirect('SELECT article_stock_id, quantite, recolte_id FROM mouvement_stock')).toEqual([
      { article_stock_id: ARTICLE, quantite: 12, recolte_id: RECOLTE },
    ]);
  });

  it('un ordre en échec : rejet, et rien d’écrit (pas même les ordres d’avant)', async () => {
    await expect(ecrireEnsemble([ARTICLE_SQL, MOUVEMENT_SQL, { sql: 'INSERT INTO table_absente (id) VALUES (?)', parametres: ['x'] }])).rejects.toThrow();
    expect(compter('article_stock')).toBe(0);
    expect(compter('mouvement_stock')).toBe(0);
  });

  it('les requêtes surveillées voient l’ensemble d’un coup, après validation', async () => {
    const vus: number[] = [];
    const arreter = porte.surveiller<{ n: number }>(
      { sql: 'SELECT count(*) AS n FROM mouvement_stock', tables: ['mouvement_stock', 'article_stock'] },
      (lignes) => vus.push(lignes[0]?.n ?? -1),
    );
    await ecrireEnsemble([ARTICLE_SQL, MOUVEMENT_SQL]);
    const fin = Date.now() + 1000;
    while (!vus.includes(1) && Date.now() < fin) await new Promise((ok) => setTimeout(ok, 5));
    arreter();
    expect(vus).toContain(1);
    expect(vus.every((n) => n === 0 || n === 1)).toBe(true);
  });

  it('liste vide : aucune transaction', async () => {
    await ecrireEnsemble([]);
    expect(transactions).toBe(0);
  });
});

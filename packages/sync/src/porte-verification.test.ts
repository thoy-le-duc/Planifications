/**
 * T13h — écriture conditionnelle : `porte.ecrireEnsemble(ordres, verifier)` lance `verifier` DANS
 * la transaction d'écriture, avant les ordres. S'il lève, la promesse est rejetée avec son erreur
 * et rien n'est écrit ; sinon les ordres s'écrivent comme avant, en une transaction.
 */
import type { Id } from '@planif/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte } from './porte.ts';
import { SCHEMA_LOCAL } from './schema.ts';
import { creerBaseMemoire, type BaseMemoire } from './test/base-memoire.ts';
import type { OrdreEcriture, PorteDonnees, VerificationEcriture } from './types.ts';

const OPTIONS = { utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10' as Id<'Utilisateur'>, fermeId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20' as Id<'Ferme'> };

const article = (id: string): OrdreEcriture => ({
  sql: `INSERT INTO article_stock (id, ferme_id, espece_id, variete_id, unite, categorie) VALUES (?, ?, 'e', NULL, 'kg', NULL)`,
  parametres: [id, OPTIONS.fermeId],
});

class Refus extends Error {}

/** N'écrit que si aucun article n'existe encore. */
const siVide: VerificationEcriture = async (lire) => {
  const n = (await lire<{ n: number }>('SELECT count(*) AS n FROM article_stock'))[0]?.n ?? 0;
  if (n > 0) throw new Refus('déjà là');
};

describe('T13h : écriture conditionnelle de la porte', () => {
  let base: BaseMemoire;
  let porte: PorteDonnees;
  let transactions: number;

  beforeEach(() => {
    base = creerBaseMemoire(SCHEMA_LOCAL);
    transactions = 0;
    porte = creerPorte(
      {
        getAll: (sql, p) => base.getAll(sql, p),
        execute: (sql, p) => base.execute(sql, p),
        writeTransaction: (fn) => {
          transactions++;
          return base.writeTransaction(fn);
        },
        onChange: (g, o) => base.onChange(g, o),
      },
      OPTIONS,
    );
  });

  afterEach(() => {
    base.fermer();
  });

  const compter = (): number => base.lireDirect<{ n: number }>('SELECT count(*) AS n FROM article_stock')[0]?.n ?? -1;

  it('vérification passée : les ordres s’écrivent, en une transaction', async () => {
    await porte.ecrireEnsemble([article('a1')], siVide);
    expect(compter()).toBe(1);
    expect(transactions).toBe(1);
  });

  it('vérification en échec : rejet avec son erreur, rien d’écrit', async () => {
    await porte.ecrireEnsemble([article('a1')]);
    await expect(porte.ecrireEnsemble([article('a2'), article('a3')], siVide)).rejects.toBeInstanceOf(Refus);
    expect(compter()).toBe(1);
  });

  it('deux portes sur la même base, sans attendre : la vérification voit l’écriture de l’autre', async () => {
    const autre = creerPorte(base, OPTIONS);
    const r = await Promise.allSettled([porte.ecrireEnsemble([article('a1')], siVide), autre.ecrireEnsemble([article('a2')], siVide)]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(compter()).toBe(1);
  });
});

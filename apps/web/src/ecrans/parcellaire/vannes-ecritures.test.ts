/**
 * Tests d'acceptation T57 — les écritures de l'écran « Vannes » (./vannes/ecritures.ts) passent la
 * règle de ligne du serveur (apps/api/src/sync/structure-lignes.ts, `validerStructure`), une
 * transaction par geste, annulations comprises. Environnement node (la règle du serveur importe
 * @planif/db, qui ne se charge pas sous happy-dom) ; l'écran lui-même : ./vannes.test.tsx.
 */
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { ecrireFermeVannes, FERME, P3, P5, PC1, UTILISATEUR, VANNE_12 } from './test/ferme-vannes.ts';

const AUJOURDHUI = '2026-10-19';
const MAINTENANT = new Date('2026-10-19T08:00:00.000Z');

interface Enregistrement {
  readonly texte: string;
  annuler(): Promise<void>;
}
interface ModuleEcrituresVannes {
  creerVannes(ctx: unknown, lot: readonly { numeroVanne: number; nom: string }[]): Promise<Enregistrement>;
  enregistrerVanne(ctx: unknown, id: string, v: { numeroVanne: number; nom: string; debitLitresHeure: number | null }, voulus: readonly string[]): Promise<Enregistrement | null>;
  supprimerVanne(ctx: unknown, id: string): Promise<Enregistrement>;
}
interface ResultatStructure {
  readonly ok: boolean;
  readonly erreur?: { readonly message: string; readonly champ: string | null };
}

const CHEMIN = './vannes/ecritures.ts';
const CHEMIN_STRUCTURE = resolve(import.meta.dirname, '../../../../api/src/sync/structure-lignes.ts');
let m: ModuleEcrituresVannes;
let structure: { validerStructure(table: string, ligne: Readonly<Record<string, unknown>>): ResultatStructure };
let base: BaseMemoire;
let porte: PorteDonnees;
let transactions = 0;
const ctx = () => ({ porte, fermeId: FERME, maintenant: () => MAINTENANT, aujourdhui: AUJOURDHUI });

beforeAll(async () => {
  m = (await import(/* @vite-ignore */ CHEMIN)) as ModuleEcrituresVannes;
  structure = (await import(/* @vite-ignore */ CHEMIN_STRUCTURE)) as typeof structure;
});
beforeEach(async () => {
  base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeVannes(base, { vannes: true });
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  transactions = 0;
});
afterEach(() => {
  base.fermer();
});

type Ligne = Readonly<Record<string, string | number | null>>;
const lire = (sql: string): Ligne[] => base.lireDirect<Ligne>(sql);

function acceptees(table: 'secteur_irrigation' | 'secteur_emplacement'): void {
  const lignes = lire(`SELECT * FROM ${table} ORDER BY id`);
  expect(lignes.length).toBeGreaterThan(0);
  for (const l of lignes) {
    expect(l.adresse_modbus ?? null, 'adresse Modbus jamais écrite').toBeNull();
    const reste = Object.fromEntries(Object.entries(l).filter(([c]) => !['cree_le', 'modifie_le', 'adresse_modbus'].includes(c)));
    const r = structure.validerStructure(table, reste);
    expect(r.ok, r.ok ? '' : `${table} ${String(l.id)} refusée par le serveur : ${r.erreur?.message ?? '?'} (${String(r.erreur?.champ)})`).toBe(true);
  }
}

describe('T57 : écritures des vannes relues par la règle de ligne du serveur', () => {
  it('60 vannes en lot, liens sur deux zones, réseau changé, suppression et annulations : chaque ligne passe, une transaction par geste', async () => {
    const lot = await m.creerVannes(
      ctx(),
      Array.from({ length: 60 }, (_, i) => ({ numeroVanne: 20 + i, nom: `V${String(20 + i)}` })),
    );
    expect(transactions).toBe(1);
    acceptees('secteur_irrigation');

    const v20 = String(lire(`SELECT id FROM secteur_irrigation WHERE numero_vanne = 20`)[0]?.id);
    transactions = 0;
    await m.enregistrerVanne(ctx(), v20, { numeroVanne: 20, nom: 'V20', debitLitresHeure: 900 }, [P5, PC1]);
    expect(transactions).toBe(1);
    acceptees('secteur_emplacement');

    transactions = 0;
    const change = await m.enregistrerVanne(ctx(), VANNE_12, { numeroVanne: 12, nom: 'V12 fraises', debitLitresHeure: 850 }, [P5]);
    expect(transactions).toBe(1);
    acceptees('secteur_irrigation');
    acceptees('secteur_emplacement');
    expect(lire(`SELECT au FROM secteur_emplacement WHERE secteur_irrigation_id = '${VANNE_12}' AND emplacement_id = '${P3}'`)[0]?.au).toBe('2026-10-18');

    transactions = 0;
    await change?.annuler();
    expect(transactions).toBe(1);
    acceptees('secteur_irrigation');
    acceptees('secteur_emplacement');

    await expect(m.supprimerVanne(ctx(), VANNE_12)).rejects.toThrow(/arrose encore/);
    await m.enregistrerVanne(ctx(), VANNE_12, { numeroVanne: 12, nom: 'V12', debitLitresHeure: 850 }, []);
    const suppression = await m.supprimerVanne(ctx(), VANNE_12);
    acceptees('secteur_irrigation');
    await suppression.annuler();
    await lot.annuler();
    acceptees('secteur_irrigation');
    expect(lire(`SELECT COUNT(*) AS n FROM secteur_irrigation WHERE supprime_le IS NULL`)[0]?.n).toBe(3);
  });
});

/**
 * Outils des tests de T49 : base mémoire de la ferme neuve (./ferme-neuve.ts), porte qui compte
 * les transactions, lecture des lignes écrites, et règles du serveur rejouées sur chaque ligne
 * écrite (`validerStructure` d'apps/api/src/sync/structure-lignes.ts, chargé par un chemin tenu
 * dans une variable : le typage de l'appli web ne dépend pas de l'API).
 */
import { resolve } from 'node:path';
import { expect } from 'vitest';
import { creerPorte, SCHEMA_LOCAL, type BaseLocale, type PorteDonnees } from '@planif/sync';
import type { Id } from '@planif/core';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../../packages/sync/src/test/base-memoire.ts';
import { ecrireFermeNeuve, FERME, UTILISATEUR, type OptionsFermeNeuve } from './ferme-neuve.ts';

/** Jour des tests (lundi). */
export const AUJOURDHUI = '2026-10-19';
export const MAINTENANT = new Date('2026-10-19T08:00:00.000Z');

export type Ligne = Readonly<Record<string, string | number | null>>;

export interface Banc {
  readonly base: BaseMemoire;
  readonly porte: PorteDonnees;
  transactions(): number;
  remiseAZero(): void;
}

export async function creerBanc(options: OptionsFermeNeuve = {}): Promise<Banc> {
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  await ecrireFermeNeuve(base, options);
  let transactions = 0;
  const compteuse: BaseLocale = {
    getAll: (sql, p) => base.getAll(sql, p),
    execute: (sql, p) => base.execute(sql, p),
    writeTransaction: (fn) => {
      transactions++;
      return base.writeTransaction(fn);
    },
    onChange: (g, o) => base.onChange(g, o),
  };
  const porte = creerPorte(compteuse, { utilisateurId: UTILISATEUR as Id<'Utilisateur'>, fermeId: FERME as Id<'Ferme'>, maintenant: () => MAINTENANT });
  return {
    base,
    porte,
    transactions: () => transactions,
    remiseAZero: () => {
      transactions = 0;
    },
  };
}

export const lire = (b: Banc, sql: string, p: readonly unknown[] = []): Ligne[] => b.base.lireDirect<Ligne>(sql, p);
export const saisons = (b: Banc): Ligne[] => lire(b, 'SELECT * FROM saison ORDER BY debut, id');
export const zones = (b: Banc): Ligne[] => lire(b, 'SELECT * FROM zone ORDER BY cree_le, id');
export const emplacements = (b: Banc): Ligne[] => lire(b, 'SELECT * FROM emplacement ORDER BY cree_le, id');
export const actifs = (l: readonly Ligne[]): Ligne[] => l.filter((x) => x.supprime_le === null);

interface ResultatStructure {
  readonly ok: boolean;
  readonly erreur?: { readonly message: string; readonly champ: string | null };
}
interface ModuleStructure {
  validerStructure(table: 'saison' | 'zone' | 'emplacement', ligne: Readonly<Record<string, unknown>>): ResultatStructure;
}
/** Adresse absolue : le fichier est hors de la racine de l'appli web (apps/web). */
const CHEMIN_STRUCTURE = resolve(import.meta.dirname, '../../../../../api/src/sync/structure-lignes.ts');
let structure: ModuleStructure | undefined;

/** Chaque ligne est acceptée par la règle de ligne du serveur (T10s). */
export async function acceptePar(table: 'saison' | 'zone' | 'emplacement', lignes: readonly Ligne[]): Promise<void> {
  structure ??= (await import(/* @vite-ignore */ CHEMIN_STRUCTURE)) as ModuleStructure;
  expect(lignes.length).toBeGreaterThan(0);
  for (const l of lignes) {
    const r = structure.validerStructure(table, l);
    expect(r.ok, r.ok ? '' : `${table} ${String(l.id)} refusée par le serveur : ${r.erreur?.message ?? '?'} (${String(r.erreur?.champ)})`).toBe(true);
  }
}

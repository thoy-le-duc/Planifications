/**
 * Écriture d'un import de tableur (T14b) dans la base locale, par la porte. Pur : ni
 * PowerSync, ni horloge ; se charge dans le Web Worker de préparation (les ordres y sont
 * préparés, puis écrits lot par lot par la page, `porte.ecrireEnsemble`).
 *
 * Un import s'écrit en LOTS (décision du chef, option A) : la porte refuse plus de
 * ECRITURES_MAX_PAR_LOT ordres par `ecrireEnsemble`, le serveur plus de 500 écritures par envoi
 * (`lot_trop_gros` ; au-delà de 2 000, un 413 bloquerait la synchro) ou plus de TAILLE_MAX_PAR_LOT
 * octets. Un lot = un `ecrireEnsemble` = un envoi, accepté ou refusé en entier par le serveur.
 * L'annulation d'un import (src/ecrans/import/historique.ts) suit les mêmes limites.
 *
 * Un ordre = une ligne écrite (INSERT ou UPDATE d'une seule ligne) : c'est ce que PowerSync envoie
 * au serveur, une écriture par ligne. Un groupe (une série et ses occupations) n'est jamais coupé
 * entre deux lots : le serveur vérifie leur cohérence en fin de lot.
 */
import { ECRITURES_MAX_PAR_LOT, TAILLE_MAX_PAR_LOT } from '@planif/core';
import type { OrdreEcriture } from './types.ts';

type Valeur = string | number | null;

/** Ligne à écrire : colonnes du schéma local (snake_case), valeurs telles que SQLite les range. */
export type LigneAEcrire = Readonly<Record<string, Valeur>>;

const MOTIF_NOM = /^[a-z_][a-z0-9_]*$/;

function nomSur(nom: string): string {
  if (!MOTIF_NOM.test(nom)) throw new Error(`nom de table ou de colonne refusé : ${nom}`);
  return nom;
}

/** INSERT d'une ligne : colonnes dans l'ordre de `colonnes`, valeurs absentes à NULL. */
export function ordreInsertion(table: string, colonnes: readonly string[], ligne: LigneAEcrire): OrdreEcriture {
  const noms = colonnes.map(nomSur);
  return {
    sql: `INSERT INTO ${nomSur(table)} (${noms.join(', ')}) VALUES (${noms.map(() => '?').join(', ')})`,
    parametres: noms.map((c) => ligne[c] ?? null),
  };
}

const encodeur = new TextEncoder();

/** Octets UTF-8 d'un ordre dans `JSON.stringify(ordres)` (la mesure de la porte), virgule comprise. */
export function octetsOrdre(o: OrdreEcriture): number {
  return encodeur.encode(JSON.stringify(o)).length + 1;
}

export interface LimitesLot {
  readonly ecritures: number;
  readonly octets: number;
}

export const LIMITES_LOT: LimitesLot = { ecritures: ECRITURES_MAX_PAR_LOT, octets: TAILLE_MAX_PAR_LOT };

/**
 * Range des groupes d'ordres (dans l'ordre) en lots d'au plus `limites.ecritures` ordres et
 * `limites.octets` octets, sans jamais couper un groupe. Un groupe plus gros qu'un lot à lui seul
 * lève une erreur (aucun ne l'est : une série et ses occupations tiennent en quelques ordres).
 */
export function decouperEnLots(groupes: readonly (readonly OrdreEcriture[])[], limites: LimitesLot = LIMITES_LOT): OrdreEcriture[][] {
  const lots: OrdreEcriture[][] = [];
  let courant: OrdreEcriture[] = [];
  let octets = 2;
  for (const g of groupes) {
    if (g.length === 0) continue;
    const poids = g.reduce((n, o) => n + octetsOrdre(o), 0);
    if (g.length > limites.ecritures || poids + 2 > limites.octets) throw new Error(`groupe de ${String(g.length)} écritures trop gros pour un lot`);
    if (courant.length + g.length > limites.ecritures || octets + poids > limites.octets) {
      lots.push(courant);
      courant = [];
      octets = 2;
    }
    courant.push(...g);
    octets += poids;
  }
  if (courant.length > 0) lots.push(courant);
  return lots;
}

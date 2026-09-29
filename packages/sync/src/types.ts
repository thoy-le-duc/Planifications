/**
 * Types publics de @planif/sync (T10). La porte ne connaît de PowerSync que le sous-ensemble
 * `BaseLocale`, que `PowerSyncDatabase` (@powersync/web) satisfait : elle se teste sur un SQLite
 * en mémoire, et aucun écran n'a besoin d'importer PowerSync.
 *
 * Format des lignes locales : noms de tables et de colonnes de Postgres (snake_case), valeurs
 * telles que SQLite les stocke (texte, nombre, null). Dates 'AAAA-MM-JJ', instants ISO 8601 UTC
 * (`toISOString()`), jsonb et tableaux en texte JSON. C'est aussi le format des `donnees`
 * envoyées à POST /sync/upload.
 */
import type { Evenement, GenerateurId, Id } from '@planif/core';

export interface TransactionLocale {
  getAll<T>(sql: string, parametres?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, parametres?: readonly unknown[]): Promise<unknown>;
}

/** Sous-ensemble de `AbstractPowerSyncDatabase` utilisé par la porte, et rien d'autre. */
export interface BaseLocale extends TransactionLocale {
  writeTransaction<R>(fn: (tx: TransactionLocale) => Promise<R>): Promise<R>;
  onChange(
    gestionnaire: { onChange: (evenement: { changedTables: string[] }) => void | Promise<void> },
    options?: { readonly tables?: readonly string[] },
  ): () => void;
}

/** Événement saisi : la porte complète id (UUID v7), ferme, horodatage et auteur. */
export type SaisieEvenement = Evenement extends infer E
  ? E extends Evenement
    ? Omit<E, 'id' | 'fermeId' | 'horodatage' | 'auteurId'>
    : never
  : never;

export interface OptionsPorte {
  readonly utilisateurId: Id<'Utilisateur'>;
  readonly fermeId: Id<'Ferme'>;
  /** Horloge ; par défaut () => new Date(). */
  readonly maintenant?: () => Date;
  /** Générateur d'UUID v7 ; par défaut celui de @planif/core sur l'horloge et crypto.getRandomValues. */
  readonly nouvelId?: GenerateurId;
}

export interface RequeteSurveillee<T = unknown> {
  readonly sql: string;
  readonly parametres?: readonly unknown[];
  /** Tables dont un changement relance la requête. */
  readonly tables: readonly string[];
  /** Conversion de chaque ligne lue ; sans elle, la ligne est rendue telle quelle (comme getAll<T>). */
  readonly convertir?: (ligne: Readonly<Record<string, unknown>>) => T;
}

/** Refus d'une écriture par le serveur, redescendu par la synchro (table `refus_synchro`). */
export interface RefusSynchro {
  readonly id: string;
  readonly nomTable: string;
  readonly ligneId: string;
  readonly operation: 'PUT' | 'PATCH' | 'DELETE';
  /** Code stable : 'ferme_interdite', 'ajout_seul', 'auteur_invalide', 'table_interdite', 'ecriture_invalide'. */
  readonly motif: string;
  /** Explication en français, affichée telle quelle sur le téléphone. */
  readonly message: string;
  /** Instant ISO du refus. */
  readonly creeLe: string;
}

export interface PorteDonnees {
  /** Lecture SQL libre (jointures comprises) sur la base locale. */
  lire<T>(sql: string, parametres?: readonly unknown[]): Promise<T[]>;
  /** Écriture SQL brute, dans une transaction locale ; part dans la file d'envoi. */
  ecrire(sql: string, parametres?: readonly unknown[]): Promise<void>;
  /**
   * Appelle `rappel` avec le résultat tout de suite, puis après chaque écriture validée sur l'une
   * des `tables` (écriture locale ou arrivée par la synchro). Rend la fonction de désabonnement.
   */
  surveiller<T>(requete: RequeteSurveillee<T>, rappel: (lignes: T[]) => void): () => void;
  /** Écrit l'événement dans la base locale et rend son id. Aucun réseau. */
  saisirEvenement(saisie: SaisieEvenement): Promise<Id<'Evenement'>>;
  /** Refus de l'utilisateur de la porte, du plus récent au plus ancien ; même contrat que `surveiller`. */
  surveillerRefus(rappel: (refus: RefusSynchro[]) => void): () => void;
}

/** Écriture en attente, telle que la donne PowerSync (`CrudEntry`). */
export interface EcritureCrud {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly opData?: Record<string, unknown>;
}

/** Transaction en attente (`CrudTransaction`) : `complete()` la retire de la file. */
export interface TransactionCrud {
  readonly crud: readonly EcritureCrud[];
  complete(): Promise<void>;
}

/** Sous-ensemble de la base PowerSync lu par l'envoi. */
export interface FileEcritures {
  getNextCrudTransaction(): Promise<TransactionCrud | null>;
}

export interface OptionsEnvoi {
  /** URL de l'API, sans / final (ex. 'https://api.planif.test'). */
  readonly urlApi: string;
  readonly fetch: typeof fetch;
  /** Jeton d'accès à jour (renouvelé par l'appelant si besoin). */
  readonly jetonAcces: () => Promise<string>;
}

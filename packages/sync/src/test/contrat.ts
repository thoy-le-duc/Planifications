/**
 * Contrat de `@planif/sync` (T10) : l'API publique que les tests attendent de `src/index.ts`.
 *
 * Le module est chargé dynamiquement (`chargerSync`) : tant qu'il n'existe pas, les tests
 * échouent sur « module introuvable » au lieu de casser le typage de tout le dépôt. Une fois le
 * module écrit, il doit satisfaire ces types ; `index.ts` peut réexporter ses propres types,
 * du moment qu'ils sont compatibles.
 *
 * ── Rôle ────────────────────────────────────────────────────────────────────────────────────
 *
 * Seule porte d'accès aux données pour l'appli web : aucun écran n'importe PowerSync.
 * La porte ne connaît de PowerSync que le sous-ensemble `BaseLocale` ci-dessous, que
 * `PowerSyncDatabase` (@powersync/web) satisfait ; les tests la font tourner sur un SQLite en
 * mémoire (test/base-memoire.ts).
 *
 * ── Format des lignes locales ───────────────────────────────────────────────────────────────
 *
 * Mêmes noms de tables et de colonnes que Postgres (snake_case), puisque ce sont les lignes que
 * PowerSync réplique. Valeurs telles que SQLite les stocke : texte, nombre ou null.
 *   - dates calendaires : 'AAAA-MM-JJ' ;
 *   - instants : ISO 8601 UTC, `new Date(ms).toISOString()` ('2026-10-01T06:00:00.000Z') ;
 *   - jsonb (`detail`) et tableaux (`emplacement_ids`, `photos`) : texte JSON.
 * C'est aussi le format des `donnees` envoyées à POST /sync/upload.
 */
import type { Evenement, GenerateurId, Id } from '@planif/core';

// ── Base locale ──────────────────────────────────────────────────────────────────────────────

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

/** Description minimale du schéma local (un `Schema` de PowerSync la satisfait). */
export interface DescriptionSchemaLocal {
  readonly tables: readonly { readonly name: string; readonly columns: readonly { readonly name: string }[] }[];
}

// ── Porte ────────────────────────────────────────────────────────────────────────────────────

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

export interface RequeteSurveillee {
  readonly sql: string;
  readonly parametres?: readonly unknown[];
  /** Tables dont un changement relance la requête. */
  readonly tables: readonly string[];
}

/** Refus d'une écriture par le serveur, redescendu par la synchro (table `refus_synchro`). */
export interface RefusSynchro {
  readonly id: string;
  readonly nomTable: string;
  readonly ligneId: string;
  readonly operation: 'PUT' | 'PATCH' | 'DELETE';
  /** Code stable : 'ferme_interdite', 'ajout_seul', 'auteur_invalide', 'table_interdite', 'ecriture_invalide'… */
  readonly motif: string;
  /** Explication en français, affichée telle quelle sur le téléphone. */
  readonly message: string;
  /** Instant ISO du refus. */
  readonly creeLe: string;
  /**
   * T10k : résumé de la saisie refusée, calculé par le serveur (colonnes saisie_* de
   * refus_synchro). ABSENT (ou undefined) quand les cinq colonnes sont nulles : un refus sans
   * résumé garde exactement la forme d'avant.
   */
  readonly saisie?: ResumeSaisie;
}

/** T10k : ce qui avait été saisi, tel que le serveur l'a résumé (chaque champ peut manquer). */
export interface ResumeSaisie {
  /** Type d'événement : 'realise', 'recolte', 'intervention', 'irrigation', 'traitement', 'observation'. */
  readonly type: string | null;
  /** « Espèce » ou « Espèce Variété », de la ferme de l'utilisateur. */
  readonly culture: string | null;
  /** Jour de la saisie, AAAA-MM-JJ. */
  readonly date: string | null;
  /** Récolte : quantité et unité ('kg', 'botte', 'piece', 'barquette'). */
  readonly quantite: number | null;
  readonly unite: string | null;
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
  // Le type des lignes est choisi par l'appelant, comme getAll<T> de PowerSync.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  surveiller<T>(requete: RequeteSurveillee, rappel: (lignes: T[]) => void): () => void;
  /**
   * Écrit l'événement dans la base locale (une ligne `evenement`, dans une transaction) et rend
   * son id. Aucun réseau : l'écran change tout de suite, l'envoi suit au retour du réseau.
   */
  saisirEvenement(saisie: SaisieEvenement): Promise<Id<'Evenement'>>;
  /** Refus de l'utilisateur de la porte, du plus récent au plus ancien ; même contrat que `surveiller`. */
  surveillerRefus(rappel: (refus: RefusSynchro[]) => void): () => void;
}

// ── Envoi des écritures (uploadData du connecteur PowerSync) ─────────────────────────────────

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
  /** Jeton d'accès à jour (la porte le renouvelle si besoin). */
  readonly jetonAcces: () => Promise<string>;
  /**
   * Relecture T10 (C3) : oublie le jeton en cours ; le prochain `jetonAcces()` doit en demander
   * un neuf au serveur (/auth/renouveler), même si l'horloge locale le croit encore valide
   * (téléphone en retard). Appelée par l'envoi quand /sync/upload répond 401.
   */
  readonly invaliderJeton: () => void;
}

// ── Module ───────────────────────────────────────────────────────────────────────────────────

export interface ModuleSync {
  /** Schéma local (un `Schema` de PowerSync) : au moins les tables `evenement` et `refus_synchro`. */
  readonly SCHEMA_LOCAL: DescriptionSchemaLocal;
  creerPorte(base: BaseLocale, options: OptionsPorte): PorteDonnees;
  /**
   * Vide la file : pour chaque transaction en attente, dans l'ordre, un POST {urlApi}/sync/upload
   * (`Authorization: Bearer <jeton>`, corps `{ ecritures: [{ op, table, id, donnees? }] }`,
   * `donnees` = `opData`, absent pour DELETE). 200 → `complete()` puis transaction suivante,
   * jusqu'à `null`. Toute autre réponse, ou une panne réseau → lève une erreur SANS `complete()` :
   * PowerSync réessaiera. Le refus métier n'est jamais une erreur ici (il arrive en 200).
   *
   * Relecture T10 (C3) — 401 : `invaliderJeton()`, puis `jetonAcces()` (jeton neuf) et UN seul
   * nouvel essai de la même transaction. Deuxième 401 → lève `SessionExpiree` (sans
   * `complete()`). Si `jetonAcces()` lève `SessionExpiree` (renouvellement refusé), elle remonte
   * telle quelle.
   */
  envoyerEcritures(file: FileEcritures, options: OptionsEnvoi): Promise<void>;
  /**
   * Relecture T10 (C3) : erreur « session expirée, reconnexion nécessaire » (name
   * 'SessionExpiree'). C'est LA classe de l'appli : apps/web/src/donnees/jeton.ts la réexporte
   * (même constructeur), pour qu'un seul `instanceof` suffise partout.
   */
  readonly SessionExpiree: new () => Error;
}

/** Chemin tenu dans une variable : TypeScript ne résout pas le module avant qu'il existe. */
const CHEMIN_MODULE = '../index.ts';

export async function chargerSync(): Promise<ModuleSync> {
  return (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleSync;
}

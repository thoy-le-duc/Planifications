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
  /** Code stable : 'ferme_interdite', 'ajout_seul', 'auteur_invalide', 'table_interdite', 'ecriture_invalide', 'lot_trop_gros', 'recolte_annulee'. */
  readonly motif: string;
  /** Explication en français, affichée telle quelle sur le téléphone. */
  readonly message: string;
  /** Instant ISO du refus. */
  readonly creeLe: string;
  /**
   * T10k : résumé de la saisie refusée, calculé par le serveur (colonnes saisie_* de
   * refus_synchro). Absent quand les cinq colonnes sont nulles (serveur d'avant T10k, écriture
   * illisible, autre table que le journal) : le refus garde alors exactement la forme d'avant.
   */
  readonly saisie?: ResumeSaisie;
}

/** T10k : ce qui avait été saisi, tel que le serveur l'a résumé (chaque champ peut manquer). */
export interface ResumeSaisie {
  /** Type d'événement : 'realise', 'recolte', 'intervention', 'irrigation', 'traitement', 'observation'. */
  readonly type: string | null;
  /** « Espèce » ou « Espèce Variété », de la ferme de l'événement. */
  readonly culture: string | null;
  /** Jour de la saisie, AAAA-MM-JJ. */
  readonly date: string | null;
  /** Récolte : quantité et unité ('kg', 'botte', 'piece', 'barquette'). */
  readonly quantite: number | null;
  readonly unite: string | null;
}

/** Ligne `evenement` telle que la porte l'écrit (colonnes du schéma local, sans `cree_le`). */
export type LigneEvenementLocale = Readonly<Record<
  | 'id'
  | 'ferme_id'
  | 'type'
  | 'date'
  | 'horodatage'
  | 'auteur_id'
  | 'source'
  | 'serie_id'
  | 'campagne_id'
  | 'emplacement_ids'
  | 'note'
  | 'photos'
  | 'remplace_sorte'
  | 'remplace_evenement_id'
  | 'detail',
  string | null
>>;

/** Événement préparé par `preparerSaisie`, pas encore écrit. */
export interface EvenementPrepare {
  readonly id: Id<'Evenement'>;
  readonly ligne: LigneEvenementLocale;
  readonly ordre: OrdreEcriture;
  /**
   * T13j : vérification « déjà fait » à passer à `ecrireEnsemble` avec `ordre`, présente pour un
   * « Fait » : réalisé NOUVEAU sur une culture, ou intervention NOUVELLE qui solde un travail
   * prévu (`occurrenceVisee` non nulle). Absente pour tout le reste (récolte, intervention libre,
   * correction, annulation…). `ecrireEnsemble` refuse un « Fait » préparé écrit sans vérificateur.
   */
  readonly verification?: VerificationEcriture;
}

/**
 * T13h : vérification lancée DANS la transaction d'écriture, avant le premier ordre : elle lit la
 * base telle que la transaction la voit (aucune autre écriture ne peut s'intercaler) et lève une
 * erreur pour ne rien écrire.
 */
export type VerificationEcriture = (lire: <T>(sql: string, parametres?: readonly unknown[]) => Promise<T[]>) => Promise<void>;

/** Ordre SQL d'écriture (paramètres `?`), pour `ecrireEnsemble`. */
export interface OrdreEcriture {
  readonly sql: string;
  readonly parametres?: readonly unknown[];
}

/** Point du repère local (mètres : x vers l'est, y vers le nord). */
export interface PointPlacement {
  readonly x: number;
  readonly y: number;
}

/**
 * T28s : colonnes d'un bâtiment données à `placer` (format local, snake_case). Création : toutes
 * sauf `zone_id` et `supprime_le` ; modification : celles qui changent.
 */
export interface ValeursBatiment {
  readonly nom?: string;
  readonly type?: 'serre_tunnel' | 'serre_chapelle' | 'hangar' | 'magasin' | 'autre';
  readonly longueur_m?: number;
  readonly largeur_m?: number;
  readonly hauteur_m?: number;
  readonly centre_x_m?: number;
  readonly centre_y_m?: number;
  readonly orientation_deg?: number;
  readonly zone_id?: string | null;
  /** Instant ISO UTC de la suppression douce, ou null pour rétablir. */
  readonly supprime_le?: string | null;
}

/**
 * T28s : un changement du placement réel (Q31), écrit par `placer`. Bâtiment créé ou modifié ;
 * contour d'une zone (null efface) ; placement d'un emplacement dans le repère de sa zone (null :
 * rangement automatique) ; origine du plan de la ferme de la porte (null efface).
 */
export type ChangementPlacement =
  | { readonly sorte: 'batiment'; readonly id: string; readonly valeurs: ValeursBatiment }
  | { readonly sorte: 'zone'; readonly id: string; readonly contour: readonly PointPlacement[] | null }
  | {
      readonly sorte: 'emplacement';
      readonly id: string;
      readonly placement: { readonly x: number; readonly y: number; readonly orientation_deg: number } | null;
    }
  | { readonly sorte: 'origine'; readonly origine: { readonly latitude: number; readonly longitude: number } | null };

export interface PorteDonnees {
  /** Lecture SQL libre (jointures comprises) sur la base locale. */
  lire<T>(sql: string, parametres?: readonly unknown[]): Promise<T[]>;
  /** Écriture SQL brute, dans une transaction locale ; part dans la file d'envoi. */
  ecrire(sql: string, parametres?: readonly unknown[]): Promise<void>;
  /**
   * T10c : écrit plusieurs lignes en UNE transaction locale (une saisie = un seul envoi au
   * serveur, accepté ou refusé en entier). Ordres exécutés dans l'ordre ; un ordre qui échoue
   * rejette la promesse et rien n'est écrit. Liste vide : aucune transaction. Les requêtes
   * surveillées sont prévenues une fois l'ensemble validé.
   *
   * T13h : `verifier`, s'il est donné, tourne dans la même transaction avant les ordres ; s'il
   * lève une erreur, la promesse est rejetée avec elle et rien n'est écrit (écriture
   * conditionnelle : « n'écrire que si… », sûre même entre deux onglets sur la même base).
   *
   * T13j : sans `verifier`, un ensemble qui contient l'ordre d'un « Fait » préparé par
   * `preparerSaisie` (celui qui rend `verification`) est refusé, rien n'est écrit.
   */
  ecrireEnsemble(ordres: readonly OrdreEcriture[], verifier?: VerificationEcriture): Promise<void>;
  /**
   * Appelle `rappel` avec le résultat tout de suite, puis après chaque écriture validée sur l'une
   * des `tables` (écriture locale ou arrivée par la synchro). Rend la fonction de désabonnement.
   */
  surveiller<T>(requete: RequeteSurveillee<T>, rappel: (lignes: T[]) => void): () => void;
  /** Écrit l'événement dans la base locale et rend son id. Aucun réseau. */
  saisirEvenement(saisie: SaisieEvenement): Promise<Id<'Evenement'>>;
  /**
   * T13 : prépare l'événement sans l'écrire, complété comme par `saisirEvenement` (id UUID v7,
   * ferme, horodatage, auteur), pour l'écrire avec d'autres lignes en une transaction
   * (`ecrireEnsemble` : récolte + mouvement de stock). Rend la ligne (format local, celui que
   * `validerSaisie` lit) et l'ordre SQL qui l'insère. T13j : pour un « Fait », aussi la
   * vérification « déjà fait » (`verification`) à passer à `ecrireEnsemble`.
   */
  preparerSaisie(saisie: SaisieEvenement): EvenementPrepare;
  /**
   * Refus NON archivés de l'utilisateur de la porte, du plus récent au plus ancien ; même contrat
   * que `surveiller`. T10l : un refus archivé ici ou sur un autre téléphone sort de la liste.
   */
  surveillerRefus(rappel: (refus: RefusSynchro[]) => void): () => void;
  /**
   * T10l : archive les refus `ids` de l'utilisateur de la porte (archive_le = maintenant, rien
   * d'autre ne change, la ligne reste). Id inconnu, d'autrui ou déjà archivé (première date
   * gardée) : ignoré. Au plus ECRITURES_MAX_PAR_LOT lignes par transaction ; liste vide : aucune.
   */
  archiverRefus(ids: readonly string[]): Promise<void>;
  /**
   * T28s : SEULE écriture du placement réel (bâtiments, contours, placement des emplacements,
   * origine du plan), dans la ferme de la porte. Une transaction locale par appel (un envoi, tout
   * ou rien) ; liste vide : aucune. Rejette sans rien écrire ce que le serveur refuserait :
   * utilisateur qui n'est pas gérant actif de la ferme, règles du cœur (validerPlacement,
   * validerContour), ligne d'une autre ferme ou introuvable, zone abritée et contour, origine
   * figée. Rend l'annulation : les changements qui remettent les valeurs d'avant, dans l'ordre
   * inverse (annuler une création = suppression douce) ; `placer(annulation)` annule.
   */
  placer(changements: readonly ChangementPlacement[]): Promise<readonly ChangementPlacement[]>;
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
  /**
   * Oublie le jeton en cours : le prochain `jetonAcces()` en demande un neuf au serveur, même
   * si l'horloge locale le croit encore valide. Appelée quand /sync/upload répond 401.
   */
  readonly invaliderJeton: () => void;
}

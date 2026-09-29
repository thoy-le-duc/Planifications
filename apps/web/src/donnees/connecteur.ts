/**
 * Connecteur PowerSync de l'appli (T10) : donne au service PowerSync le jeton d'accès de l'API
 * (renouvelé quand il expire) et envoie la file d'écritures à POST /sync/upload par
 * @planif/sync. Avec ouvrir.ts, c'est le seul code de l'appli qui touche PowerSync ; ce module
 * n'en importe que des types (il se teste sous Node, sans navigateur).
 *
 * `brancherSynchro` branche le connecteur sur la base et suit l'état de la synchro. Session
 * expirée ou révoquée (renouvellement refusé) : l'état passe à 'session-expiree' et y reste, la
 * base est déconnectée (plus d'appel en boucle à /auth/renouveler), les écritures restent dans
 * la file locale et partiront après reconnexion.
 */
import type { CommonPowerSyncDatabase, PowerSyncBackendConnector, PowerSyncCredentials, SyncOptions, SyncStatus } from '@powersync/web';
import { envoyerEcritures, SessionExpiree, type FileEcritures } from '@planif/sync';
import type { GestionJetons } from './jeton.ts';

/** État de la synchro montré à l'écran. */
export type EtatSynchro = 'connexion' | 'synchronise' | 'hors-ligne' | 'session-expiree';

type StatutSynchro = Pick<SyncStatus, 'connected' | 'hasSynced'>;

export function etatDepuisStatut(statut: StatutSynchro, enLigne: boolean): Exclude<EtatSynchro, 'session-expiree'> {
  if (!enLigne) return 'hors-ligne';
  if (statut.connected && statut.hasSynced === true) return 'synchronise';
  return statut.hasSynced === true ? 'hors-ligne' : 'connexion';
}

export interface OptionsConnecteur {
  readonly urlApi: string;
  readonly urlPowerSync: string;
  readonly jetons: GestionJetons;
  readonly fetch: typeof fetch;
}

/** Délai entre deux essais (connexion au service, envoi de la file) après une erreur : celui du SDK. */
export const DELAI_ESSAI_MS = 5_000;

/**
 * Connecteur complet : `invalidateCredentials` est appelé par les versions de PowerSync qui
 * le connaissent quand le service refuse le jeton (401) ; @powersync/common 2.3.0 ne le déclare
 * pas encore, d'où l'intersection.
 */
export type ConnecteurPlanif = PowerSyncBackendConnector & {
  /** Le service a refusé le jeton : le prochain `fetchCredentials()` le renouvelle. */
  invalidateCredentials(): void;
};

export function creerConnecteur(o: OptionsConnecteur): ConnecteurPlanif {
  const jetonAcces = () => o.jetons.jetonValide();
  const invaliderJeton = () => {
    o.jetons.invalider();
  };
  return {
    async fetchCredentials(): Promise<PowerSyncCredentials> {
      return { endpoint: o.urlPowerSync, token: await jetonAcces() };
    },
    async uploadData(base: CommonPowerSyncDatabase): Promise<void> {
      await envoyerEcritures(base, { urlApi: o.urlApi, fetch: o.fetch, jetonAcces, invaliderJeton });
    },
    invalidateCredentials: invaliderJeton,
  };
}

/** Sous-ensemble de PowerSyncDatabase utilisé par brancherSynchro. */
export interface BaseSynchronisable extends FileEcritures {
  connect(connecteur: PowerSyncBackendConnector, options?: SyncOptions): Promise<void>;
  disconnect(): Promise<void>;
  readonly currentStatus: StatutSynchro;
  registerListener(ecouteur: { statusChanged?: (statut: SyncStatus) => void }): () => void;
}

export interface OptionsBranchement extends OptionsConnecteur {
  /** navigator.onLine dans l'appli. */
  readonly enLigne: () => boolean;
  /** Options de connexion du SDK (méthode…) ; délai entre essais par défaut : DELAI_ESSAI_MS. */
  readonly connexion?: SyncOptions;
}

export interface SynchroBranchee {
  etat(): EtatSynchro;
  /** Appelle `rappel` avec l'état tout de suite, puis à chaque changement ; rend le désabonnement. */
  surveillerEtat(rappel: (etat: EtatSynchro) => void): () => void;
}

export function brancherSynchro(base: BaseSynchronisable, options: OptionsBranchement): SynchroBranchee {
  let expiree = false;
  const abonnes = new Set<(etat: EtatSynchro) => void>();
  const etat = (): EtatSynchro => (expiree ? 'session-expiree' : etatDepuisStatut(base.currentStatus, options.enLigne()));
  const signaler = () => {
    const e = etat();
    for (const rappel of abonnes) rappel(e);
  };

  /** Session expirée : on arrête la synchro, sans attendre (on est peut-être dans un rappel du SDK). */
  function surveillerExpiration<T>(action: () => Promise<T>): Promise<T> {
    return action().catch((erreur: unknown) => {
      if (erreur instanceof SessionExpiree && !expiree) {
        expiree = true;
        signaler();
        void base.disconnect();
      }
      throw erreur;
    });
  }

  const connecteur = creerConnecteur(options);
  const surveille: ConnecteurPlanif = {
    fetchCredentials: () => surveillerExpiration(() => connecteur.fetchCredentials()),
    uploadData: (b) => surveillerExpiration(() => connecteur.uploadData(b)),
    invalidateCredentials: () => {
      connecteur.invalidateCredentials();
    },
  };
  base.registerListener({ statusChanged: signaler });
  void base.connect(surveille, {
    retryDelayMs: DELAI_ESSAI_MS,
    // Une écriture faite au champ part vite quand le réseau est là.
    crudUploadThrottleMs: 200,
    ...options.connexion,
  });

  return {
    etat,
    surveillerEtat(rappel) {
      abonnes.add(rappel);
      rappel(etat());
      return () => {
        abonnes.delete(rappel);
      };
    },
  };
}

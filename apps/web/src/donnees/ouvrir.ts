/**
 * Ouverture de la base locale synchronisée (T10) : PowerSync (wa-sqlite dans un worker), schéma
 * de @planif/sync, connecteur vers l'API et le service PowerSync. Rend la porte de @planif/sync :
 * les écrans ne voient jamais PowerSync.
 *
 * Chargé à la demande (import dynamique) : PowerSync et son WASM restent hors du JavaScript de
 * démarrage de l'appli.
 */
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { PowerSyncDatabase, SyncStreamConnectionMethod, type SyncStatus } from '@powersync/web';
import type { SessionConnexion } from '../connexion/session.ts';
import { creerConnecteur } from './connecteur.ts';
import { gererJetons } from './jeton.ts';

/** État de la synchro montré à l'écran. */
export type EtatSynchro = 'connexion' | 'synchronise' | 'hors-ligne';

export interface OptionsOuverture {
  readonly session: SessionConnexion;
  readonly fermeId: Id<'Ferme'>;
  readonly urlApi: string;
  readonly urlPowerSync: string;
  readonly stockage: Pick<Storage, 'setItem'>;
}

export interface DonneesLocales {
  readonly porte: PorteDonnees;
  /** Appelle `rappel` avec l'état tout de suite, puis à chaque changement ; rend le désabonnement. */
  surveillerEtat(rappel: (etat: EtatSynchro) => void): () => void;
  fermer(): Promise<void>;
}

export function etatDepuisStatut(statut: Pick<SyncStatus, 'connected' | 'hasSynced'>, enLigne: boolean): EtatSynchro {
  if (!enLigne) return 'hors-ligne';
  if (statut.connected && statut.hasSynced === true) return 'synchronise';
  return statut.hasSynced === true ? 'hors-ligne' : 'connexion';
}

export function ouvrirDonnees(o: OptionsOuverture): DonneesLocales {
  const base = new PowerSyncDatabase({
    schema: SCHEMA_LOCAL,
    database: {
      // Une base par utilisateur : deux comptes sur un même téléphone ne se mélangent pas.
      dbFilename: `planif-${o.session.utilisateurId}.sqlite`,
      // Worker dédié plutôt que SharedWorker : c'est le défaut du SDK sur Android et iOS (T07).
      enableMultiTabs: false,
      useWebWorker: true,
    },
  });
  // Appel détaché : window.fetch appelé comme méthode d'un autre objet lèverait « Illegal invocation ».
  const envoyer: typeof fetch = (...args) => fetch(...args);
  const jetons = gererJetons(o.session, { urlApi: o.urlApi, fetch: envoyer, stockage: o.stockage });
  const connecteur = creerConnecteur({ urlApi: o.urlApi, urlPowerSync: o.urlPowerSync, jetons, fetch: envoyer });
  void base.connect(connecteur, {
    connectionMethod: SyncStreamConnectionMethod.HTTP,
    // Au retour du réseau, la file repart vite : c'est ce que le maraîcher attend.
    retryDelayMs: 1000,
    crudUploadThrottleMs: 200,
  });

  const porte = creerPorte(base, { utilisateurId: o.session.utilisateurId as Id<'Utilisateur'>, fermeId: o.fermeId });

  return {
    porte,
    surveillerEtat(rappel) {
      const signaler = () => {
        rappel(etatDepuisStatut(base.currentStatus, navigator.onLine));
      };
      signaler();
      const arreter = base.registerListener({ statusChanged: signaler });
      addEventListener('online', signaler);
      addEventListener('offline', signaler);
      return () => {
        arreter();
        removeEventListener('online', signaler);
        removeEventListener('offline', signaler);
      };
    },
    fermer: () => base.close(),
  };
}

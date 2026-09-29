/**
 * Ouverture de la base locale synchronisée (T10) : PowerSync (wa-sqlite dans un worker), schéma
 * de @planif/sync, connecteur vers l'API et le service PowerSync (brancherSynchro). Rend la
 * porte de @planif/sync : les écrans ne voient jamais PowerSync.
 *
 * Chargé à la demande (import dynamique) : PowerSync et son WASM restent hors du JavaScript de
 * démarrage de l'appli.
 */
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { PowerSyncDatabase, SyncStreamConnectionMethod } from '@powersync/web';
import type { SessionConnexion } from '../connexion/session.ts';
import { brancherSynchro, type EtatSynchro } from './connecteur.ts';
import { gererJetons } from './jeton.ts';

export { etatDepuisStatut, type EtatSynchro } from './connecteur.ts';

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
  const synchro = brancherSynchro(base, {
    urlApi: o.urlApi,
    urlPowerSync: o.urlPowerSync,
    jetons,
    fetch: envoyer,
    enLigne: () => navigator.onLine,
    connexion: { connectionMethod: SyncStreamConnectionMethod.HTTP },
  });

  const porte = creerPorte(base, { utilisateurId: o.session.utilisateurId as Id<'Utilisateur'>, fermeId: o.fermeId });

  return {
    porte,
    surveillerEtat(rappel) {
      const arreter = synchro.surveillerEtat(rappel);
      // Le réseau change avant que le statut de PowerSync ne bouge.
      const signaler = () => {
        rappel(synchro.etat());
      };
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

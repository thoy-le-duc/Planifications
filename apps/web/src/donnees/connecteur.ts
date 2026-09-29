/**
 * Connecteur PowerSync de l'appli (T10) : donne au service PowerSync le jeton d'accès de l'API
 * (renouvelé quand il expire) et envoie la file d'écritures à POST /sync/upload par
 * @planif/sync. Avec ouvrir.ts, c'est le seul code de l'appli qui touche PowerSync.
 */
import type { CommonPowerSyncDatabase, PowerSyncBackendConnector, PowerSyncCredentials } from '@powersync/web';
import { envoyerEcritures } from '@planif/sync';
import type { GestionJetons } from './jeton.ts';

export interface OptionsConnecteur {
  readonly urlApi: string;
  readonly urlPowerSync: string;
  readonly jetons: GestionJetons;
  readonly fetch: typeof fetch;
}

export function creerConnecteur(o: OptionsConnecteur): PowerSyncBackendConnector {
  const jetonAcces = () => o.jetons.jetonValide();
  return {
    async fetchCredentials(): Promise<PowerSyncCredentials> {
      return { endpoint: o.urlPowerSync, token: await jetonAcces() };
    },
    async uploadData(base: CommonPowerSyncDatabase): Promise<void> {
      await envoyerEcritures(base, { urlApi: o.urlApi, fetch: o.fetch, jetonAcces });
    },
  };
}

/**
 * Ouverture de la base locale synchronisée (T10) : PowerSync (wa-sqlite dans un worker), schéma
 * de @planif/sync, connecteur vers l'API et le service PowerSync (brancherSynchro). Rend la
 * porte de @planif/sync : les écrans ne voient jamais PowerSync.
 *
 * Chargé à la demande (import dynamique) : PowerSync et son WASM restent hors du JavaScript de
 * démarrage de l'appli.
 *
 * T11 : les briques servent aussi à l'appli (base-appli.ts) et à la page d'amorçage des tests
 * (amorcer.ts) : `ouvrirBaseLocale` (base seule, sans synchro), `synchroniser`,
 * `compterEcrituresEnAttente`.
 */
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL, type PorteDonnees } from '@planif/sync';
import { PowerSyncDatabase, SyncStreamConnectionMethod } from '@powersync/web';
import type { SessionConnexion } from '../connexion/session.ts';
import { brancherSynchro, type EtatSynchro } from './connecteur.ts';
import { nomBaseLocale } from './effacer.ts';
import { gererJetons } from './jeton.ts';

export { etatDepuisStatut, type EtatSynchro } from './connecteur.ts';
export { effacerDonneesLocales } from './effacer.ts';

/**
 * Attente maximale de la fermeture de la base. Une ouverture bloquée (base IndexedDB d'un
 * autre format gardée ouverte par un autre onglet) ne se termine jamais, et PowerSync attend
 * alors indéfiniment dans `close()` : la déconnexion ne doit pas rester suspendue pour autant.
 * appli.ts n'ouvre pas une telle base (voir `formatBaseLocale`).
 */
export const DELAI_FERMETURE_MS = 2_000;

export interface BaseOuverte {
  readonly base: PowerSyncDatabase;
  /** Ferme la base, sans attendre plus de DELAI_FERMETURE_MS. Ne rejette jamais. */
  readonly fermer: () => Promise<void>;
}

/** Base locale de l'utilisateur, sans synchro (rien n'est envoyé tant que `synchroniser` n'est pas appelé). */
export function ouvrirBaseLocale(utilisateurId: string): BaseOuverte {
  const base = new PowerSyncDatabase({
    schema: SCHEMA_LOCAL,
    database: {
      // Une base par utilisateur : deux comptes sur un même téléphone ne se mélangent pas.
      dbFilename: nomBaseLocale(utilisateurId),
      // Worker dédié plutôt que SharedWorker : c'est le défaut du SDK sur Android et iOS (T07).
      enableMultiTabs: false,
      useWebWorker: true,
    },
  });
  let fermeture: Promise<void> | null = null;
  return {
    base,
    fermer: () =>
      (fermeture ??= (async () => {
        let minuterie: ReturnType<typeof setTimeout> | undefined;
        const delai = new Promise<void>((fin) => {
          minuterie = setTimeout(fin, DELAI_FERMETURE_MS);
        });
        try {
          await Promise.race([
            base.close().catch((erreur: unknown) => {
              console.error('Fermeture de la base locale', erreur);
            }),
            delai,
          ]);
        } finally {
          clearTimeout(minuterie);
        }
      })()),
  };
}

export interface OptionsSynchro {
  readonly session: SessionConnexion;
  readonly urlApi: string;
  readonly urlPowerSync: string;
  readonly stockage: Pick<Storage, 'getItem' | 'setItem'>;
}

export interface Synchro {
  /** Appelle `rappel` avec l'état tout de suite, puis à chaque changement ; rend le désabonnement. */
  surveillerEtat(rappel: (etat: EtatSynchro) => void): () => void;
}

/** Branche la synchro de la base (API et service PowerSync, jetons renouvelés). */
export function synchroniser(base: PowerSyncDatabase, o: OptionsSynchro): Synchro {
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
  return {
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
  };
}

/**
 * Nombre de saisies (transactions locales) encore dans la file d'envoi de PowerSync (T09b) : une
 * ligne par écriture, regroupées par transaction (tx_id).
 */
export async function compterEcrituresEnAttente(base: Pick<PowerSyncDatabase, 'get'>): Promise<number> {
  const ligne = await base.get<{ n: number }>(
    'SELECT (SELECT count(DISTINCT tx_id) FROM ps_crud) + (SELECT count(*) FROM ps_crud WHERE tx_id IS NULL) AS n',
  );
  return ligne.n;
}

export interface OptionsOuverture extends OptionsSynchro {
  readonly fermeId: Id<'Ferme'>;
}

export interface DonneesLocales {
  readonly porte: PorteDonnees;
  /** Appelle `rappel` avec l'état tout de suite, puis à chaque changement ; rend le désabonnement. */
  surveillerEtat(rappel: (etat: EtatSynchro) => void): () => void;
  fermer(): Promise<void>;
  /**
   * Déconnexion (T09b) : arrête la synchro, efface toutes les tables locales et la file
   * d'écritures en attente, puis ferme la base.
   */
  effacer(): Promise<void>;
  /**
   * Nombre de saisies (transactions locales) encore dans la file d'envoi (T09b) : la déconnexion
   * demande confirmation avant de les perdre.
   */
  ecrituresEnAttente(): Promise<number>;
}

/** Base locale synchronisée sur une ferme donnée (page de diagnostic de T10). */
export function ouvrirDonnees(o: OptionsOuverture): DonneesLocales {
  const { base, fermer } = ouvrirBaseLocale(o.session.utilisateurId);
  const synchro = synchroniser(base, o);
  const porte = creerPorte(base, { utilisateurId: o.session.utilisateurId as Id<'Utilisateur'>, fermeId: o.fermeId });
  return {
    porte,
    surveillerEtat: (rappel) => synchro.surveillerEtat(rappel),
    fermer,
    ecrituresEnAttente: () => compterEcrituresEnAttente(base),
    async effacer() {
      await base.disconnectAndClear({ clearLocal: true, soft: false });
      await fermer();
    },
  };
}

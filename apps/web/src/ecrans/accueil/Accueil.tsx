/**
 * Sans session (T16, chargé à la demande par App) : la carte de connexion, et la reprise des
 * effacements restés en attente (T09b). Utile une fois par téléphone : hors du JavaScript de
 * démarrage. Pose la marque de premier affichage quand la carte est là.
 */
import { useEffect, useState } from 'react';
import { creerClientConnexion, urlApi } from '../../connexion/client.ts';
import {
  MESSAGE_EFFACEMENT_EN_ATTENTE,
  effacementsEnAttente,
  reprendreEffacements,
  retirerEffacementEnAttente,
} from '../../connexion/deconnexion.ts';
import { EcranConnexion } from '../../connexion/EcranConnexion.tsx';
import { enregistrerSession, stockageNavigateur, type SessionConnexion } from '../../connexion/session.ts';
import { effacerDonneesLocales } from '../../donnees/effacer.ts';
import { marquerAppPrete } from '../../perf.ts';
import { AlerteOrange } from '../../ui/elements.tsx';

// Appel détaché : fetch ne doit pas être invoqué comme méthode d'un autre objet.
const envoyer: typeof fetch = (entree, init) => fetch(entree, init);
const clientConnexion = creerClientConnexion({ baseUrl: urlApi(), fetch: envoyer });

/** Intervalle entre deux essais d'un effacement resté en attente. */
const INTERVALLE_REPRISE_MS = 5_000;

export interface ProprietesAccueil {
  /** Échec de la dernière déconnexion. */
  readonly erreur: string | null;
  readonly surConnexion: (session: SessionConnexion) => void;
}

export default function Accueil({ erreur, surConnexion }: ProprietesAccueil) {
  /** Bases locales qui restent à effacer (base ouverte dans un autre onglet). */
  const [enAttente, setEnAttente] = useState<readonly string[]>(() => effacementsEnAttente(stockageNavigateur()));

  useEffect(() => {
    marquerAppPrete();
  }, []);

  // Effacement resté en attente : repris sur l'écran de connexion (au démarrage sans session,
  // après une déconnexion) toutes les 5 s jusqu'à réussite (l'autre onglet fermé, la base
  // disparaît sans rien toucher). Jamais une fois connecté (2e relecture sécurité, B2) : cet
  // écran n'existe que sans session.
  useEffect(() => {
    let actif = true;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    async function essayer(): Promise<void> {
      // Effacement sans PowerSync (quelques lignes) : hors ligne, ses fichiers ne sont pas en cache.
      const restants = await reprendreEffacements({ stockage: stockageNavigateur(), effacerBaseLocale: effacerDonneesLocales });
      if (!actif) return;
      setEnAttente(restants);
      if (restants.length > 0) {
        minuterie = setTimeout(() => void essayer(), INTERVALLE_REPRISE_MS);
      }
    }
    if (effacementsEnAttente(stockageNavigateur()).length > 0) void essayer();
    return () => {
      actif = false;
      clearTimeout(minuterie);
    };
  }, []);

  return (
    <EcranConnexion
      client={clientConnexion}
      surConnexion={(nouvelle) => {
        // Effacement de cette base resté en attente (déconnexion avec un autre onglet ouvert) :
        // abandonné, l'utilisateur est de retour (2e relecture sécurité, B2).
        retirerEffacementEnAttente(stockageNavigateur(), nouvelle.utilisateurId);
        enregistrerSession(stockageNavigateur(), nouvelle);
        surConnexion(nouvelle);
      }}
    >
      {erreur !== null && <AlerteOrange>{erreur}</AlerteOrange>}
      {enAttente.length > 0 && <AlerteOrange>{MESSAGE_EFFACEMENT_EN_ATTENTE}</AlerteOrange>}
    </EcranConnexion>
  );
}

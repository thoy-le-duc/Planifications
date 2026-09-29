import { useEffect, useState, type CSSProperties } from 'react';
import { VERSION_MODELE_DONNEES } from '@planif/core';
import {
  EcranConnexion,
  MESSAGE_EFFACEMENT_EN_ATTENTE,
  creerClientConnexion,
  deconnecterAvecConfirmation,
  effacementsEnAttente,
  enregistrerSession,
  lireSession,
  reprendreEffacements,
  retirerEffacementEnAttente,
  stockageNavigateur,
  urlApi,
  type SessionConnexion,
} from './connexion/index.ts';
import { baseLocaleExiste, effacerDonneesLocales } from './donnees/effacer.ts';
import { MARQUE_APP_PRETE } from './perf.ts';

// Appel détaché : fetch ne doit pas être invoqué comme méthode d'un autre objet.
const envoyer: typeof fetch = (entree, init) => fetch(entree, init);
const clientConnexion = creerClientConnexion({ baseUrl: urlApi(), fetch: envoyer });

/** Cible de 56 px, comme l'écran de connexion (gants). */
const BOUTON_DECONNEXION: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 56,
  minWidth: 56,
  fontSize: 18,
  padding: '0 16px',
  borderRadius: 10,
  border: '2px solid #2f6b3a',
  background: 'transparent',
  color: '#2f6b3a',
  fontWeight: 600,
};

/** Boutons de la confirmation : 48 px au moins (gants). */
const BOUTON_CONFIRMATION: CSSProperties = { ...BOUTON_DECONNEXION, marginRight: 8, marginTop: 8 };
const BOUTON_CONFIRMATION_PRINCIPAL: CSSProperties = { ...BOUTON_CONFIRMATION, background: '#2f6b3a', color: '#fff' };

/** Confirmation en attente de réponse : son message, et de quoi y répondre. */
interface Confirmation {
  readonly message: string;
  readonly repondre: (quandMeme: boolean) => void;
}

/**
 * Effacement de la base locale sans PowerSync (quelques lignes, importées directement) :
 * PowerSync reste hors du JavaScript de démarrage, et hors ligne ses fichiers ne sont pas en
 * cache. Un import dynamique ferait charger le point d'entrée de l'appli par la page de
 * diagnostic (aide d'espace de noms rangée dans index-*.js par le bundler).
 */
const effacerBaseLocale = effacerDonneesLocales;

/** Écran de connexion : intervalle entre deux essais d'un effacement resté en attente. */
const INTERVALLE_REPRISE_MS = 5_000;

export function App() {
  // Session gardée sur le téléphone : lue une fois, sans réseau.
  const [session, setSession] = useState<SessionConnexion | null>(() => lireSession(stockageNavigateur()));
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  /** Bases locales qui restent à effacer (base ouverte dans un autre onglet). */
  const [enAttente, setEnAttente] = useState<readonly string[]>(() => effacementsEnAttente(stockageNavigateur()));
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const connecte = session !== null;

  /** Montre la confirmation ; résout à la réponse (vrai : se déconnecter quand même). */
  function confirmer(message: string): Promise<boolean> {
    return new Promise((resoudre) => {
      setConfirmation({
        message,
        repondre: (quandMeme) => {
          setConfirmation(null);
          resoudre(quandMeme);
        },
      });
    });
  }

  async function seDeconnecter(courante: SessionConnexion): Promise<void> {
    if (deconnexionEnCours) return;
    setDeconnexionEnCours(true);
    setErreur(null);
    try {
      // Sans ouvrir PowerSync, on ne sait pas compter la file d'envoi : si la base locale existe,
      // confirmation générique d'abord (null) ; sans base, rien à perdre (0).
      const issue = await deconnecterAvecConfirmation(courante, {
        urlApi: urlApi(),
        fetch: envoyer,
        stockage: stockageNavigateur(),
        effacerBaseLocale,
        compterEnAttente: async () => ((await baseLocaleExiste(courante.utilisateurId)) ? null : 0),
        confirmer,
      });
      if (issue === 'annule') {
        setDeconnexionEnCours(false);
        return;
      }
    } catch (e) {
      // La session est effacée quand même : on revient à la connexion, en le disant. Effacement
      // noté en attente : repris tout seul (voir plus bas), le message dit quoi faire.
      const attente = effacementsEnAttente(stockageNavigateur());
      setEnAttente(attente);
      if (!attente.includes(courante.utilisateurId)) {
        setErreur(`Données de ce téléphone non effacées : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setDeconnexionEnCours(false);
    setSession(null);
  }

  useEffect(() => {
    performance.mark(MARQUE_APP_PRETE);
  }, []);

  // Effacement resté en attente : repris sur l'écran de connexion (au démarrage sans session,
  // après une déconnexion) toutes les 5 s jusqu'à réussite (l'autre onglet fermé, la base
  // disparaît sans rien toucher). Jamais une fois connecté (2e relecture sécurité, B2).
  useEffect(() => {
    if (connecte) return undefined;
    let actif = true;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    async function essayer(): Promise<void> {
      const restants = await reprendreEffacements({ stockage: stockageNavigateur(), effacerBaseLocale });
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
  }, [connecte]);

  return (
    <main data-testid="app">
      <h1>Planifications</h1>
      <p>Squelette technique — modèle de données v{VERSION_MODELE_DONNEES}</p>
      {erreur !== null && <p role="alert">{erreur}</p>}
      {enAttente.length > 0 && <p role="alert">{MESSAGE_EFFACEMENT_EN_ATTENTE}</p>}
      {session !== null && (
        <p>
          Connecté : {session.email}{' '}
          <button type="button" style={BOUTON_DECONNEXION} disabled={deconnexionEnCours} onClick={() => void seDeconnecter(session)}>
            Se déconnecter
          </button>
        </p>
      )}
      {confirmation !== null && (
        <div data-testid="confirmation-deconnexion" role="alertdialog" aria-label="Se déconnecter ?">
          <p>{confirmation.message}</p>
          <button type="button" style={BOUTON_CONFIRMATION_PRINCIPAL} onClick={() => {
              confirmation.repondre(true);
            }}>
            Se déconnecter quand même
          </button>
          <button type="button" style={BOUTON_CONFIRMATION} onClick={() => {
              confirmation.repondre(false);
            }}>
            Annuler
          </button>
        </div>
      )}
      {session === null && (
        <EcranConnexion
          client={clientConnexion}
          surConnexion={(nouvelle) => {
            // Effacement de cette base resté en attente (déconnexion avec un autre onglet ouvert) :
            // abandonné, l'utilisateur est de retour (2e relecture sécurité, B2).
            retirerEffacementEnAttente(stockageNavigateur(), nouvelle.utilisateurId);
            setEnAttente(effacementsEnAttente(stockageNavigateur()));
            enregistrerSession(stockageNavigateur(), nouvelle);
            setSession(nouvelle);
          }}
        />
      )}
    </main>
  );
}

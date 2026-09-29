import { useEffect, useState, type CSSProperties } from 'react';
import { VERSION_MODELE_DONNEES } from '@planif/core';
import {
  EcranConnexion,
  creerClientConnexion,
  deconnecter,
  enregistrerSession,
  lireSession,
  stockageNavigateur,
  urlApi,
  type SessionConnexion,
} from './connexion/index.ts';
import { effacerDonneesLocales } from './donnees/effacer.ts';
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

/**
 * Effacement de la base locale sans PowerSync (quelques lignes, importées directement) :
 * PowerSync reste hors du JavaScript de démarrage, et hors ligne ses fichiers ne sont pas en
 * cache. Un import dynamique ferait charger le point d'entrée de l'appli par la page de
 * diagnostic (aide d'espace de noms rangée dans index-*.js par le bundler).
 */
const effacerBaseLocale = effacerDonneesLocales;

export function App() {
  // Session gardée sur le téléphone : lue une fois, sans réseau.
  const [session, setSession] = useState<SessionConnexion | null>(() => lireSession(stockageNavigateur()));
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function seDeconnecter(courante: SessionConnexion): Promise<void> {
    if (deconnexionEnCours) return;
    setDeconnexionEnCours(true);
    setErreur(null);
    try {
      await deconnecter(courante, { urlApi: urlApi(), fetch: envoyer, stockage: stockageNavigateur(), effacerBaseLocale });
    } catch (e) {
      // La session est effacée quand même : on revient à la connexion, en le disant.
      setErreur(`Données de ce téléphone non effacées : ${e instanceof Error ? e.message : String(e)}`);
    }
    setDeconnexionEnCours(false);
    setSession(null);
  }

  useEffect(() => {
    performance.mark(MARQUE_APP_PRETE);
  }, []);

  return (
    <main data-testid="app">
      <h1>Planifications</h1>
      <p>Squelette technique — modèle de données v{VERSION_MODELE_DONNEES}</p>
      {erreur !== null && <p role="alert">{erreur}</p>}
      {session !== null && (
        <p>
          Connecté : {session.email}{' '}
          <button type="button" style={BOUTON_DECONNEXION} disabled={deconnexionEnCours} onClick={() => void seDeconnecter(session)}>
            Se déconnecter
          </button>
        </p>
      )}
      {session === null && (
        <EcranConnexion
          client={clientConnexion}
          surConnexion={(nouvelle) => {
            enregistrerSession(stockageNavigateur(), nouvelle);
            setSession(nouvelle);
          }}
        />
      )}
    </main>
  );
}

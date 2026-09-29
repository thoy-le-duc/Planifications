import { useEffect, useState } from 'react';
import { VERSION_MODELE_DONNEES } from '@planif/core';
import {
  EcranConnexion,
  creerClientConnexion,
  enregistrerSession,
  lireSession,
  stockageNavigateur,
  urlApi,
  type SessionConnexion,
} from './connexion/index.ts';
import { MARQUE_APP_PRETE } from './perf.ts';

// Appel détaché : fetch ne doit pas être invoqué comme méthode d'un autre objet.
const clientConnexion = creerClientConnexion({ baseUrl: urlApi(), fetch: (entree, init) => fetch(entree, init) });

export function App() {
  // Session gardée sur le téléphone : lue une fois, sans réseau.
  const [session, setSession] = useState<SessionConnexion | null>(() => lireSession(stockageNavigateur()));

  useEffect(() => {
    performance.mark(MARQUE_APP_PRETE);
  }, []);

  return (
    <main data-testid="app">
      <h1>Planifications</h1>
      <p>Squelette technique — modèle de données v{VERSION_MODELE_DONNEES}</p>
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

import { useEffect } from 'react';
import { VERSION_MODELE_DONNEES } from '@planif/core';
import { MARQUE_APP_PRETE } from './perf.ts';

export function App() {
  useEffect(() => {
    performance.mark(MARQUE_APP_PRETE);
  }, []);

  return (
    <main data-testid="app">
      <h1>Planifications</h1>
      <p>Squelette technique — modèle de données v{VERSION_MODELE_DONNEES}</p>
    </main>
  );
}

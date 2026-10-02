import './jetons.css';
import './ui/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, avantPremierRendu } from './App.tsx';

const racine = document.getElementById('racine');
if (!racine) throw new Error('Élément #racine introuvable');

// T25 : le build de la démo (`vite build --mode demo`) démarre par src/demo/, chargé à la demande.
// Ailleurs, la condition est fausse dès le build : le code de la démo n'y entre pas.
if (import.meta.env.MODE === 'demo') {
  void import('./demo/index.tsx').then((m) => {
    m.demarrerDemo(racine);
  });
} else {
  void avantPremierRendu().then(() => {
    createRoot(racine).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}

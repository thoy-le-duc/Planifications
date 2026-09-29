import './jetons.css';
import './ui/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, avantPremierRendu } from './App.tsx';

const racine = document.getElementById('racine');
if (!racine) throw new Error('Élément #racine introuvable');

void avantPremierRendu().then(() => {
  createRoot(racine).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

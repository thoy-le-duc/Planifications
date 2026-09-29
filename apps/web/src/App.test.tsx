import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App.tsx';

describe('App', () => {
  // T16 : la ligne « Squelette technique — modèle de données v1 » disparaît avec l'habillage
  // (maquette « Connexion ») ; sans session, l'appli montre l'écran de connexion et son titre.
  it('affiche le titre', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Planifications');
  });
});

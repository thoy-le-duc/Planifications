import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App.tsx';

describe('App', () => {
  it('affiche le titre et la version du modèle', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Planifications');
    expect(html).toContain('modèle de données v<!-- -->1');
  });
});

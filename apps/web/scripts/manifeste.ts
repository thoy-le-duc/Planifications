/**
 * Manifeste de l'appli (vite-plugin-pwa, vite.config.ts) : ce qu'il faut pour l'installer sur le
 * téléphone comme une appli (T40). Icônes PNG tirées de public/icone.svg par scripts/icones.ts.
 */
import type { ManifestOptions } from 'vite-plugin-pwa';
import { COULEURS } from '../src/ui/jetons.ts';

export const MANIFESTE: Partial<ManifestOptions> = {
  name: 'Planifications',
  short_name: 'Planif',
  lang: 'fr',
  // T40 : identité de l'appli installée, indépendante d'un futur changement de start_url.
  id: '/',
  scope: '/',
  start_url: '/',
  display: 'standalone',
  background_color: COULEURS.fond,
  theme_color: COULEURS.foret,
  icons: [
    { src: 'icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icone.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
};

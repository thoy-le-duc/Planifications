import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Hors-ligne d'abord : le service worker met toute l'appli en cache dès la première visite.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icone.svg'],
      manifest: {
        name: 'Planifications',
        short_name: 'Planif',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4efe3',
        theme_color: '#2f6b3a',
        icons: [{ src: 'icone.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Pages de mesure (T07) : hors navigation, hors service worker, jamais chargées par l'appli. */
const PREFIXE_PAGES_MESURE = '/mesures/';

/** Code de la base locale (PowerSync, wa-sqlite) : rangé à part pour rester hors du précache. */
const MOTIF_SQLITE = /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(@powersync|@journeyapps)\//;

function nomSortie(dossier: string): string {
  return `assets/${dossier}/[name]-[hash][extname]`;
}

/** Range les morceaux JS : pages de mesure dans `assets/mesures/`, SQLite dans `assets/sqlite/`. */
function nomMorceau(morceau: { name: string; moduleIds: readonly string[] }): string {
  if (morceau.name === 'mesureSqlite') return nomSortie('mesures').replace('[extname]', '.js');
  if (morceau.moduleIds.some((id) => MOTIF_SQLITE.test(id))) return nomSortie('sqlite').replace('[extname]', '.js');
  return 'assets/[name]-[hash].js';
}

/** Le WASM de SQLite rejoint `assets/sqlite/`. */
function nomFichierAnnexe(fichier: { names: readonly string[] }): string {
  return fichier.names.some((n) => n.endsWith('.wasm')) ? nomSortie('sqlite') : 'assets/[name]-[hash][extname]';
}

/**
 * vite-plugin-pwa injecte le manifeste et l'enregistrement du service worker dans chaque page HTML.
 * Sur une page de mesure, l'installation du service worker (précache de l'appli) fausserait les temps :
 * on les retire.
 */
function pagesMesureSansServiceWorker(): Plugin {
  return {
    name: 'planif:pages-mesure-sans-sw',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, contexte) {
        if (!contexte.path.startsWith(PREFIXE_PAGES_MESURE)) return html;
        return html
          .replace(/<link rel="manifest"[^>]*>/g, '')
          .replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g, '');
      },
    },
  };
}

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
      workbox: {
        // Pages de mesure et base locale (PowerSync, workers, WASM) hors du précache : l'installation
        // de l'appli ne s'alourdit pas tant que l'appli ne s'en sert pas (T10).
        globIgnores: ['**/node_modules/**', 'mesures/**', 'assets/mesures/**', 'assets/sqlite/**'],
        navigateFallbackDenylist: [/^\/mesures\//],
      },
    }),
    pagesMesureSansServiceWorker(),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        mesureSqlite: fileURLToPath(new URL('mesures/sqlite.html', import.meta.url)),
      },
      output: {
        entryFileNames: nomMorceau,
        chunkFileNames: nomMorceau,
        assetFileNames: nomFichierAnnexe,
      },
    },
  },
  // PowerSync embarque des workers et du WASM : Vite ne doit pas les pré-empaqueter (doc PowerSync).
  optimizeDeps: { exclude: ['@powersync/web'] },
  worker: {
    format: 'es',
    // Les workers de PowerSync ne servent qu'à la base locale.
    rollupOptions: {
      output: {
        entryFileNames: nomSortie('sqlite').replace('[extname]', '.js'),
        chunkFileNames: nomSortie('sqlite').replace('[extname]', '.js'),
        assetFileNames: nomFichierAnnexe,
      },
    },
  },
  test: {
    environment: 'node',
  },
});

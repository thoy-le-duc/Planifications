import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Pages de mesure (T07) et de diagnostic (T10) : hors navigation, hors service worker, jamais
 * chargées par l'appli.
 */
const PREFIXES_PAGES_HORS_APPLI = ['/mesures/', '/diagnostic/'];

/** Code de la base locale (PowerSync, wa-sqlite) : rangé à part pour rester hors du précache. */
const MOTIF_SQLITE = /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(@powersync|@journeyapps)\//;

const ENTREE_MESURE = 'mesureSqlite';
const ENTREE_DIAGNOSTIC = 'diagnosticSynchro';

function nomSortie(dossier: string): string {
  return `assets/${dossier}/[name]-[hash][extname]`;
}

/**
 * Range les morceaux JS : l'entrée de mesure dans `assets/mesures/`, les morceaux SQLite (hors entrées)
 * dans `assets/sqlite/`. Une entrée n'est jamais classée « SQLite » : si l'appli importe un jour
 * PowerSync (T10), `index-*.js` doit rester dans le précache.
 */
function nomMorceau(morceau: { name: string; isEntry: boolean; moduleIds: readonly string[] }): string {
  if (morceau.isEntry) {
    if (morceau.name === ENTREE_MESURE) return nomSortie('mesures').replace('[extname]', '.js');
    if (morceau.name === ENTREE_DIAGNOSTIC) return nomSortie('diagnostic').replace('[extname]', '.js');
    return 'assets/[name]-[hash].js';
  }
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
function pagesHorsAppliSansServiceWorker(): Plugin {
  return {
    name: 'planif:pages-hors-appli-sans-sw',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, contexte) {
        if (!PREFIXES_PAGES_HORS_APPLI.some((p) => contexte.path.startsWith(p))) return html;
        let resultat = html;
        for (const motif of [/<link rel="manifest"[^>]*>/g, /<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g]) {
          // Échec franc si vite-plugin-pwa change sa façon d'injecter : sinon le SW reviendrait sans bruit.
          if (!motif.test(resultat)) throw new Error(`${contexte.path} : balise du service worker introuvable (${motif.source})`);
          motif.lastIndex = 0;
          resultat = resultat.replace(motif, '');
        }
        return resultat;
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
        // Pages de mesure et de diagnostic, et base locale (PowerSync, workers, WASM) hors du
        // précache : l'installation de l'appli ne s'alourdit pas tant que l'appli ne s'en sert pas.
        globIgnores: [
          '**/node_modules/**',
          'mesures/**',
          'diagnostic/**',
          'assets/mesures/**',
          'assets/diagnostic/**',
          'assets/sqlite/**',
        ],
        navigateFallbackDenylist: [/^\/mesures\//, /^\/diagnostic\//],
      },
    }),
    pagesHorsAppliSansServiceWorker(),
  ],
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        [ENTREE_MESURE]: fileURLToPath(new URL('mesures/sqlite.html', import.meta.url)),
        [ENTREE_DIAGNOSTIC]: fileURLToPath(new URL('diagnostic/synchro.html', import.meta.url)),
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

import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { baliseCsp, type OptionsCsp } from './scripts/csp.ts';
import { COULEURS } from './src/ui/jetons.ts';

/**
 * Pages de mesure (T07) et de diagnostic (T10) : hors navigation, hors service worker, jamais
 * chargées par l'appli.
 */
const PREFIXES_PAGES_HORS_APPLI = ['/mesures/', '/diagnostic/'];

/** Code de la base locale (PowerSync, wa-sqlite) : rangé à part, dans `assets/sqlite/`. */
const MOTIF_SQLITE = /node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(@powersync|@journeyapps)\//;

/**
 * Ce dont l'appli se sert pour ouvrir sa base (T11), dans le worker : SQLite asynchrone sans
 * chiffrement et le VFS IndexedDB (IDBBatchAtomicVFS, sur FacadeVFS). Ces fichiers restent dans
 * `assets/sqlite/`, avec PowerSync et son worker, et entrent dans le précache : la base s'ouvre
 * hors ligne (principe 4).
 */
const MOTIF_SQLITE_UTILISE = /@journeyapps\/wa-sqlite\/(dist\/wa-sqlite-async\.mjs|src\/examples\/IDBBatchAtomicVFS\.js|src\/FacadeVFS\.js)/;

/**
 * Variantes que l'appli ne charge pas (SQLite chiffré ou synchrone, VFS OPFS ou mémoire,
 * WebSocket, SQLite dans la page plutôt que dans un worker) : `assets/sqlite-annexe/`, hors
 * précache. Les pages de mesure (T07) s'en servent ; l'appli jamais.
 */
const MOTIF_SQLITE_ANNEXE = /@journeyapps\/wa-sqlite\/(dist\/|src\/examples\/|src\/FacadeVFS\.js)|[\\/]websockets[\\/.]/;

const ENTREE_MESURE = 'mesureSqlite';
const ENTREE_DIAGNOSTIC = 'diagnosticSynchro';
const ENTREE_AMORCAGE = 'diagnosticAmorcage';
const ENTREES_DIAGNOSTIC: readonly string[] = [ENTREE_DIAGNOSTIC, ENTREE_AMORCAGE];

function nomSortie(dossier: string, extension = '[extname]'): string {
  return `assets/${dossier}/[name]-[hash]${extension}`;
}

interface MorceauNomme {
  readonly name: string;
  readonly isEntry: boolean;
  readonly moduleIds: readonly string[];
}

/**
 * Range les morceaux JS de la page : l'entrée de mesure dans `assets/mesures/`, celles de
 * diagnostic dans `assets/diagnostic/`, PowerSync dans `assets/sqlite/`. SQLite lui-même ne
 * tourne jamais dans la page de l'appli (worker dédié) : ses copies de la page vont dans
 * `assets/sqlite-annexe/`. Une entrée n'est jamais classée « SQLite » : `index-*.js` reste dans
 * le précache.
 */
function nomMorceau(morceau: MorceauNomme): string {
  if (morceau.isEntry) {
    if (morceau.name === ENTREE_MESURE) return nomSortie('mesures', '.js');
    if (ENTREES_DIAGNOSTIC.includes(morceau.name)) return nomSortie('diagnostic', '.js');
    return 'assets/[name]-[hash].js';
  }
  if (morceau.moduleIds.some((id) => MOTIF_SQLITE_ANNEXE.test(id))) return nomSortie('sqlite-annexe', '.js');
  if (morceau.moduleIds.some((id) => MOTIF_SQLITE.test(id))) return nomSortie('sqlite', '.js');
  return 'assets/[name]-[hash].js';
}

/** Morceaux du worker de PowerSync : ce que l'appli charge dans `assets/sqlite/`, le reste en annexe. */
function nomMorceauWorker(morceau: MorceauNomme): string {
  if (morceau.isEntry || morceau.moduleIds.some((id) => MOTIF_SQLITE_UTILISE.test(id))) return nomSortie('sqlite', '.js');
  if (morceau.moduleIds.some((id) => MOTIF_SQLITE_ANNEXE.test(id))) return nomSortie('sqlite-annexe', '.js');
  return nomSortie('sqlite', '.js');
}

/**
 * Le WASM de SQLite : celui que l'appli charge (wa-sqlite-async, sans chiffrement) dans
 * `assets/sqlite/`, les autres dans `assets/sqlite-annexe/` ; la feuille de style des pages de
 * diagnostic dans `assets/diagnostic/` (hors précache, comme les pages).
 */
function nomFichierAnnexe(fichier: { names: readonly string[]; originalFileNames?: readonly string[] }): string {
  if (fichier.names.some((n) => n.endsWith('.wasm'))) {
    return fichier.names.includes('wa-sqlite-async.wasm') ? nomSortie('sqlite') : nomSortie('sqlite-annexe');
  }
  if ((fichier.originalFileNames ?? []).some((n) => n.startsWith('diagnostic/'))) return nomSortie('diagnostic');
  return 'assets/[name]-[hash][extname]';
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

/**
 * CSP stricte (T09b, voir scripts/csp.ts) : balise <meta> en tête du <head>, avant tout <script>
 * et tout <link>, dans chaque page du build : l'appli, et aussi les pages de diagnostic (qui
 * manipule la session) et de mesure (relecture sécurité). Au build seulement (le serveur de
 * développement injecte un script en ligne pour le rechargement à chaud).
 */
function cspEnBalise(options: OptionsCsp): Plugin {
  return {
    name: 'planif:csp',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, contexte) {
        const tete = /<head[^>]*>/i.exec(html);
        if (tete === null) throw new Error(`${contexte.path} : <head> introuvable, CSP non posée`);
        const fin = tete.index + tete[0].length;
        return `${html.slice(0, fin)}\n    ${baliseCsp(options)}${html.slice(fin)}`;
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  return {
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
          background_color: COULEURS.fond,
          theme_color: COULEURS.foret,
          icons: [{ src: 'icone.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
        },
        workbox: {
          // Polices (T16) comprises : l'appli hors ligne garde ses polices. Base locale comprise
          // (T11) : PowerSync, son worker et son WASM (assets/sqlite/), la base s'ouvre hors ligne.
          globPatterns: ['**/*.{js,wasm,css,html,woff2}'],
          // Le WASM de SQLite pèse 2,2 Mo (0,8 Mo compressé) : au-delà de la limite par défaut (2 Mio).
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          // Pages de mesure et de diagnostic, et variantes de SQLite dont l'appli ne se sert pas,
          // hors du précache.
          globIgnores: [
            '**/node_modules/**',
            'mesures/**',
            'diagnostic/**',
            'assets/mesures/**',
            'assets/diagnostic/**',
            'assets/sqlite-annexe/**',
          ],
          navigateFallbackDenylist: [/^\/mesures\//, /^\/diagnostic\//],
        },
      }),
      pagesHorsAppliSansServiceWorker(),
      cspEnBalise({ urlApi: env.VITE_API_URL, urlPowerSync: env.VITE_POWERSYNC_URL }),
    ],
    build: {
      // modulepreload est natif sur les navigateurs visés (Chrome Android, Safari 17+) ; ailleurs,
      // les mêmes fichiers se chargent sans préchargement. Le polyfill n'était que du JavaScript de
      // démarrage en plus (T16, budget de poids).
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('index.html', import.meta.url)),
          [ENTREE_MESURE]: fileURLToPath(new URL('mesures/sqlite.html', import.meta.url)),
          [ENTREE_DIAGNOSTIC]: fileURLToPath(new URL('diagnostic/synchro.html', import.meta.url)),
          // T11 : amorçage de la base locale pour les tests de bout en bout (e2e/plan.e2e.ts).
          [ENTREE_AMORCAGE]: fileURLToPath(new URL('diagnostic/amorcer.html', import.meta.url)),
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
          entryFileNames: nomSortie('sqlite', '.js'),
          chunkFileNames: nomMorceauWorker,
          assetFileNames: nomFichierAnnexe,
        },
      },
    },
    test: {
      environment: 'node',
    },
  };
});

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
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
 *
 * T11c : elles n'existent que dans le build des essais (`vite build --mode essais`, lancé par
 * scripts/build-essais.ts), jamais dans le build de production (`vite build`, le site mis en
 * ligne). Le build des essais ne construit QUE ces pages, sans vite-plugin-pwa : il est versé à
 * côté d'une copie du build de production, sans rien y écraser (même appli, même `sw.js`).
 */
const PREFIXES_PAGES_HORS_APPLI = ['/mesures/', '/diagnostic/'];

/** Mode du build des essais (pages de test seules). */
const MODE_ESSAIS = 'essais';

/**
 * T25 — mode du build de la démo en ligne (`vite build --mode demo`, servi par Vercel) : la même
 * appli (entrée `index`, service worker, précache), avec le mode démo (src/demo/, choisi par
 * src/main.tsx sur `import.meta.env.MODE`), dans son propre dossier. Sans API ni synchro : les
 * URL de service sont vidées, quelle que soit la configuration de l'hébergeur.
 */
const MODE_DEMO = 'demo';
const DOSSIER_DEMO = 'dist-demo';

/** Code du mode démo : jamais dans un autre build que celui de la démo. */
const DOSSIER_SOURCES_DEMO = fileURLToPath(new URL('src/demo/', import.meta.url));

/** Liste blanche du build de production : l'entrée `index`, la page `/index.html`, rien d'autre. */
const ENTREE_APPLI = 'index';
const PAGE_APPLI = '/index.html';

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
 * précache. Le code de PowerSync y fait référence par des imports dynamiques, d'où leur présence
 * dans le build de production, mais l'appli ne les charge jamais. Les pages de mesure (T07),
 * dans le build des essais, s'en servent.
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

/**
 * T15c : le worker de compression de l'export n'est pas un morceau de la base locale. Il va avec
 * le reste de l'appli (`assets/`), hors de `assets/sqlite/`, et entre dans le précache comme lui :
 * l'export marche hors ligne dès la première visite.
 */
const MODULE_WORKER_COMPRESSION = fileURLToPath(new URL('src/ecrans/export/compression.worker.ts', import.meta.url));

function estWorkerCompression(morceau: MorceauNomme): boolean {
  return morceau.moduleIds.includes(MODULE_WORKER_COMPRESSION);
}

/** Entrée d'un worker : celui de la compression de l'export dans `assets/`, ceux de PowerSync dans `assets/sqlite/`. */
function nomEntreeWorker(morceau: MorceauNomme): string {
  return estWorkerCompression(morceau) ? 'assets/[name]-[hash].js' : nomSortie('sqlite', '.js');
}

/** Morceaux du worker de PowerSync : ce que l'appli charge dans `assets/sqlite/`, le reste en annexe. */
function nomMorceauWorker(morceau: MorceauNomme): string {
  if (estWorkerCompression(morceau)) return 'assets/[name]-[hash].js';
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
 * Petit morceau partagé `identifiants` : le générateur d'UUID de @planif/core, chargé par presque
 * tous les écrans (et par l'éditeur de placement), plutôt qu'un morceau naturel de plus.
 */
const MORCEAU_IDENTIFIANTS = 'identifiants';
const MODULES_IDENTIFIANTS = [
  fileURLToPath(new URL('../../packages/core/src/domaine/identifiants.ts', import.meta.url)),
  // T13g : la dernière ferme choisie, lue par l'écran Aujourd'hui avant la base et écrite par la
  // ferme active (src/donnees/ferme-memorisee.ts) : même raison, pas de morceau à elle.
  fileURLToPath(new URL('src/donnees/ferme-memorisee.ts', import.meta.url)),
];

/**
 * T13r : la règle « déjà fait » (@planif/sync/fait-unique, SQL des chaînes de remplacement),
 * partagée par la porte (`assets/sqlite/base-appli-*.js`) et l'écran Aujourd'hui, a son propre
 * morceau. T13i l'avait rangée dans `identifiants` pour éviter un nom de fichier de plus dans la
 * table des dépendances du démarrage ; mais l'éditeur de placement, qui ne charge `identifiants`
 * que pour l'UUID, payait tout ce SQL (1,8 Kio compressés). Compromis mesuré : +8 octets
 * compressés au démarrage (72 688 → 72 696 sur 72 704), −1,8 Kio pour l'éditeur. Nom court
 * exprès : sans morceau manuel, Rollup le nomme `fait-unique`, et ce nom plus long fait dépasser
 * le démarrage de 3 octets (72 707).
 */
const MORCEAU_FAIT = 'fait';
const MODULE_FAIT_UNIQUE = fileURLToPath(new URL('../../packages/sync/src/fait-unique.ts', import.meta.url));

/**
 * T36 : le moteur de croissance du cœur (`packages/core/src/croissance/`) a son propre morceau.
 * Sans lui, il restait dans le morceau commun de `@planif/core` (24,5 Kio compressés) que la vue 3D
 * chargeait en entier pour deux fonctions.
 */
const MORCEAU_CROISSANCE = 'croissance';
const DOSSIER_CROISSANCE = fileURLToPath(new URL('../../packages/core/src/croissance/', import.meta.url));

function morceauManuel(id: string): string | undefined {
  if (MODULES_IDENTIFIANTS.includes(id)) return MORCEAU_IDENTIFIANTS;
  if (id === MODULE_FAIT_UNIQUE) return MORCEAU_FAIT;
  return id.startsWith(DOSSIER_CROISSANCE) && !id.endsWith('.test.ts') ? MORCEAU_CROISSANCE : undefined;
}

/** Module qui enregistre le service worker, au repos, après le premier affichage (T20). */
const MODULE_ENREGISTREMENT_SW = fileURLToPath(new URL('src/serviceWorker.ts', import.meta.url));

/** Toute trace d'un enregistrement de service worker dans le code d'un morceau. */
const MOTIF_APPEL_REGISTER = /serviceWorker\.register\b/;

interface MorceauSortie {
  readonly type: 'chunk';
  readonly name: string;
  readonly isEntry: boolean;
  readonly code: string;
  readonly moduleIds: readonly string[];
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
}

/**
 * Service worker : un seul chemin d'enregistrement, `src/serviceWorker.ts`, appelé au repos après
 * le premier affichage (T20). vite-plugin-pwa n'injecte plus son script (`injectRegister: false`),
 * qui enregistrait au `load` de la fenêtre ; on vérifie qu'il ne revient pas sans bruit.
 *
 * Pages de mesure et de diagnostic : jamais de service worker (l'installation, précache de
 * l'appli, fausserait les temps). Construites sans vite-plugin-pwa (build des essais), elles ne
 * portent pas le manifeste, et aucun morceau qu'elles chargent, statiquement ou à la demande,
 * n'enregistre de service worker : le build échoue sinon. Le build de production, lui, échoue
 * s'il contient une page hors appli.
 */
function pagesHorsAppliSansServiceWorker(essais: boolean, demo: boolean): Plugin {
  return {
    name: 'planif:pages-hors-appli-sans-sw',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      // T11c : le build des essais ne vide jamais le dossier du build de production.
      if (essais && resolve(config.root, config.build.outDir) === resolve(config.root, 'dist')) {
        throw new Error('build des essais vers dist/ refusé : passer --outDir (scripts/build-essais.ts) (T11c)');
      }
      // T25 : la démo ne remplace jamais le build de production.
      if (demo && resolve(config.root, config.build.outDir) === resolve(config.root, 'dist')) {
        throw new Error(`build de la démo vers dist/ refusé : sa sortie est ${DOSSIER_DEMO}/ (T25)`);
      }
    },
    buildStart(options) {
      if (essais) return;
      const input = options.input;
      const noms = typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.keys(input);
      const refusees = noms.filter((n) => n !== ENTREE_APPLI);
      if (refusees.length > 0) {
        throw new Error(`entrées refusées dans le build de production : ${refusees.join(', ')} ; seule « ${ENTREE_APPLI} » est admise (T11c)`);
      }
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, contexte) {
        // Échec franc si vite-plugin-pwa se remet à injecter un enregistrement au load.
        if (/vite-plugin-pwa:register-sw|registerSW\.js|serviceWorker\.register/.test(html)) {
          throw new Error(`${contexte.path} : enregistrement du service worker injecté dans la page (attendu : src/serviceWorker.ts, au repos)`);
        }
        const horsAppli = PREFIXES_PAGES_HORS_APPLI.some((p) => contexte.path.startsWith(p));
        if (!essais && contexte.path !== PAGE_APPLI) {
          throw new Error(`${contexte.path} : page refusée dans le build de production, seule ${PAGE_APPLI} est admise (T11c)`);
        }
        if (essais && !horsAppli) throw new Error(`${contexte.path} : le build des essais ne construit que les pages de test (T11c)`);
        if (essais && /<link\b[^>]*\brel="manifest"/.test(html)) throw new Error(`${contexte.path} : manifeste dans une page de test`);
        return html;
      },
    },
    generateBundle(_options, paquet) {
      const morceaux = new Map<string, MorceauSortie>();
      for (const [fichier, sortie] of Object.entries(paquet)) {
        if (sortie.type === 'chunk') morceaux.set(fichier, sortie);
      }
      // T25 : hors du build de la démo, aucun module de src/demo/ (bandeau, jeux de la démo).
      if (!demo) {
        for (const [fichier, morceau] of morceaux) {
          const intrus = morceau.moduleIds.find((id) => id.startsWith(DOSSIER_SOURCES_DEMO));
          if (intrus !== undefined) throw new Error(`${fichier} : code du mode démo (${intrus}) hors du build de la démo (T25)`);
        }
      }
      // Build des essais : toutes les entrées sont des pages de test, chacune est parcourue.
      for (const [fichierEntree, entree] of morceaux) {
        if (!entree.isEntry) continue;
        if (!essais && entree.name !== ENTREE_APPLI) {
          throw new Error(`entrée « ${entree.name} » refusée dans le build de production, seule « ${ENTREE_APPLI} » est admise (T11c)`);
        }
        if (!essais) continue;
        const aVoir = [fichierEntree];
        const vus = new Set<string>();
        for (let fichier = aVoir.pop(); fichier !== undefined; fichier = aVoir.pop()) {
          if (vus.has(fichier)) continue;
          vus.add(fichier);
          const morceau = morceaux.get(fichier);
          if (morceau === undefined) continue;
          if (morceau.moduleIds.includes(MODULE_ENREGISTREMENT_SW) || MOTIF_APPEL_REGISTER.test(morceau.code)) {
            throw new Error(`page hors appli « ${entree.name} » : ${fichier} enregistre un service worker`);
          }
          aVoir.push(...morceau.imports, ...morceau.dynamicImports);
        }
      }
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

/**
 * T27 — vue 3D sans un octet de plus au démarrage. @react-three/fiber et ses dépendances
 * importent des paquets CommonJS (react, scheduler, use-sync-external-store) par import par
 * défaut ou d'espace de noms : rolldown ajoute alors ses aides d'interopérabilité (`__toESM`,
 * `__export`) au module d'exécution, qui vit dans le morceau d'entrée (≈ 0,4 Kio gzip au
 * démarrage, au-delà du budget). Pour ces seuls importeurs, le paquet CommonJS est servi par un
 * module ES qui en réexporte les noms un à un (imports nommés : simple accès à une propriété,
 * sans aide) et un objet par défaut. Mêmes objets, même instance de React : rien ne change à
 * l'exécution.
 */
const MOTIF_IMPORTEURS_3D = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@react-three[\\/]fiber|its-fine|zustand|suspend-react|react-use-measure)[\\/]/;
const PAQUETS_COMMONJS_3D: readonly string[] = ['react', 'scheduler', 'use-sync-external-store/shim/with-selector', 'use-sync-external-store/shim/with-selector.js'];
const PREFIXE_INTEROP_3D = '\0planif-esm:';
const IDENTIFIANT = /^[A-Za-z_$][\w$]*$/;

function interopCommonJs3d(): Plugin {
  const exiger = createRequire(import.meta.url);
  return {
    name: 'planif:interop-commonjs-3d',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (importer === undefined || !PAQUETS_COMMONJS_3D.includes(source) || !MOTIF_IMPORTEURS_3D.test(importer)) return null;
      const resolu = await this.resolve(source, importer, { skipSelf: true });
      if (resolu?.external !== false) return null;
      return `${PREFIXE_INTEROP_3D}${resolu.id}`;
    },
    load(id) {
      if (!id.startsWith(PREFIXE_INTEROP_3D)) return null;
      const fichier = id.slice(PREFIXE_INTEROP_3D.length);
      const valeur: unknown = exiger(fichier);
      const noms = valeur !== null && (typeof valeur === 'object' || typeof valeur === 'function') ? Object.keys(valeur).filter((n) => IDENTIFIANT.test(n) && n !== 'default') : [];
      const liste = noms.join(', ');
      const chemin = JSON.stringify(fichier);
      return noms.length === 0
        ? `import * as tout from ${chemin};\nexport default tout;\n`
        : `import { ${liste} } from ${chemin};\nexport { ${liste} };\nexport default { ${liste} };\n`;
    },
  };
}

/** Entrées du build : l'appli seule en production, les pages de test seules pour les essais. */
function entrees(essais: boolean): Record<string, string> {
  const chemin = (fichier: string): string => fileURLToPath(new URL(fichier, import.meta.url));
  if (!essais) return { index: chemin('index.html') };
  return {
    [ENTREE_MESURE]: chemin('mesures/sqlite.html'),
    [ENTREE_DIAGNOSTIC]: chemin('diagnostic/synchro.html'),
    // T11 : amorçage de la base locale pour les tests de bout en bout (e2e/plan.e2e.ts).
    [ENTREE_AMORCAGE]: chemin('diagnostic/amorcer.html'),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const essais = mode === MODE_ESSAIS;
  const demo = mode === MODE_DEMO;
  return {
    plugins: [
      react(),
      interopCommonJs3d(),
      // Hors-ligne d'abord : le service worker met toute l'appli en cache dès la première visite.
      // Pas dans le build des essais : il écrirait un autre `sw.js` (T11c).
      !essais &&
      VitePWA({
        registerType: 'autoUpdate',
        // T20 : pas d'enregistrement au load de la fenêtre ; src/serviceWorker.ts enregistre au
        // repos, après le premier affichage de l'appli.
        injectRegister: false,
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
          // autoUpdate sans le module d'enregistrement de vite-plugin-pwa : la nouvelle version
          // prend la main dès son installation, et la première visite est contrôlée sans recharger.
          skipWaiting: true,
          clientsClaim: true,
        },
      }),
      pagesHorsAppliSansServiceWorker(essais, demo),
      // Démo : ni API ni synchro, la CSP n'autorise que l'origine de la démo.
      cspEnBalise(demo ? {} : { urlApi: env.VITE_API_URL, urlPowerSync: env.VITE_POWERSYNC_URL }),
    ],
    // Démo : URL de service vidées, même si l'hébergeur définit VITE_API_URL ou VITE_POWERSYNC_URL.
    ...(demo ? { define: { 'import.meta.env.VITE_API_URL': '""', 'import.meta.env.VITE_POWERSYNC_URL': '""' } } : {}),
    build: {
      // modulepreload est natif sur les navigateurs visés (Chrome Android, Safari 17+) ; ailleurs,
      // les mêmes fichiers se chargent sans préchargement. Le polyfill n'était que du JavaScript de
      // démarrage en plus (T16, budget de poids).
      modulePreload: { polyfill: false },
      ...(demo ? { outDir: DOSSIER_DEMO } : {}),
      // Build des essais : public/ est déjà dans la copie du build de production.
      copyPublicDir: !essais,
      rollupOptions: {
        input: entrees(essais),
        output: {
          entryFileNames: nomMorceau,
          chunkFileNames: nomMorceau,
          assetFileNames: nomFichierAnnexe,
          manualChunks: morceauManuel,
        },
      },
    },
    // PowerSync embarque des workers et du WASM : Vite ne doit pas les pré-empaqueter (doc PowerSync).
    optimizeDeps: { exclude: ['@powersync/web'] },
    worker: {
      format: 'es',
      // Les workers de PowerSync ne servent qu'à la base locale ; celui de la compression de l'export, à part (T15c).
      rollupOptions: {
        output: {
          entryFileNames: nomEntreeWorker,
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

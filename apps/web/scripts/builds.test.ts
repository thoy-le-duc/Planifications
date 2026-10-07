/**
 * Tests d'acceptation T11c — pages de test hors du site en production.
 *
 * ── Contrat pour le développeur ─────────────────────────────────────────────────────────────────
 *
 * Deux builds, construits par deux scripts de @planif/web :
 *
 *   - `pnpm --filter @planif/web build` → `apps/web/dist/` : le site mis en ligne, l'appli seule.
 *       · seule page HTML : `index.html` (aucune page `mesures/` ni `diagnostic/`) ;
 *       · aucun fichier sous `mesures/`, `diagnostic/`, `assets/mesures/`, `assets/diagnostic/` ;
 *       · aucun fichier (JS, CSS, HTML, sw.js, WASM…) ne contient une chaîne propre au code de
 *         test (MARQUEURS ci-dessous : jeu T07, amorçage T11, mesure T07, diagnostic T10).
 *
 *   - `pnpm --filter @planif/web build:essais` → `apps/web/dist-essais/` : l'appli ET les pages de
 *     test (`mesures/sqlite.html`, `diagnostic/synchro.html`, `diagnostic/amorcer.html`).
 *     C'est ce build que servent `pnpm e2e` et `pnpm e2e:synchro` : ces deux suites ouvrent les
 *     pages de test, elles échouent donc d'elles-mêmes si elles servent le build de production.
 *       · « même appli » : CHAQUE fichier de `dist/` existe dans `dist-essais/` au même chemin et
 *         octet pour octet identique — `index.html`, morceau d'entrée (même nom, donc même
 *         empreinte), tous les morceaux, `sw.js` (même précache). Les pages de test n'ajoutent
 *         que des fichiers, elles n'en changent aucun. Attention : ajouter les pages comme
 *         entrées du même `vite build` (simple `--mode essais`) ne suffit pas, on l'a vérifié :
 *         rolldown redécoupe alors les morceaux partagés et l'entrée de l'appli change
 *         d'empreinte (index-COmM1PRV.js avec les pages, index-CTyStNt9.js sans, le 2026-09-30).
 *         Piste : build de production tel quel, puis build à part des seules pages de test,
 *         versé dans le même dossier sans écraser l'appli.
 *       · la garde de vite.config.ts reste vraie : aucune page de test ne porte le manifeste, et
 *         aucun JavaScript qu'elle charge (script, modulepreload, imports statiques et
 *         dynamiques, récursivement) n'appelle `serviceWorker.register`.
 *   - `dist-essais/` est ignoré par git (comme `dist/` et `dist-synchro/`).
 *
 * Comment ce test trouve les builds : il lance lui-même les deux scripts ci-dessus (pnpm run,
 * dans apps/web), qui écrivent `dist/` et `dist-essais/`, puis lit ces dossiers. Pas de build en
 * mémoire (`write: false`) : vite-plugin-pwa écrit `sw.js` après coup sur le disque, et c'est la
 * commande réelle qu'on veut vérifier, pas la configuration seule. Pas de lecture d'un `dist/`
 * existant : `pnpm verif` et la CI lancent les tests avant `pnpm build`, un vieux `dist/` ne
 * prouverait rien. Coût mesuré : quelques secondes par build.
 * NODE_ENV (posé à « test » par Vitest) est retiré de l'environnement des builds : sinon Vite
 * construirait React en mode développement.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild, type Plugin } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const RACINE_DEPOT = fileURLToPath(new URL('../../..', import.meta.url));
const DIST = join(WEB, 'dist');
const DIST_ESSAIS = join(WEB, 'dist-essais');

/**
 * Chaînes propres au code de test, qui survivent à la minification (textes et noms de propriétés,
 * pas des noms de fonctions) et n'existent nulle part dans l'appli. Chacune est présente dans le
 * build des essais (témoin plus bas), sinon son absence en production ne prouverait rien.
 */
const MARQUEURS: readonly { readonly texte: string; readonly source: string }[] = [
  { texte: 'Chou « maison »', source: 'jeu T07 (packages/sync/src/test/jeu-t07.ts)' },
  { texte: '__amorcage', source: 'amorçage T11 (src/donnees/amorcer.ts)' },
  { texte: '__mesuresSqlite', source: 'mesure T07 (src/mesures/sqlite.ts)' },
  { texte: 'Paramètre ferme absent ou invalide', source: 'diagnostic T10 (src/diagnostic/synchro.ts)' },
];

const PAGES_DE_TEST = ['mesures/sqlite.html', 'diagnostic/synchro.html', 'diagnostic/amorcer.html'] as const;
const DOSSIERS_DE_TEST = ['mesures/', 'diagnostic/', 'assets/mesures/', 'assets/diagnostic/'] as const;

interface Resultat {
  readonly ok: boolean;
  readonly sortie: string;
}

/** Lance un script de @planif/web, NODE_ENV et variables de Vitest retirés. */
function lancer(script: string): Resultat {
  return commande(['run', script]);
}

/** Lance `pnpm <args>` dans apps/web, NODE_ENV et variables de Vitest retirés. */
function commande(args: readonly string[]): Resultat {
  const env: NodeJS.ProcessEnv = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (cle === 'NODE_ENV' || cle.startsWith('VITEST')) continue;
    env[cle] = valeur;
  }
  const r = spawnSync('pnpm', args, { cwd: WEB, env, encoding: 'utf8' });
  return { ok: r.status === 0, sortie: `${r.stdout}\n${r.stderr}`.slice(-3000) };
}

/** Tous les fichiers d'un dossier, en chemins relatifs à la mode URL (« assets/x.js »). */
function fichiers(dossier: string): string[] {
  if (!existsSync(dossier)) return [];
  const liste: string[] = [];
  const pile = [dossier];
  for (let d = pile.pop(); d !== undefined; d = pile.pop()) {
    for (const nom of readdirSync(d)) {
      const chemin = join(d, nom);
      if (statSync(chemin).isDirectory()) pile.push(chemin);
      else liste.push(relative(dossier, chemin).split(sep).join('/'));
    }
  }
  return liste.sort();
}

function lire(dossier: string, fichier: string): Buffer {
  return readFileSync(join(dossier, ...fichier.split('/')));
}

/** Scripts et modulepreload d'une page HTML, en chemins relatifs à la racine du build. */
function scriptsDeLaPage(html: string): string[] {
  const motifs = [/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g, /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+\.js)"/g];
  return motifs.flatMap((m) => [...html.matchAll(m)].map((x) => x[1])).filter((f): f is string => f !== undefined);
}

/**
 * JavaScript atteint depuis `depart` : toute chaîne entre guillemets finissant en `.js` qui
 * désigne un fichier du build (imports `from"../x.js"`, `import("./x.js")`, dépendances de
 * préchargement `"assets/x.js"`, URL absolues `"/assets/x.js"`), récursivement.
 */
function jsAtteint(dossier: string, depart: readonly string[]): string[] {
  const presents = new Set(fichiers(dossier));
  const vus = new Set<string>();
  const pile = [...depart];
  for (let f = pile.pop(); f !== undefined; f = pile.pop()) {
    if (vus.has(f) || !presents.has(f)) continue;
    vus.add(f);
    const code = lire(dossier, f).toString('utf8');
    for (const [, cible] of code.matchAll(/["'`]((?:\.{1,2}\/|\/)?[\w@.\-/]+\.js)["'`]/g)) {
      if (cible === undefined) continue;
      const resolu = cible.startsWith('.')
        ? posix.normalize(posix.join(posix.dirname(f), cible))
        : cible.replace(/^\//, '');
      if (presents.has(resolu) && !vus.has(resolu)) pile.push(resolu);
    }
  }
  return [...vus].sort();
}

/** index.html du build de production frais (premier describe), pour la garde 3 de la relecture. */
let indexProductionFrais: string | undefined;

function dansUnDossierDeTest(fichier: string): boolean {
  return DOSSIERS_DE_TEST.some((d) => fichier.startsWith(d));
}

describe('T11c : build de production (dist/), l’appli seule', () => {
  let build: Resultat;

  beforeAll(() => {
    build = lancer('build');
    if (build.ok) indexProductionFrais = lire(DIST, 'index.html').toString('utf8');
  }, 180_000);

  it('le build de production réussit et contient l’appli (témoin)', () => {
    expect(build.ok, build.sortie).toBe(true);
    const html = lire(DIST, 'index.html').toString('utf8');
    const scripts = scriptsDeLaPage(html);
    expect(scripts.length, 'scripts de index.html').toBeGreaterThan(0);
    for (const s of scripts) expect(existsSync(join(DIST, s)), s).toBe(true);
  });

  it('seule page HTML : index.html (aucune page mesures/ ni diagnostic/)', () => {
    expect(fichiers(DIST).filter((f) => f.endsWith('.html'))).toEqual(['index.html']);
  });

  it('aucun fichier sous mesures/, diagnostic/, assets/mesures/, assets/diagnostic/', () => {
    expect(fichiers(DIST).filter(dansUnDossierDeTest)).toEqual([]);
  });

  it('aucun fichier ne contient de chaîne propre au code de test', () => {
    const trouves: string[] = [];
    for (const f of fichiers(DIST)) {
      const contenu = lire(DIST, f);
      for (const m of MARQUEURS) if (contenu.includes(m.texte, 0, 'utf8')) trouves.push(`${f} : « ${m.texte} » (${m.source})`);
    }
    expect(trouves).toEqual([]);
  });
});

describe('T11c : build des essais (dist-essais/), l’appli et les pages de test', () => {
  let build: Resultat;

  beforeAll(() => {
    build = lancer('build:essais');
  }, 180_000);

  it('`pnpm --filter @planif/web build:essais` réussit', () => {
    expect(build.ok, build.sortie).toBe(true);
  });

  it('dist-essais/ est ignoré par git', () => {
    const r = spawnSync('git', ['check-ignore', '-q', 'apps/web/dist-essais/'], { cwd: RACINE_DEPOT });
    expect(r.status, 'git check-ignore apps/web/dist-essais/').toBe(0);
  });

  it('les trois pages de test y sont, et leurs scripts aussi', () => {
    for (const page of PAGES_DE_TEST) {
      expect(existsSync(join(DIST_ESSAIS, page)), page).toBe(true);
      const scripts = scriptsDeLaPage(lire(DIST_ESSAIS, page).toString('utf8'));
      expect(scripts.length, `scripts de ${page}`).toBeGreaterThan(0);
      for (const s of scripts) expect(existsSync(join(DIST_ESSAIS, s)), `${page} → ${s}`).toBe(true);
    }
  });

  it('témoin : chaque marqueur du code de test est bien dans le build des essais', () => {
    const tout = fichiers(DIST_ESSAIS).map((f) => lire(DIST_ESSAIS, f));
    for (const m of MARQUEURS) expect(tout.some((c) => c.includes(m.texte, 0, 'utf8')), `« ${m.texte} » (${m.source})`).toBe(true);
  });

  it('même entrée de l’appli : index.html identique, même morceau d’entrée (même empreinte)', () => {
    const prod = lire(DIST, 'index.html').toString('utf8');
    const essais = lire(DIST_ESSAIS, 'index.html').toString('utf8');
    expect(essais).toBe(prod);
    const entree = scriptsDeLaPage(prod).find((s) => /^assets\/index-[\w-]+\.js$/.test(s));
    expect(entree, 'morceau d’entrée assets/index-*.js dans dist/index.html').toBeDefined();
    if (entree === undefined) return;
    expect(lire(DIST_ESSAIS, entree).equals(lire(DIST, entree)), entree).toBe(true);
  });

  it('même appli : chaque fichier de dist/ est dans dist-essais/, identique octet pour octet (sw.js compris)', () => {
    const prod = fichiers(DIST);
    expect(prod.length).toBeGreaterThan(0);
    const essais = new Set(fichiers(DIST_ESSAIS));
    const absents = prod.filter((f) => !essais.has(f));
    expect(absents, 'fichiers de dist/ absents de dist-essais/').toEqual([]);
    const differents = prod.filter((f) => essais.has(f) && !lire(DIST_ESSAIS, f).equals(lire(DIST, f)));
    expect(differents, 'fichiers de dist/ modifiés dans dist-essais/').toEqual([]);
  });

  it('garde : aucune page de test ne porte le manifeste ni n’enregistre de service worker', () => {
    // Témoin : depuis index.html, le parcours atteint bien l'enregistrement (src/serviceWorker.ts).
    const appli = jsAtteint(DIST_ESSAIS, scriptsDeLaPage(lire(DIST_ESSAIS, 'index.html').toString('utf8')));
    expect(
      appli.some((f) => /serviceWorker\.register\b/.test(lire(DIST_ESSAIS, f).toString('utf8'))),
      'l’appli enregistre un service worker (témoin du parcours)',
    ).toBe(true);
    for (const page of PAGES_DE_TEST) {
      expect(existsSync(join(DIST_ESSAIS, page)), page).toBe(true);
      const html = lire(DIST_ESSAIS, page).toString('utf8');
      expect(html, `${page} : manifeste`).not.toMatch(/<link rel="manifest"/);
      expect(html, `${page} : enregistrement dans la page`).not.toMatch(/serviceWorker\.register|registerSW/);
      const atteints = jsAtteint(DIST_ESSAIS, scriptsDeLaPage(html));
      expect(atteints.length, `JavaScript de ${page}`).toBeGreaterThan(0);
      const fautifs = atteints.filter((f) => /serviceWorker\.register\b/.test(lire(DIST_ESSAIS, f).toString('utf8')));
      expect(fautifs, `${page} : morceaux qui enregistrent un service worker`).toEqual([]);
    }
  });
});

/**
 * T15c (docs/backlog/T15c-export-rapide.md), suite de la relecture de T16b : le worker de
 * compression de l'export (src/ecrans/export/compression.worker.ts) n'est pas un morceau de la
 * base locale. Il ne doit pas être rangé sous `assets/sqlite/` (là va tout ce que le worker de
 * PowerSync charge) ni sous `assets/sqlite-annexe/` (hors précache), et il doit entrer dans le
 * précache du service worker : l'export marche hors ligne dès la première visite.
 * Le worker se reconnaît à son contenu : un fichier JavaScript qui compresse en `deflate-raw`,
 * répond aux messages (`self.onmessage`) et n'en crée pas d'autre (`new Worker`). Il y en a un seul.
 * Ce bloc lit le dist/ du premier bloc, avant les gardes qui l'abîment.
 */
describe('T15c : worker de compression de l’export (dist/)', () => {
  function workerCompression(): string[] {
    return fichiers(DIST).filter((f) => {
      if (!f.endsWith('.js')) return false;
      const code = lire(DIST, f).toString('utf8');
      return code.includes('deflate-raw') && /\bself\.onmessage\b/.test(code) && !code.includes('new Worker(');
    });
  }

  it('témoin : un seul fichier est le worker de compression, et l’écran d’export le charge', () => {
    const w = workerCompression();
    expect(w, 'worker de compression dans dist/').toHaveLength(1);
    const nom = (w[0] ?? '').split('/').at(-1) ?? '';
    const ecran = fichiers(DIST).filter((f) => f.endsWith('.js') && lire(DIST, f).toString('utf8').includes('new Worker(') && lire(DIST, f).toString('utf8').includes(nom));
    expect(ecran.length, 'un morceau qui crée ce worker (new Worker)').toBeGreaterThan(0);
  });

  it('rangé hors de assets/sqlite/ et de assets/sqlite-annexe/', () => {
    const [w] = workerCompression();
    expect(w).toBeDefined();
    expect(w?.startsWith('assets/sqlite/'), `${String(w)} sous assets/sqlite/`).toBe(false);
    expect(w?.startsWith('assets/sqlite-annexe/'), `${String(w)} sous assets/sqlite-annexe/`).toBe(false);
  });

  it('dans le précache du service worker (sw.js)', () => {
    const [w] = workerCompression();
    expect(w).toBeDefined();
    const sw = lire(DIST, 'sw.js').toString('utf8');
    expect(sw.includes(w ?? ''), `${String(w)} dans le précache de sw.js`).toBe(true);
  });

  it('garde : le worker de PowerSync reste sous assets/sqlite/, précaché', () => {
    const sw = lire(DIST, 'sw.js').toString('utf8');
    const sqlite = fichiers(DIST).filter((f) => f.startsWith('assets/sqlite/') && f.endsWith('.js') && !workerCompression().includes(f));
    expect(sqlite.length, 'JavaScript de PowerSync sous assets/sqlite/').toBeGreaterThan(0);
    for (const f of sqlite) expect(sw.includes(f), `${f} dans le précache`).toBe(true);
  });
});

/**
 * Gardes demandées par la relecture de T11c (contrat) :
 *
 *   1. Liste blanche en production : le build de production n'accepte que l'entrée `index`
 *      (index.html). Toute autre entrée HTML, même hors de mesures/ et diagnostic/ (ici
 *      `outils/amorcer.html`), fait échouer `vite build`, avec un message qui nomme la page ou
 *      l'entrée refusée (« outils »). Vérifié par un build programmatique avec la configuration
 *      du projet, l'entrée ajoutée par `build.rollupOptions.input` (fusionnée avec celle de
 *      vite.config.ts) et la page fournie par un petit plugin (rien n'est écrit dans le dépôt),
 *      vers un dossier temporaire. Sans garde, ce build réussit et met la page en précache.
 *   2. `vite build --mode essais` sans --outDir (donc vers dist/) échoue, et laisse dist/ intact
 *      (un fichier témoin et index.html y sont encore, inchangés).
 *   3. `build:essais` reconstruit l'appli du code courant : avec un dist/ périmé (factice),
 *      `pnpm --filter @planif/web build:essais` produit un dist-essais/ dont index.html est celui
 *      d'un build de production frais, sans rien du dist/ périmé.
 *
 * Ces tests viennent après les deux blocs précédents (Vitest exécute les blocs d'un fichier dans
 * l'ordre) : ils abîment dist/ volontairement.
 */
describe('T11c : gardes de la relecture', () => {
  it('1. production : une entrée HTML hors liste blanche (outils/amorcer.html) fait échouer le build', async () => {
    const page = join(WEB, 'outils', 'amorcer.html');
    const html = '<!doctype html><html lang="fr"><head><meta charset="UTF-8" /><title>Outil</title></head><body><p>outil</p></body></html>';
    const pageVirtuelle: Plugin = {
      name: 'planif:test-page-hors-liste',
      enforce: 'pre',
      resolveId: (source) => (source === page ? page : null),
      load: (id) => (id === page ? html : null),
    };
    const sortie = mkdtempSync(join(tmpdir(), 'planif-t11c-liste-blanche-'));
    let erreur: unknown;
    try {
      await viteBuild({
        configFile: join(WEB, 'vite.config.ts'),
        root: WEB,
        mode: 'production',
        logLevel: 'silent',
        plugins: [pageVirtuelle],
        build: { outDir: sortie, emptyOutDir: true, rollupOptions: { input: { outils: page } } },
      });
    } catch (e) {
      erreur = e;
    } finally {
      rmSync(sortie, { recursive: true, force: true });
    }
    expect(erreur, 'le build de production a accepté outils/amorcer.html').toBeDefined();
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    expect(message, 'le message nomme la page ou l’entrée refusée').toMatch(/outils/);
    expect(message, 'échec dû à la garde, pas au mécanisme du test').not.toMatch(/"fileName" or "name" properties/);
  }, 120_000);

  it('2. `vite build --mode essais` sans --outDir échoue et laisse dist/ intact', () => {
    mkdirSync(DIST, { recursive: true });
    const temoin = join(DIST, 'temoin-t11c.txt');
    writeFileSync(temoin, 'ne pas effacer');
    const indexAvant = existsSync(join(DIST, 'index.html')) ? lire(DIST, 'index.html') : undefined;
    const r = commande(['exec', 'vite', 'build', '--mode', 'essais']);
    const temoinIntact = existsSync(temoin);
    rmSync(temoin, { force: true });
    expect(r.ok, `vite build --mode essais vers dist/ a réussi :\n${r.sortie}`).toBe(false);
    expect(temoinIntact, 'dist/ vidé par le build des essais').toBe(true);
    if (indexAvant !== undefined) expect(lire(DIST, 'index.html').equals(indexAvant), 'dist/index.html modifié').toBe(true);
  }, 180_000);

  it('3. `build:essais` reconstruit l’appli du code courant, même avec un dist/ périmé', () => {
    expect(indexProductionFrais, 'index.html du build de production frais (premier bloc)').toBeDefined();
    rmSync(DIST, { recursive: true, force: true });
    mkdirSync(join(DIST, 'assets'), { recursive: true });
    writeFileSync(
      join(DIST, 'index.html'),
      '<!doctype html><html><head><script type="module" src="/assets/index-PERIME.js"></script></head><body></body></html>',
    );
    writeFileSync(join(DIST, 'assets', 'index-PERIME.js'), 'console.log("appli périmée");');
    const r = lancer('build:essais');
    expect(r.ok, r.sortie).toBe(true);
    expect(existsSync(join(DIST_ESSAIS, 'assets', 'index-PERIME.js')), 'morceau du dist/ périmé copié dans dist-essais/').toBe(false);
    expect(lire(DIST_ESSAIS, 'index.html').toString('utf8'), 'index.html de dist-essais/ = build de production frais').toBe(indexProductionFrais);
  }, 240_000);
});

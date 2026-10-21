/**
 * Tests d'acceptation T27 — la vue 3D ne pèse rien au démarrage, a son propre budget et son
 * précache (docs/backlog/T27-vue-3d-prototype.md, Q29).
 *
 * ── Contrat pour le développeur ─────────────────────────────────────────────────────────────────
 *   - `three` et `@react-three/fiber` sont des dépendances de @planif/web ; `@react-three/drei`
 *     n'y est pas.
 *   - Le JavaScript de démarrage (index.html : scripts, modulepreload, et tout ce qu'ils importent
 *     statiquement) ne contient rien de three ni de react-three-fiber : le budget de démarrage
 *     `jsInitialGzKio` reste à 71,2 Kio (71,1 depuis T11b, relevé par T40 : capture de beforeinstallprompt ; par T54 à 71,3 : nom du morceau npk ; ramené à 71,2 par T66), inchangé.
 *   - Le morceau 3D (les fichiers JavaScript qui portent three et fiber, avec ce qu'ils importent
 *     statiquement hors démarrage) est chargé par import dynamique seulement, et son poids gzip
 *     total est sous `jsVue3dGzKio` de apps/web/budget.json (clé à créer, ≈ 220, entre 100 et 260 :
 *     le ticket estime 160 à 215 Kio). scripts/budget.ts vérifie aussi cette clé.
 *   - Chaque fichier du morceau 3D est dans le précache du service worker (sw.js) : la vue marche
 *     hors ligne dès la première visite (principe 4).
 *
 * Le build est lancé ici par l'API de Vite, vers un dossier temporaire (comme la garde 1 de
 * builds.test.ts) : pas de course avec les builds de dist/ de l'autre fichier de test.
 * Marqueurs : chaînes qui survivent à la minification (noms de classes exposés par three, et la
 * propriété `__r3f` que react-three-fiber pose sur ses instances).
 *
 * T71 (docs/backlog/T71-alleger-vue-3d.md) : le morceau 3D garde au moins MARGE_3D_KIO sous le
 * plafond `jsVue3dGzKio` de budget.json (la marge se calcule depuis budget.json, aucun second
 * plafond ici), et la couche des plants (lecture de la base, calcul, rendu, moteur de croissance du
 * cœur), qui ne sert pas au premier affichage, n'y revient pas : elle se charge à la demande.
 * Les modules de chaque fichier sont relevés pendant le build (greffon d'observation, sans effet
 * sur la sortie).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build as viteBuild } from 'vite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));

const MARQUEURS_3D = ['WebGLRenderer', '__r3f'] as const;
const BUDGET_DEMARRAGE_KIO = 71.2; // T40 : 71,1 → 71,2 (capture de beforeinstallprompt, morceau de l’installation) ; T54 : 71,2 → 71,3 (nom du morceau npk) ; T66 : 71,3 → 71,2 (démarrage allégé)
const BORNES_BUDGET_3D_KIO = { min: 100, max: 260 } as const;

/** T71 : marge exigée sous le plafond `jsVue3dGzKio` (Kio gzip), pour les tickets du jumeau (T58, T59, T61). */
const MARGE_3D_KIO = 4;

/** T71 : modules sortis du morceau 3D (couche des plants), chargés à la demande ; chemins relatifs à apps/web. */
const MODULES_HORS_3D: readonly string[] = [
  'src/ecrans/plan3d/donnees-plants.ts',
  'src/ecrans/plan3d/plants.ts',
  'src/ecrans/plan3d/plants-rendu.ts',
  'src/ecrans/plan3d/geometries-plants.ts',
  'src/ecrans/plan3d/Plants.tsx',
];
/** T71 : le moteur de croissance du cœur (morceau `croissance`), tiré par la couche des plants. */
const DOSSIER_HORS_3D = fileURLToPath(new URL('../../../packages/core/src/croissance/', import.meta.url));

interface BudgetJson {
  readonly jsInitialGzKio?: number;
  readonly jsVue3dGzKio?: number;
}

let sortie = '';
let erreurBuild: unknown;
/** Modules (chemins absolus) de chaque fichier JavaScript du build, relevés par le greffon d'observation. */
const modulesParFichier = new Map<string, readonly string[]>();

function fichiers(dossier: string): string[] {
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

const lire = (fichier: string): string => readFileSync(join(sortie, ...fichier.split('/')), 'utf8');
const gzKio = (fichier: string): number => gzipSync(readFileSync(join(sortie, ...fichier.split('/')))).length / 1024;

/** Imports STATIQUES d'un morceau (`from"./x.js"`, `import"./x.js"`), jamais `import("./x.js")`. */
function importsStatiques(fichier: string, presents: ReadonlySet<string>): string[] {
  const code = lire(fichier);
  const cibles: string[] = [];
  for (const [, cible] of code.matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+\.js)["']/g)) {
    if (cible === undefined) continue;
    const resolu = cible.startsWith('.') ? posix.normalize(posix.join(posix.dirname(fichier), cible)) : cible.replace(/^\//, '');
    if (presents.has(resolu)) cibles.push(resolu);
  }
  return cibles;
}

function fermeture(depart: readonly string[], presents: ReadonlySet<string>, exclus: ReadonlySet<string> = new Set()): Set<string> {
  const vus = new Set<string>();
  const pile = [...depart];
  for (let f = pile.pop(); f !== undefined; f = pile.pop()) {
    if (vus.has(f) || exclus.has(f) || !presents.has(f)) continue;
    vus.add(f);
    pile.push(...importsStatiques(f, presents));
  }
  return vus;
}

let presents = new Set<string>();
let demarrage = new Set<string>();
let morceau3d = new Set<string>();

beforeAll(async () => {
  sortie = mkdtempSync(join(tmpdir(), 'planif-t27-'));
  // Vitest pose NODE_ENV=test : sans ce retrait, Vite construirait React en mode développement
  // (130 Kio au démarrage au lieu de ≈ 70) et fausserait tous les poids (voir builds.test.ts).
  const nodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    await viteBuild({
      configFile: join(WEB, 'vite.config.ts'),
      root: WEB,
      mode: 'production',
      logLevel: 'silent',
      build: { outDir: sortie, emptyOutDir: true },
      plugins: [
        {
          name: 'planif:t71-releve-modules',
          apply: 'build',
          generateBundle(_options, paquet) {
            for (const [fichier, morceau] of Object.entries(paquet)) {
              if (morceau.type === 'chunk') modulesParFichier.set(fichier, morceau.moduleIds);
            }
          },
        },
      ],
    });
  } catch (e) {
    erreurBuild = e;
    return;
  } finally {
    if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;
  }
  presents = new Set(fichiers(sortie).filter((f) => f.endsWith('.js')));
  const html = lire('index.html');
  const depart = [/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g, /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+\.js)"/g]
    .flatMap((motif) => [...html.matchAll(motif)].map((x) => x[1]))
    .filter((f): f is string => f !== undefined);
  demarrage = fermeture(depart, presents);
  // Le morceau 3D : les fichiers hors démarrage qui portent three ou fiber, et leurs imports statiques.
  const porteurs = [...presents].filter((f) => !demarrage.has(f) && MARQUEURS_3D.some((m) => lire(f).includes(m)));
  morceau3d = fermeture(porteurs, presents, demarrage);
}, 240_000);

afterAll(() => {
  if (sortie !== '') rmSync(sortie, { recursive: true, force: true });
});

describe('T27 : dépendances', () => {
  const paquet = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const dependances = { ...paquet.devDependencies, ...paquet.dependencies };

  it('three et @react-three/fiber sont déclarés, @react-three/drei ne l’est pas', () => {
    expect(Object.keys(dependances)).toEqual(expect.arrayContaining(['three', '@react-three/fiber']));
    expect(Object.keys(dependances)).not.toContain('@react-three/drei');
  });
});

describe('T27 : budgets (build de production)', () => {
  it('le build de production réussit', () => {
    expect(erreurBuild, erreurBuild instanceof Error ? erreurBuild.message : '').toBeUndefined();
    expect(existsSync(join(sortie, 'index.html'))).toBe(true);
  });

  it('témoin : le build contient bien three et fiber, dans des morceaux hors démarrage', () => {
    expect(morceau3d.size, 'aucun morceau JavaScript hors démarrage ne porte three / react-three-fiber').toBeGreaterThan(0);
    for (const m of MARQUEURS_3D) expect([...morceau3d].some((f) => lire(f).includes(m)), `marqueur « ${m} »`).toBe(true);
  });

  it('rien de three ni de fiber dans le JavaScript de démarrage', () => {
    expect(demarrage.size, 'JavaScript de démarrage').toBeGreaterThan(0);
    const fautifs = [...demarrage].filter((f) => MARQUEURS_3D.some((m) => lire(f).includes(m)));
    expect(fautifs, 'fichiers de démarrage qui contiennent three / fiber').toEqual([]);
  });

  it('aucun fichier du morceau 3D n’est dans le démarrage ni préchargé par index.html', () => {
    const html = lire('index.html');
    for (const f of morceau3d) {
      expect(demarrage.has(f), `${f} dans le démarrage`).toBe(false);
      expect(html.includes(f), `${f} cité par index.html`).toBe(false);
    }
  });

  it('budget de démarrage inchangé (71,2 Kio) et poids du démarrage dessous', () => {
    const budget = JSON.parse(readFileSync(join(WEB, 'budget.json'), 'utf8')) as BudgetJson;
    expect(budget.jsInitialGzKio, 'budget.json : jsInitialGzKio relevé sans justification').toBe(BUDGET_DEMARRAGE_KIO);
    const html = lire('index.html');
    const initiaux = [/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g, /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+\.js)"/g]
      .flatMap((motif) => [...html.matchAll(motif)].map((x) => x[1]))
      .filter((f): f is string => f !== undefined);
    const total = initiaux.reduce((somme, f) => somme + gzKio(f), 0);
    expect(total, `JavaScript de démarrage (gzip, Kio) : ${total.toFixed(1)}`).toBeLessThanOrEqual(BUDGET_DEMARRAGE_KIO);
  });

  it('budget dédié : budget.json a jsVue3dGzKio (entre 100 et 260), et le morceau 3D le respecte', () => {
    const budget = JSON.parse(readFileSync(join(WEB, 'budget.json'), 'utf8')) as BudgetJson;
    expect(typeof budget.jsVue3dGzKio, 'budget.json : clé jsVue3dGzKio').toBe('number');
    const limite = budget.jsVue3dGzKio ?? Number.NaN;
    expect(limite).toBeGreaterThanOrEqual(BORNES_BUDGET_3D_KIO.min);
    expect(limite).toBeLessThanOrEqual(BORNES_BUDGET_3D_KIO.max);
    const total = [...morceau3d].reduce((somme, f) => somme + gzKio(f), 0);
    expect(total, `morceau 3D (gzip, Kio) : ${total.toFixed(1)} pour un budget de ${String(limite)}`).toBeLessThanOrEqual(limite);
    expect(total, 'un morceau 3D sous 40 Kio ne contient pas three : le budget ne mesurerait rien').toBeGreaterThan(40);
  });

  it('scripts/budget.ts vérifie aussi le budget de la vue 3D', () => {
    const source = readFileSync(join(WEB, 'scripts', 'budget.ts'), 'utf8');
    expect(source).toContain('jsVue3dGzKio');
  });
});

describe('T71 : marge sous le plafond de la vue 3D', () => {
  it(`le morceau 3D garde au moins ${String(MARGE_3D_KIO)} Kio de marge sous jsVue3dGzKio (budget.json)`, () => {
    const budget = JSON.parse(readFileSync(join(WEB, 'budget.json'), 'utf8')) as BudgetJson;
    const plafond = budget.jsVue3dGzKio ?? Number.NaN;
    const total = [...morceau3d].reduce((somme, f) => somme + gzKio(f), 0);
    expect(morceau3d.size, 'morceau 3D introuvable').toBeGreaterThan(0);
    expect(total, `morceau 3D (gzip) : ${total.toFixed(2)} Kio, plafond ${String(plafond)} Kio, marge ${(plafond - total).toFixed(2)} Kio`).toBeLessThanOrEqual(plafond - MARGE_3D_KIO);
  });

  const estHors3d = (id: string): boolean => id.startsWith(DOSSIER_HORS_3D) || MODULES_HORS_3D.some((m) => id === join(WEB, ...m.split('/')));

  it('la couche des plants et le moteur de croissance ne reviennent pas dans le morceau 3D', () => {
    expect(modulesParFichier.size, 'modules du build non relevés').toBeGreaterThan(0);
    for (const f of morceau3d) {
      const intrus = (modulesParFichier.get(f) ?? []).filter(estHors3d).map((id) => relative(WEB, id).split(sep).join('/'));
      expect(intrus, `${f} porte des modules sortis du morceau 3D (T71)`).toEqual([]);
    }
  });

  it('témoin : ces modules sont toujours dans le build, hors du démarrage (chargés à la demande)', () => {
    for (const m of MODULES_HORS_3D) {
      const id = join(WEB, ...m.split('/'));
      const porteurs = [...modulesParFichier].filter(([, ids]) => ids.includes(id)).map(([f]) => f);
      expect(porteurs.length, `${m} absent du build`).toBeGreaterThan(0);
      for (const f of porteurs) expect(demarrage.has(f), `${m} dans le démarrage (${f})`).toBe(false);
    }
    expect([...modulesParFichier.values()].some((ids) => ids.some((id) => id.startsWith(DOSSIER_HORS_3D))), 'moteur de croissance absent du build').toBe(true);
  });
});

describe('T27 : précache hors ligne', () => {
  it('chaque fichier du morceau 3D est dans le précache de sw.js', () => {
    expect(morceau3d.size).toBeGreaterThan(0);
    const sw = lire('sw.js');
    for (const f of morceau3d) expect(sw.includes(f), `${f} absent du précache de sw.js`).toBe(true);
  });
});

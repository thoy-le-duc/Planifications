/**
 * Tests d'acceptation T27 — la vue 3D ne pèse rien au démarrage, a son propre budget et son
 * précache (docs/backlog/T27-vue-3d-prototype.md, Q29).
 *
 * ── Contrat pour le développeur ─────────────────────────────────────────────────────────────────
 *   - `three` et `@react-three/fiber` sont des dépendances de @planif/web ; `@react-three/drei`
 *     n'y est pas.
 *   - Le JavaScript de démarrage (index.html : scripts, modulepreload, et tout ce qu'ils importent
 *     statiquement) ne contient rien de three ni de react-three-fiber : le budget de démarrage
 *     `jsInitialGzKio` reste à 71 Kio, inchangé.
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
const BUDGET_DEMARRAGE_KIO = 71;
const BORNES_BUDGET_3D_KIO = { min: 100, max: 260 } as const;

interface BudgetJson {
  readonly jsInitialGzKio?: number;
  readonly jsVue3dGzKio?: number;
}

let sortie = '';
let erreurBuild: unknown;

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
    await viteBuild({ configFile: join(WEB, 'vite.config.ts'), root: WEB, mode: 'production', logLevel: 'silent', build: { outDir: sortie, emptyOutDir: true } });
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

  it('budget de démarrage inchangé (71 Kio) et poids du démarrage dessous', () => {
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

describe('T27 : précache hors ligne', () => {
  it('chaque fichier du morceau 3D est dans le précache de sw.js', () => {
    expect(morceau3d.size).toBeGreaterThan(0);
    const sw = lire('sw.js');
    for (const f of morceau3d) expect(sw.includes(f), `${f} absent du précache de sw.js`).toBe(true);
  });
});

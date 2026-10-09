/**
 * Tests d'acceptation T28b — l'éditeur de placement ne pèse rien au démarrage, a son propre
 * budget et son précache ; la CSP du build ouvre les images de la Géoplateforme et rien d'autre ;
 * les tuiles ne sont pas mises en cache (docs/backlog/T28b-editeur-placement.md).
 *
 * ── Contrat pour le développeur ─────────────────────────────────────────────────────────────────
 *   - L'éditeur (apps/web/src/ecrans/placement/) est chargé par import dynamique seulement, depuis
 *     l'écran Ferme : EcranFerme.tsx contient `import('../placement/index.ts')` et aucun import
 *     statique de '../placement/'.
 *   - Le morceau de l'éditeur : les fichiers JavaScript hors démarrage qui portent la couche
 *     « ORTHOIMAGERY.ORTHOPHOTOS » (tuiles.ts), avec ce qu'ils importent statiquement hors
 *     démarrage. Aucun fichier hors de ces porteurs ne les importe statiquement.
 *   - JavaScript de démarrage inchangé : `jsInitialGzKio` reste à 71 Kio, et rien de l'éditeur
 *     n'y entre (ni la couche, ni l'URL de la Géoplateforme).
 *   - Budget dédié `jsPlacementGzKio` dans apps/web/budget.json (chiffre mesuré + marge, justifié
 *     dans la PR ; entre 4 et 40 Kio), tenu par le morceau ; scripts/budget.ts le vérifie aussi.
 *   - Chaque fichier du morceau est dans le précache de sw.js (l'éditeur marche hors ligne dès la
 *     première visite) ; sw.js ne cite pas data.geopf.fr (aucune mise en cache des tuiles).
 *   - La balise CSP de dist/index.html porte `img-src 'self' https://data.geopf.fr`.
 *
 * Le build est lancé ici par l'API de Vite, vers un dossier temporaire (comme scripts/vue3d.test.ts).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build as viteBuild } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));

const MARQUEUR_PLACEMENT = 'ORTHOIMAGERY.ORTHOPHOTOS';
const BUDGET_DEMARRAGE_KIO = 71;
const BORNES_BUDGET_PLACEMENT_KIO = { min: 4, max: 40 } as const;

interface BudgetJson {
  readonly jsInitialGzKio?: number;
  readonly jsPlacementGzKio?: number;
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
let initiaux: string[] = [];
let demarrage = new Set<string>();
let porteurs: string[] = [];
let morceau = new Set<string>();

beforeAll(async () => {
  sortie = mkdtempSync(join(tmpdir(), 'planif-t28b-'));
  // Vitest pose NODE_ENV=test : sans ce retrait, Vite construirait React en mode développement
  // et fausserait tous les poids (voir builds.test.ts).
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
  initiaux = [/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g, /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+\.js)"/g]
    .flatMap((motif) => [...html.matchAll(motif)].map((x) => x[1]))
    .filter((f): f is string => f !== undefined);
  demarrage = fermeture(initiaux, presents);
  porteurs = [...presents].filter((f) => f !== 'sw.js' && !f.startsWith('workbox-') && !demarrage.has(f) && lire(f).includes(MARQUEUR_PLACEMENT));
  morceau = fermeture(porteurs, presents, demarrage);
}, 240_000);

afterAll(() => {
  if (sortie !== '') rmSync(sortie, { recursive: true, force: true });
});

describe('T28b : chargé à la demande, depuis l’écran Ferme', () => {
  it('EcranFerme.tsx charge l’éditeur par import dynamique, jamais par un import statique', () => {
    const source = readFileSync(join(WEB, 'src', 'ecrans', 'ferme', 'EcranFerme.tsx'), 'utf8');
    expect(source).toMatch(/import\(\s*['"]\.\.\/placement\/index\.ts['"]\s*\)/);
    expect(source).not.toMatch(/\bfrom\s+['"]\.\.\/placement\//);
    expect(source).not.toMatch(/^\s*import\s+['"]\.\.\/placement\//m);
  });

  it('le build de production réussit', () => {
    expect(erreurBuild, erreurBuild instanceof Error ? erreurBuild.message : '').toBeUndefined();
    expect(existsSync(join(sortie, 'index.html'))).toBe(true);
  });

  it('témoin : le build contient l’éditeur (couche de l’orthophoto), hors démarrage', () => {
    expect(porteurs.length, `aucun morceau hors démarrage ne porte « ${MARQUEUR_PLACEMENT} »`).toBeGreaterThan(0);
  });

  it('rien de l’éditeur dans le JavaScript de démarrage', () => {
    expect(demarrage.size).toBeGreaterThan(0);
    const fautifs = [...demarrage].filter((f) => lire(f).includes(MARQUEUR_PLACEMENT) || lire(f).includes('data.geopf.fr'));
    expect(fautifs, 'fichiers de démarrage qui contiennent l’éditeur').toEqual([]);
    const html = lire('index.html');
    for (const f of morceau) expect(html.includes(f), `${f} cité par index.html`).toBe(false);
  });

  it('aucun autre morceau n’importe l’éditeur statiquement', () => {
    const lesPorteurs = new Set(porteurs);
    for (const f of presents) {
      if (lesPorteurs.has(f)) continue;
      const fautifs = importsStatiques(f, presents).filter((c) => lesPorteurs.has(c));
      expect(fautifs, `${f} importe statiquement l’éditeur`).toEqual([]);
    }
  });
});

describe('T28b : budgets (build de production)', () => {
  const budget = (): BudgetJson => JSON.parse(readFileSync(join(WEB, 'budget.json'), 'utf8')) as BudgetJson;

  it('budget de démarrage inchangé (71 Kio) et poids du démarrage dessous', () => {
    expect(budget().jsInitialGzKio, 'budget.json : jsInitialGzKio relevé sans justification').toBe(BUDGET_DEMARRAGE_KIO);
    const total = initiaux.reduce((somme, f) => somme + gzKio(f), 0);
    expect(total, `JavaScript de démarrage (gzip, Kio) : ${total.toFixed(1)}`).toBeLessThanOrEqual(BUDGET_DEMARRAGE_KIO);
  });

  it('budget dédié : budget.json a jsPlacementGzKio (entre 4 et 40), et le morceau de l’éditeur le respecte', () => {
    const b = budget();
    expect(typeof b.jsPlacementGzKio, 'budget.json : clé jsPlacementGzKio').toBe('number');
    const limite = b.jsPlacementGzKio ?? Number.NaN;
    expect(limite).toBeGreaterThanOrEqual(BORNES_BUDGET_PLACEMENT_KIO.min);
    expect(limite).toBeLessThanOrEqual(BORNES_BUDGET_PLACEMENT_KIO.max);
    const total = [...morceau].reduce((somme, f) => somme + gzKio(f), 0);
    expect(total, `morceau de l’éditeur (gzip, Kio) : ${total.toFixed(1)} pour un budget de ${String(limite)}`).toBeLessThanOrEqual(limite);
    expect(total, 'un morceau de moins de 1 Kio ne contient pas l’éditeur : le budget ne mesurerait rien').toBeGreaterThan(1);
  });

  it('scripts/budget.ts vérifie aussi le budget de l’éditeur', () => {
    expect(readFileSync(join(WEB, 'scripts', 'budget.ts'), 'utf8')).toContain('jsPlacementGzKio');
  });
});

describe('T28b : hors ligne et sécurité', () => {
  it('chaque fichier du morceau de l’éditeur est dans le précache de sw.js', () => {
    expect(morceau.size).toBeGreaterThan(0);
    const sw = lire('sw.js');
    for (const f of morceau) expect(sw.includes(f), `${f} absent du précache de sw.js`).toBe(true);
  });

  it('les tuiles ne sont pas mises en cache : sw.js ne cite pas data.geopf.fr', () => {
    expect(lire('sw.js')).not.toContain('geopf');
  });

  it('la CSP de index.html ouvre les images de la Géoplateforme, et seulement les images', () => {
    const html = lire('index.html');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    const directives = new Map(
      csp
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .filter((d): d is [string, ...string[]] => d[0] !== undefined && d[0] !== '')
        .map(([nom, ...valeurs]) => [nom, valeurs]),
    );
    expect(directives.get('img-src')).toEqual(["'self'", 'https://data.geopf.fr']);
    for (const [nom, valeurs] of directives) if (nom !== 'img-src') expect(valeurs.join(' '), nom).not.toContain('geopf');
  });
});

describe('T28f : l’éditeur s’ouvre aussi depuis la vue 3D, sans bouger les morceaux', () => {
  const MARQUEURS_3D = ['WebGLRenderer', '__r3f'] as const;
  const sources = (dossier: string): string[] => {
    const racine = join(WEB, 'src');
    return fichiers(racine)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes('/test/') && f.startsWith(dossier))
      .map((f) => join(racine, ...f.split('/')));
  };

  it('une seule façon d’ouvrir l’éditeur dans le code : un seul import dynamique de placement/index.ts, hors du dossier placement', () => {
    const dynamiques = sources('').filter((f) => !f.includes(`${sep}placement${sep}`) && /import\(\s*['"][^'"]*placement\/index\.ts['"]\s*\)/.test(readFileSync(f, 'utf8')));
    expect(dynamiques.map((f) => relative(join(WEB, 'src'), f).split(sep).join('/')), 'fichiers qui chargent l’éditeur').toHaveLength(1);
  });

  it('ni la vue 3D ni l’écran Planches n’importent l’éditeur statiquement', () => {
    for (const f of [...sources('ecrans/plan3d/'), ...sources('ecrans/plan/')]) {
      const source = readFileSync(f, 'utf8');
      expect(source, `${f} : import statique de l’éditeur`).not.toMatch(/\bfrom\s+['"][^'"]*\/placement\//);
      expect(source, `${f} : import statique de l’éditeur`).not.toMatch(/^\s*import\s+['"][^'"]*\/placement\//m);
    }
  });

  it('la vue 3D porte le bouton et l’encart de T28f (textes du contrat)', () => {
    const source = sources('ecrans/plan3d/')
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const texte of ['Modifier le plan', 'Placez votre ferme sur la photo aérienne', 'Le gérant place la ferme depuis un ordinateur', 'modifier-plan', 'encart-placement']) {
      expect(source, `« ${texte} » absent de ecrans/plan3d/`).toContain(texte);
    }
  });

  it('le morceau de l’éditeur ne contient rien de three, le morceau 3D rien de l’orthophoto', () => {
    expect(morceau.size).toBeGreaterThan(0);
    for (const f of morceau) for (const m of MARQUEURS_3D) expect(lire(f).includes(m), `${f} (éditeur) contient « ${m} »`).toBe(false);
    const morceau3d = [...presents].filter((f) => f !== 'sw.js' && !f.startsWith('workbox-') && !demarrage.has(f) && MARQUEURS_3D.some((m) => lire(f).includes(m)));
    expect(morceau3d.length, 'témoin : un morceau 3D existe').toBeGreaterThan(0);
    for (const f of morceau3d) {
      expect(lire(f).includes(MARQUEUR_PLACEMENT), `${f} (3D) contient l’orthophoto`).toBe(false);
      // Un morceau partagé (repère de zone de @planif/core) peut servir aux deux : seul un porteur de l'éditeur est interdit.
      expect(importsStatiques(f, presents).filter((c) => porteurs.includes(c)), `${f} (3D) importe l’éditeur statiquement`).toEqual([]);
    }
  });

  it('budgets intacts : démarrage 71 Kio, morceau 3D et morceau de l’éditeur présents dans budget.json', () => {
    const b = JSON.parse(readFileSync(join(WEB, 'budget.json'), 'utf8')) as BudgetJson & { readonly jsVue3dGzKio?: number };
    expect(b.jsInitialGzKio).toBe(BUDGET_DEMARRAGE_KIO);
    expect(b.jsVue3dGzKio).toBe(226.5);
    expect(b.jsPlacementGzKio).toBe(18.5);
  });
});

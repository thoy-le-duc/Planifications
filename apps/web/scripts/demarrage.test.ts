/**
 * Tests d'acceptation T66 — alléger le démarrage : revenir sous 71,2 Kio avec de la marge
 * (docs/backlog/T66-alleger-demarrage.md, mesures : docs/mesures/T66.md).
 *
 * ── Contrat ───────────────────────────────────────────────────────────────────────────────────
 *   - Plafond : `jsInitialGzKio` de apps/web/budget.json revient à 71,2 Kio (relevé à 71,3 par
 *     T54 pour le seul nom haché du morceau `npk`).
 *   - Le JavaScript de démarrage mesuré (scripts et modulepreload de index.html, gzip, comme
 *     scripts/budget.ts) tient sous ce plafond, lu dans budget.json. La marge d'au moins 1 Kio
 *     (70,2 Kio au plus) était un critère ponctuel de T66, mesuré à la livraison
 *     (docs/mesures/T66.md) ; elle n'est pas un second budget, plus strict que budget.json, que
 *     chaque ticket devrait tenir (relecture de T66).
 *   - Garde-fou : rien des modules lourds chargés à la demande (export, phyto, fertilisation et
 *     npk, irrigation et vannes, vue 3D) n'entre dans le JavaScript de démarrage : ni leur code
 *     (dépendance statique), ni même leur nom de fichier (table de préchargement de Vite,
 *     `import()`). Un nom haché change à chaque correction du module et fait varier le démarrage
 *     de quelques octets (T54) : seuls les morceaux qui servent à chaque ouverture y sont cités.
 *   - Hors ligne : chaque morceau JavaScript de l'appli est dans le précache du service worker.
 *
 * Le build est lancé ici par l'API de Vite, vers un dossier temporaire (comme scripts/vue3d.test.ts) ;
 * les morceaux sont classés d'après les modules qu'ils contiennent (sortie de Rolldown), pas
 * d'après leur nom.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build as viteBuild, type Rollup } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const RACINE = fileURLToPath(new URL('../../../', import.meta.url));

/** Plafond du démarrage (T66 : retour à 71,2 Kio, relevé à 71,3 par T54). */
const PLAFOND_DEMARRAGE_KIO = 71.2;

/** Modules lourds, chargés à la demande seulement (chemins depuis la racine du dépôt). */
const MODULES_LOURDS: Readonly<Record<string, readonly string[]>> = {
  export: ['packages/core/src/export/', 'packages/sync/src/export', 'apps/web/src/ecrans/export/'],
  phyto: ['packages/core/src/phyto/', 'apps/web/src/ecrans/ferme/phyto/'],
  'fertilisation (npk)': ['packages/core/src/npk/', 'apps/web/src/ecrans/ferme/fertilisation/', 'apps/web/src/ecrans/aujourdhui/fertilisation/'],
  irrigation: ['packages/core/src/irrigation/', 'apps/web/src/ecrans/parcellaire/vannes/', 'apps/web/src/ecrans/aujourdhui/SaisieIrrigation'],
  // Pas tout plan3d/ : son point d'entrée (entree.ts, un `import()`) vit avec l'écran Planches.
  'vue 3D': ['apps/web/src/ecrans/plan3d/Vue3d.tsx', '/node_modules/three/', '/node_modules/@react-three/'],
};

interface BudgetJson {
  readonly jsInitialGzKio?: number;
}

let sortie = '';
let erreurBuild: unknown;
let morceaux: readonly Rollup.OutputChunk[] = [];
let demarrage: readonly string[] = [];

const lire = (fichier: string): string => readFileSync(join(sortie, ...fichier.split('/')), 'utf8');
const gz = (fichier: string): number => gzipSync(readFileSync(join(sortie, ...fichier.split('/')))).length;
const relatif = (id: string): string => id.replace(/\\/g, '/').replace(RACINE.replace(/\\/g, '/'), '');

/** Familles lourdes d'un morceau, d'après ses modules. */
function famillesLourdes(m: Rollup.OutputChunk): string[] {
  const ids = m.moduleIds.map(relatif);
  return Object.entries(MODULES_LOURDS)
    .filter(([, motifs]) => ids.some((id) => motifs.some((motif) => id.includes(motif))))
    .map(([famille]) => famille);
}

function sorties(resultat: unknown): Rollup.OutputChunk[] {
  const liste = (Array.isArray(resultat) ? resultat : [resultat]) as Rollup.RolldownOutput[];
  return liste.flatMap((r) => r.output).filter((s): s is Rollup.OutputChunk => s.type === 'chunk');
}

beforeAll(async () => {
  sortie = mkdtempSync(join(tmpdir(), 'planif-t66-'));
  // Vitest pose NODE_ENV=test : sans ce retrait, Vite construirait React en mode développement
  // (voir scripts/builds.test.ts).
  const nodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    const resultat = await viteBuild({ configFile: join(WEB, 'vite.config.ts'), root: WEB, mode: 'production', logLevel: 'silent', build: { outDir: sortie, emptyOutDir: true } });
    morceaux = sorties(resultat);
  } catch (e) {
    erreurBuild = e;
    return;
  } finally {
    if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;
  }
  const html = lire('index.html');
  demarrage = [/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g, /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+\.js)"/g]
    .flatMap((motif) => [...html.matchAll(motif)].map((x) => x[1]))
    .filter((f): f is string => f !== undefined);
}, 240_000);

afterAll(() => {
  if (sortie !== '') rmSync(sortie, { recursive: true, force: true });
});

describe('T66 : plafond et marge du démarrage', () => {
  it('le build de production réussit', () => {
    expect(erreurBuild, erreurBuild instanceof Error ? erreurBuild.message : '').toBeUndefined();
    expect(demarrage.length, 'scripts de index.html').toBeGreaterThan(0);
  });

  it('budget.json : jsInitialGzKio revient à 71,2 Kio', () => {
    const budget = JSON.parse(readFileSync(join(WEB, 'budget.json'), 'utf8')) as BudgetJson;
    expect(budget.jsInitialGzKio).toBe(PLAFOND_DEMARRAGE_KIO);
  });

  it('JavaScript de démarrage mesuré sous le plafond de budget.json', () => {
    const budget = JSON.parse(readFileSync(join(WEB, 'budget.json'), 'utf8')) as BudgetJson;
    expect(budget.jsInitialGzKio, 'budget.json : jsInitialGzKio').toBeTypeOf('number');
    const octets = demarrage.reduce((somme, f) => somme + gz(f), 0);
    const limite = (budget.jsInitialGzKio ?? 0) * 1024;
    const detail = demarrage.map((f) => `${f} ${String(gz(f))}`).join(', ');
    expect(octets, `démarrage ${String(octets)} octets gzip (${(octets / 1024).toFixed(2)} Kio) : ${detail} ; limite ${String(Math.floor(limite))}`).toBeLessThanOrEqual(limite);
  });
});

describe('T66 : garde-fou, rien de lourd au démarrage', () => {
  it('témoin : chaque famille de modules lourds est bien dans le build, hors démarrage', () => {
    const familles = new Set(morceaux.flatMap(famillesLourdes));
    expect([...familles].sort()).toEqual(Object.keys(MODULES_LOURDS).sort());
  });

  it('aucun module lourd dans le démarrage ni dans ses dépendances statiques', () => {
    const parNom = new Map(morceaux.map((m) => [m.fileName, m]));
    const vus = new Set<string>();
    const pile = [...demarrage];
    for (let f = pile.pop(); f !== undefined; f = pile.pop()) {
      if (vus.has(f)) continue;
      vus.add(f);
      pile.push(...(parNom.get(f)?.imports ?? []));
    }
    const fautifs = [...vus].flatMap((f) => {
      const m = parNom.get(f);
      return m === undefined ? [] : famillesLourdes(m).map((famille) => `${f} (${famille})`);
    });
    expect(fautifs, 'morceaux lourds chargés au démarrage').toEqual([]);
  });

  it('le JavaScript de démarrage ne cite le nom d’aucun morceau lourd (ni table de préchargement, ni import)', () => {
    const lourds = morceaux.filter((m) => famillesLourdes(m).length > 0);
    expect(lourds.length).toBeGreaterThan(0);
    const cites = demarrage.flatMap((f) => {
      const code = lire(f);
      return lourds.filter((m) => code.includes(m.fileName.split('/').pop() ?? m.fileName)).map((m) => `${f} cite ${m.fileName} (${famillesLourdes(m).join(', ')})`);
    });
    expect(cites, 'noms de morceaux lourds dans le JavaScript de démarrage').toEqual([]);
  });
});

describe('T66 : hors ligne', () => {
  it('chaque morceau JavaScript de l’appli est dans le précache du service worker', () => {
    const sw = lire('sw.js');
    const appli = morceaux.map((m) => m.fileName).filter((f) => !f.startsWith('assets/sqlite-annexe/'));
    expect(appli.length).toBeGreaterThan(0);
    const absents = appli.filter((f) => !sw.includes(`"${f}"`));
    expect(absents, 'morceaux absents du précache (sw.js)').toEqual([]);
  });
});

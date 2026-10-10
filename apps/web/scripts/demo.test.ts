/**
 * Tests d'acceptation T25 — build de la démo en ligne (contrat : src/demo/test/contrat.ts).
 *
 *   - `pnpm --filter @planif/web build:demo` → `apps/web/dist-demo/` : l'appli complète (index.html,
 *     sw.js, précache, manifeste) et le mode démo (bandeau, identifiants de démo) ;
 *   - le build de production n'en contient AUCUNE trace : ni le bandeau, ni les identifiants de
 *     démo, ni les noms des jeux de test.
 *
 * Comment ce test trouve les builds (comme builds.test.ts : il construit lui-même, un vieux dossier
 * ne prouverait rien) : `build:demo` écrit dist-demo/ (dossier que seul ce fichier utilise) ; le
 * build de production est refait par `pnpm exec vite build` vers un dossier TEMPORAIRE, pour ne pas
 * se heurter à builds.test.ts, que Vitest exécute en parallèle et qui vide et reconstruit `dist/`.
 * NODE_ENV et les variables de Vitest sont retirés de l'environnement des builds (sinon React
 * serait construit en mode développement).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEXTE_INVITATION } from '../src/demo/test/contrat-placement.ts';
import { DOSSIER_DEMO, FERME_DEMO, NOMS_DES_JEUX, TEXTE_BANDEAU, UTILISATEUR_DEMO } from '../src/demo/test/contrat.ts';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const RACINE_DEPOT = fileURLToPath(new URL('../../..', import.meta.url));
const DIST_DEMO = join(WEB, DOSSIER_DEMO);

interface Resultat {
  readonly ok: boolean;
  readonly sortie: string;
}

function pnpm(args: readonly string[]): Resultat {
  const env: NodeJS.ProcessEnv = {};
  for (const [cle, valeur] of Object.entries(process.env)) {
    if (cle === 'NODE_ENV' || cle.startsWith('VITEST')) continue;
    env[cle] = valeur;
  }
  const r = spawnSync('pnpm', args, { cwd: WEB, env, encoding: 'utf8' });
  return { ok: r.status === 0, sortie: `${r.stdout}\n${r.stderr}`.slice(-3000) };
}

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

const lire = (dossier: string, fichier: string): Buffer => readFileSync(join(dossier, ...fichier.split('/')));

/** Fichiers de `dossier` qui contiennent `texte` (UTF-8). */
function contenant(dossier: string, texte: string): string[] {
  return fichiers(dossier).filter((f) => lire(dossier, f).includes(texte, 0, 'utf8'));
}

const TRACES_DE_LA_DEMO: readonly string[] = [TEXTE_BANDEAU, UTILISATEUR_DEMO, FERME_DEMO, ...NOMS_DES_JEUX];

describe('T25 : build de la démo (dist-demo/)', () => {
  let build: Resultat;

  beforeAll(() => {
    build = pnpm(['run', 'build:demo']);
  }, 240_000);

  it('`pnpm --filter @planif/web build:demo` réussit', () => {
    expect(build.ok, build.sortie).toBe(true);
  });

  it('dist-demo/ est ignoré par git', () => {
    const r = spawnSync('git', ['check-ignore', '-q', `apps/web/${DOSSIER_DEMO}/`], { cwd: RACINE_DEPOT });
    expect(r.status, `git check-ignore apps/web/${DOSSIER_DEMO}/`).toBe(0);
  });

  it('contient l’appli installable : index.html, sw.js, manifeste, scripts présents', () => {
    const presents = fichiers(DIST_DEMO);
    expect(presents).toContain('index.html');
    expect(presents).toContain('sw.js');
    expect(presents.some((f) => f.endsWith('.webmanifest'))).toBe(true);
    const html = lire(DIST_DEMO, 'index.html').toString('utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g)].map((m) => m[1]);
    expect(scripts.length, 'scripts de index.html').toBeGreaterThan(0);
    for (const s of scripts) expect(presents, s).toContain(s);
    // Seule page : pas de pages de mesure ni de diagnostic dans la démo en ligne.
    expect(presents.filter((f) => f.endsWith('.html'))).toEqual(['index.html']);
  });

  it('contient le mode démo : bandeau « Démo — données fictives » et identifiants de démo', () => {
    expect(contenant(DIST_DEMO, TEXTE_BANDEAU), 'fichiers avec le bandeau').not.toEqual([]);
    expect(contenant(DIST_DEMO, UTILISATEUR_DEMO), 'fichiers avec l’utilisateur de démo').not.toEqual([]);
    expect(contenant(DIST_DEMO, FERME_DEMO), 'fichiers avec la ferme de démo').not.toEqual([]);
  });

  it('T28i : contient l’invitation « Essayez : ajoutez une serre et posez-la sur la photo »', () => {
    expect(contenant(DIST_DEMO, TEXTE_INVITATION), 'fichiers avec l’invitation').not.toEqual([]);
  });

  it('le service worker met le mode démo en précache (hors ligne)', () => {
    const sw = lire(DIST_DEMO, 'sw.js').toString('utf8');
    const morceaux = contenant(DIST_DEMO, TEXTE_BANDEAU).filter((f) => f.endsWith('.js') && f !== 'sw.js');
    expect(morceaux.length).toBeGreaterThan(0);
    for (const m of morceaux) expect(sw, `${m} dans le précache`).toContain(m.replace(/^.*\//, ''));
  });
});

describe('T25 : le build de production n’embarque rien de la démo', () => {
  let sortie: string;
  let build: Resultat;

  beforeAll(() => {
    sortie = mkdtempSync(join(tmpdir(), 'planif-t25-prod-'));
    build = pnpm(['exec', 'vite', 'build', '--outDir', sortie, '--emptyOutDir']);
  }, 240_000);

  afterAll(() => {
    rmSync(sortie, { recursive: true, force: true });
  });

  it('le build de production réussit (témoin)', () => {
    expect(build.ok, build.sortie).toBe(true);
    expect(fichiers(sortie)).toContain('index.html');
  });

  it('aucune trace de la démo : bandeau, identifiants de démo, noms des jeux de test', () => {
    const trouvees: string[] = [];
    for (const trace of TRACES_DE_LA_DEMO) for (const f of contenant(sortie, trace)) trouvees.push(`${f} : « ${trace} »`);
    expect(trouvees).toEqual([]);
  });

  it('T28i : l’invitation de la démo n’apparaît pas dans le build de l’appli', () => {
    expect(contenant(sortie, TEXTE_INVITATION)).toEqual([]);
    expect(contenant(sortie, 'Essayez : ajoutez')).toEqual([]);
  });
});

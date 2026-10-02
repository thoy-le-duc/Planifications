/**
 * Tests d'acceptation T25 — apps/web/vercel.json (le projet Vercel a pour dossier racine apps/web).
 *
 * Contrat :
 *   - `buildCommand` construit la démo : `pnpm build:demo` (ou `pnpm --filter @planif/web build:demo`) ;
 *   - `outputDirectory` = `dist-demo` ;
 *   - `installCommand` (facultatif) : si présent, il installe depuis la racine du monorepo (`pnpm install`) ;
 *   - en-têtes : `/sw.js` jamais mis en cache (Cache-Control contenant `no-cache`) ; `/assets/(.*)`
 *     immuable (`public`, `max-age=31536000`, `immutable`) ;
 *   - réécriture de toutes les routes vers `/index.html`, sans capturer `/assets` ni `sw.js`
 *     (ni les autres fichiers statiques : le motif exclut tout chemin avec une extension de fichier).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Entete {
  readonly key: string;
  readonly value: string;
}
interface RegleEntetes {
  readonly source: string;
  readonly headers: readonly Entete[];
}
interface Reecriture {
  readonly source: string;
  readonly destination: string;
}
interface Vercel {
  readonly buildCommand?: string;
  readonly installCommand?: string;
  readonly outputDirectory?: string;
  readonly headers?: readonly RegleEntetes[];
  readonly rewrites?: readonly Reecriture[];
}

const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8')) as Vercel;

/** Une `source` de Vercel est un motif path-to-regexp ; ici on ne gère que ce qu'il faut vérifier. */
function correspond(source: string, chemin: string): boolean {
  return new RegExp(`^${source}$`).test(chemin);
}

function cacheControl(chemin: string): string | undefined {
  for (const regle of vercel.headers ?? []) {
    if (!correspond(regle.source, chemin)) continue;
    const h = regle.headers.find((x) => x.key.toLowerCase() === 'cache-control');
    if (h !== undefined) return h.value;
  }
  return undefined;
}

describe('T25 : apps/web/vercel.json', () => {
  it('la commande de build construit la démo', () => {
    expect(vercel.buildCommand).toMatch(/build:demo/);
  });

  it('le dossier de sortie est dist-demo', () => {
    expect(vercel.outputDirectory).toBe('dist-demo');
  });

  it('sw.js n’est jamais mis en cache', () => {
    const valeur = cacheControl('/sw.js');
    expect(valeur, 'Cache-Control de /sw.js').toBeDefined();
    expect(valeur).toMatch(/no-cache|max-age=0|no-store/);
    expect(valeur).not.toMatch(/immutable/);
  });

  it('les fichiers de assets/ sont immuables', () => {
    const valeur = cacheControl('/assets/index-AbC123.js');
    expect(valeur, 'Cache-Control de /assets/…').toBeDefined();
    expect(valeur).toMatch(/immutable/);
    expect(valeur).toMatch(/max-age=31536000/);
    expect(cacheControl('/assets/sqlite/wa-sqlite-async-xyz.wasm'), 'sous-dossiers de assets/').toMatch(/immutable/);
  });

  it('les routes de l’appli sont réécrites vers /index.html', () => {
    const regles = vercel.rewrites ?? [];
    expect(regles.length).toBeGreaterThan(0);
    const reecrit = (chemin: string): boolean => regles.some((r) => r.destination === '/index.html' && correspond(r.source, chemin));
    for (const chemin of ['/', '/aujourdhui', '/plan', '/series/0192f0c1']) expect(reecrit(chemin), chemin).toBe(true);
  });

  it('la réécriture ne capture ni assets/, ni sw.js, ni les fichiers statiques', () => {
    const regles = (vercel.rewrites ?? []).filter((r) => r.destination === '/index.html');
    const capture = (chemin: string): boolean => regles.some((r) => correspond(r.source, chemin));
    for (const chemin of [
      '/sw.js',
      '/assets/index-AbC123.js',
      '/assets/sqlite/wa-sqlite-async-xyz.wasm',
      '/manifest.webmanifest',
      '/icone.svg',
      '/workbox-1a2b3c4d.js',
    ]) {
      expect(capture(chemin), chemin).toBe(false);
    }
  });
});

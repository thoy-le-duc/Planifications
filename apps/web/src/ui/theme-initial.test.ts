// @vitest-environment happy-dom
/**
 * T18 — public/theme-initial.js (thème posé avant le premier affichage, script classique du
 * <head>) : à jour avec les jetons (`pnpm --filter @planif/web jetons`), et le même résultat que
 * `initialiserTheme` (src/ui/theme.ts) dans chaque cas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHEMIN_THEME_INITIAL, themeInitialJs } from '../../scripts/theme-initial-contenu.ts';
import { initialiserTheme } from './theme.ts';

const RACINE_WEB = join(import.meta.dirname, '..', '..');

function preparer(stocke: string | null, telephoneSombre: boolean): void {
  localStorage.clear();
  if (stocke !== null) localStorage.setItem('planif.theme', stocke);
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: telephoneSombre && q.includes('dark'), media: q }));
}

function etat(): { theme: string | null; barre: string | null | undefined } {
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    barre: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public/theme-initial.js', () => {
  it('à jour avec les jetons (sinon : pnpm --filter @planif/web jetons)', () => {
    expect(readFileSync(join(RACINE_WEB, CHEMIN_THEME_INITIAL), 'utf8')).toBe(themeInitialJs());
  });

  it('chargé par index.html dans le <head>, après la balise theme-color et avant tout module', () => {
    const html = readFileSync(join(RACINE_WEB, 'index.html'), 'utf8');
    const script = html.search(/<script src="\/theme-initial\.js"><\/script>/);
    expect(script).toBeGreaterThan(html.search(/<meta\s+name="theme-color"/));
    expect(script).toBeLessThan(html.search(/<\/head>/));
    expect(script).toBeLessThan(html.search(/<script type="module"/));
  });

  for (const stocke of [null, 'clair', 'sombre', 'systeme', 'noir']) {
    for (const telephoneSombre of [false, true]) {
      it(`même résultat qu’initialiserTheme : mémorisé ${String(stocke)}, téléphone ${telephoneSombre ? 'sombre' : 'clair'}`, () => {
        preparer(stocke, telephoneSombre);
        initialiserTheme(document, localStorage);
        const attendu = etat();
        preparer(stocke, telephoneSombre);
        (0, eval)(themeInitialJs());
        expect(etat()).toEqual(attendu);
      });
    }
  }

  it('stockage qui lève : rien ne casse, le téléphone décide', () => {
    preparer(null, true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    expect(() => {
      (0, eval)(themeInitialJs());
    }).not.toThrow();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    vi.restoreAllMocks();
  });

  it('rien dans l’espace global', () => {
    preparer('sombre', false);
    const avant = new Set(Object.keys(globalThis));
    (0, eval)(themeInitialJs());
    expect(Object.keys(globalThis).filter((k) => !avant.has(k))).toEqual([]);
  });
});

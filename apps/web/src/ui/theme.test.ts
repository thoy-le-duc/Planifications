// @vitest-environment happy-dom
/**
 * Tests d'acceptation T18 — réglage « Apparence » (clair / sombre / comme le téléphone).
 *
 * ── API attendue (apps/web/src/ui/theme.ts, minuscule : il est dans le JavaScript de démarrage) ──
 *
 * CLE_THEME = 'planif.theme'                (clé du localStorage)
 * type ChoixTheme = 'systeme' | 'clair' | 'sombre'   ('systeme' = « Comme le téléphone », défaut)
 * type StockageTheme = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
 *
 * lireTheme(stockage): ChoixTheme
 *   Valeur mémorisée sous CLE_THEME ; absente, inconnue ou stockage qui lève → 'systeme'. Ne lève jamais.
 *
 * appliquerTheme(choix, doc: Document, stockage): void
 *   Pose le thème ET le mémorise : document.documentElement.dataset.theme = 'clair' | 'sombre'
 *   (attribut absent pour 'systeme'), <meta name="theme-color"> adapté (modifié en T18 après relecture : la barre
 *   du navigateur suit l'en-tête ; en mode forcé TOUTES les balises portent COULEURS.entete (clair)
 *   ou COULEURS_SOMBRES.entete (sombre) ; systeme : chaque balise retrouve la couleur de son
 *   thème, clair puis sombre ; index.html porte deux balises, avec `media`), et
 *   stockage.setItem(CLE_THEME, choix) (removeItem pour 'systeme'). Un stockage qui lève
 *   (mode privé, accès refusé) est toléré : le thème s'applique quand même, sans exception.
 *
 * initialiserTheme(doc, stockage): ChoixTheme
 *   Au démarrage, AVANT le premier rendu : lit le choix, applique dataset et meta, sans rien
 *   écrire dans le stockage. Renvoie le choix appliqué.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface ModuleTheme {
  readonly CLE_THEME: string;
  lireTheme(stockage: Pick<Storage, 'getItem'>): string;
  appliquerTheme(choix: string, doc: Document, stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): void;
  initialiserTheme(doc: Document, stockage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): string;
}

interface ModuleJetons {
  readonly COULEURS: Readonly<Record<string, string>>;
  readonly COULEURS_SOMBRES: Readonly<Record<string, string>>;
}

const CHEMIN_THEME = './theme.ts';
const CHEMIN_JETONS = './jetons.ts';

/** index.html (T18) : une balise par thème du téléphone ; le JS ne les touche qu'en mode forcé. */
const METAS =
  '<meta name="theme-color" content="#1F4D3A" media="(prefers-color-scheme: light)">' +
  '<meta name="theme-color" content="#1C3A2C" media="(prefers-color-scheme: dark)">';

let t: ModuleTheme;
let j: ModuleJetons;

beforeAll(async () => {
  t = (await import(/* @vite-ignore */ CHEMIN_THEME)) as ModuleTheme;
  j = (await import(/* @vite-ignore */ CHEMIN_JETONS)) as ModuleJetons;
});

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = METAS;
});

function stockageMemoire(initial: Record<string, string> = {}) {
  const valeurs = new Map(Object.entries(initial));
  return {
    valeurs,
    getItem: (k: string) => valeurs.get(k) ?? null,
    setItem: (k: string, v: string) => void valeurs.set(k, v),
    removeItem: (k: string) => void valeurs.delete(k),
  };
}

function stockageQuiLeve() {
  const erreur = () => {
    throw new DOMException('Accès refusé', 'SecurityError');
  };
  return { getItem: erreur, setItem: erreur, removeItem: erreur };
}

const metas = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')?.toUpperCase());
const toutes = (c: string | undefined) => [c?.toUpperCase(), c?.toUpperCase()];

describe('lireTheme', () => {
  it('la clé est planif.theme', () => {
    expect(t.CLE_THEME).toBe('planif.theme');
  });

  it('rien de mémorisé → « Comme le téléphone » (systeme)', () => {
    expect(t.lireTheme(stockageMemoire())).toBe('systeme');
  });

  it('choix mémorisé : clair, sombre, systeme', () => {
    for (const choix of ['clair', 'sombre', 'systeme']) expect(t.lireTheme(stockageMemoire({ 'planif.theme': choix }))).toBe(choix);
  });

  it('valeur inconnue → systeme', () => {
    for (const bizarre of ['', 'noir', 'SOMBRE', 'dark', '{"theme":"sombre"}', 'undefined']) {
      expect(t.lireTheme(stockageMemoire({ 'planif.theme': bizarre })), `« ${bizarre} »`).toBe('systeme');
    }
  });

  it('stockage qui lève → systeme, sans exception', () => {
    expect(t.lireTheme(stockageQuiLeve())).toBe('systeme');
  });
});

describe('appliquerTheme', () => {
  it('sombre : data-theme="sombre", meta theme-color sombre, choix mémorisé', () => {
    const s = stockageMemoire();
    t.appliquerTheme('sombre', document, s);
    expect(document.documentElement.dataset.theme).toBe('sombre');
    expect(metas()).toEqual(toutes(j.COULEURS_SOMBRES.entete));
    expect(s.valeurs.get('planif.theme')).toBe('sombre');
  });

  it('clair : data-theme="clair", meta theme-color clair (forêt), choix mémorisé', () => {
    const s = stockageMemoire();
    document.documentElement.dataset.theme = 'sombre';
    t.appliquerTheme('clair', document, s);
    expect(document.documentElement.dataset.theme).toBe('clair');
    expect(metas()).toEqual(toutes(j.COULEURS.entete));
    expect(s.valeurs.get('planif.theme')).toBe('clair');
  });

  it('systeme : attribut data-theme absent, plus rien de mémorisé', () => {
    const s = stockageMemoire({ 'planif.theme': 'sombre' });
    t.appliquerTheme('sombre', document, s);
    t.appliquerTheme('systeme', document, s);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(s.valeurs.has('planif.theme')).toBe(false);
    // Chaque balise garde (ou retrouve) la couleur de son thème : clair puis sombre.
    expect(metas()).toEqual([j.COULEURS.entete?.toUpperCase(), j.COULEURS_SOMBRES.entete?.toUpperCase()]);
  });

  it('stockage qui lève : le thème s’applique quand même, sans exception', () => {
    expect(() => {
      t.appliquerTheme('sombre', document, stockageQuiLeve());
    }).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('sombre');
  });

  it('index.html : deux balises theme-color par thème du téléphone (clair d’abord), couleur d’en-tête', () => {
    const html = readFileSync(join(import.meta.dirname, '..', '..', 'index.html'), 'utf8');
    const balises = [...html.matchAll(/<meta\s+name="theme-color"[^>]*>/gi)].map((m) => m[0]);
    expect(balises, 'deux balises theme-color').toHaveLength(2);
    const [clair, sombre] = balises;
    expect(clair).toMatch(/content="([^"]+)"\s+media="\(prefers-color-scheme:\s*light\)"/i);
    expect(sombre).toMatch(/content="([^"]+)"\s+media="\(prefers-color-scheme:\s*dark\)"/i);
    expect(/content="([^"]+)"/.exec(clair ?? '')?.[1]?.toUpperCase()).toBe(j.COULEURS.entete?.toUpperCase());
    expect(/content="([^"]+)"/.exec(sombre ?? '')?.[1]?.toUpperCase()).toBe(j.COULEURS_SOMBRES.entete?.toUpperCase());
  });

  it('page sans meta theme-color : pas d’exception', () => {
    document.head.innerHTML = '';
    expect(() => {
      t.appliquerTheme('sombre', document, stockageMemoire());
    }).not.toThrow();
  });
});

describe('initialiserTheme (démarrage, avant le premier rendu)', () => {
  it('applique le choix mémorisé sans rien écrire', () => {
    const s = stockageMemoire({ 'planif.theme': 'sombre' });
    const ecrire = vi.spyOn(s, 'setItem');
    const effacer = vi.spyOn(s, 'removeItem');
    expect(t.initialiserTheme(document, s)).toBe('sombre');
    expect(document.documentElement.dataset.theme).toBe('sombre');
    expect(metas()).toEqual(toutes(j.COULEURS_SOMBRES.entete));
    expect(ecrire).not.toHaveBeenCalled();
    expect(effacer).not.toHaveBeenCalled();
  });

  it('rien de mémorisé, valeur inconnue ou stockage qui lève : « Comme le téléphone », pas d’attribut', () => {
    for (const s of [stockageMemoire(), stockageMemoire({ 'planif.theme': 'noir' }), stockageQuiLeve()]) {
      document.documentElement.removeAttribute('data-theme');
      expect(t.initialiserTheme(document, s)).toBe('systeme');
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    }
  });
});

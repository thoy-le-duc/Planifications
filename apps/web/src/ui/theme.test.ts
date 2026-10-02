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
 *   (attribut absent pour 'systeme'), <meta name="theme-color"> adapté (clair : COULEURS.foret ;
 *   sombre : COULEURS_SOMBRES.foret ; systeme : l'une des deux, selon le téléphone), et
 *   stockage.setItem(CLE_THEME, choix) (removeItem pour 'systeme'). Un stockage qui lève
 *   (mode privé, accès refusé) est toléré : le thème s'applique quand même, sans exception.
 *
 * initialiserTheme(doc, stockage): ChoixTheme
 *   Au démarrage, AVANT le premier rendu : lit le choix, applique dataset et meta, sans rien
 *   écrire dans le stockage. Renvoie le choix appliqué.
 */
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

let t: ModuleTheme;
let j: ModuleJetons;

beforeAll(async () => {
  t = (await import(/* @vite-ignore */ CHEMIN_THEME)) as ModuleTheme;
  j = (await import(/* @vite-ignore */ CHEMIN_JETONS)) as ModuleJetons;
});

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="#1F4D3A">';
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

const metaCouleur = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content')?.toUpperCase();

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
    expect(metaCouleur()).toBe(j.COULEURS_SOMBRES.foret?.toUpperCase());
    expect(s.valeurs.get('planif.theme')).toBe('sombre');
  });

  it('clair : data-theme="clair", meta theme-color clair (forêt), choix mémorisé', () => {
    const s = stockageMemoire();
    document.documentElement.dataset.theme = 'sombre';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', j.COULEURS_SOMBRES.foret ?? '');
    t.appliquerTheme('clair', document, s);
    expect(document.documentElement.dataset.theme).toBe('clair');
    expect(metaCouleur()).toBe(j.COULEURS.foret?.toUpperCase());
    expect(s.valeurs.get('planif.theme')).toBe('clair');
  });

  it('systeme : attribut data-theme absent, plus rien de mémorisé', () => {
    const s = stockageMemoire({ 'planif.theme': 'sombre' });
    document.documentElement.dataset.theme = 'sombre';
    t.appliquerTheme('systeme', document, s);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(s.valeurs.has('planif.theme')).toBe(false);
    expect([j.COULEURS.foret?.toUpperCase(), j.COULEURS_SOMBRES.foret?.toUpperCase()]).toContain(metaCouleur());
  });

  it('stockage qui lève : le thème s’applique quand même, sans exception', () => {
    expect(() => {
      t.appliquerTheme('sombre', document, stockageQuiLeve());
    }).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('sombre');
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
    expect(metaCouleur()).toBe(j.COULEURS_SOMBRES.foret?.toUpperCase());
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

/**
 * Tests d'acceptation T28b — tuiles WMTS de la Géoplateforme et passage repère local ↔ écran,
 * en fonctions pures, sans bibliothèque de carte (docs/backlog/T28b-editeur-placement.md).
 * Contrat : ./test/contrat.ts (« Fond », « Vue »).
 *
 * Points connus (Web Mercator standard, celui d'OpenStreetMap ; le jeu PM de l'IGN le suit) :
 *   - 44° N, 1,5° E (origine des exemples du modèle), zoom 19 : colonne 264 328, ligne 190 641,
 *     pixel (136,53 ; 116,05) dans la tuile ;
 *   - Notre-Dame de Paris, 48,8530° N, 2,3499° E, zoom 19 : colonne 265 566, ligne 180 377,
 *     pixel (74,22 ; 238,50) ;
 *   - 0°, 0°, zoom 1 : coin de la tuile (1, 1), pixel (0, 0).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { versGeographique, versLocal } from '@planif/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ModuleTuiles, Point, VueCarte } from './test/contrat.ts';

const CHEMIN = './tuiles.ts';
let t: ModuleTuiles;

beforeAll(async () => {
  t = (await import(/* @vite-ignore */ CHEMIN)) as ModuleTuiles;
});

const ORIGINE = { latitude: 44, longitude: 1.5 };

describe('T28b : constantes du fond IGN', () => {
  it('Géoplateforme, orthophoto, jeu PM, tuiles de 256 px, zoom 19, mention « © IGN »', () => {
    expect(t.URL_WMTS).toBe('https://data.geopf.fr/wmts');
    expect(t.COUCHE_ORTHO).toBe('ORTHOIMAGERY.ORTHOPHOTOS');
    expect(t.JEU_TUILES).toBe('PM');
    expect(t.TAILLE_TUILE_PX).toBe(256);
    expect(t.ZOOM_TUILES_MAX).toBe(19);
    expect(t.ZOOM_INITIAL).toBe(19);
    expect(t.MENTION_IGN).toBe('© IGN');
  });
});

describe('T28b : point connu → tuile et pixel', () => {
  it.each([
    { nom: '44° N 1,5° E, zoom 19', position: ORIGINE, zoom: 19, colonne: 264_328, ligne: 190_641, px: 136.533, py: 116.049 },
    { nom: 'Notre-Dame de Paris, zoom 19', position: { latitude: 48.853, longitude: 2.3499 }, zoom: 19, colonne: 265_566, ligne: 180_377, px: 74.22, py: 238.505 },
    { nom: '44° N 1,5° E, zoom 15', position: ORIGINE, zoom: 15, colonne: 16_520, ligne: 11_915, px: 136.533, py: 23.253 },
    { nom: '0° 0°, zoom 1', position: { latitude: 0, longitude: 0 }, zoom: 1, colonne: 1, ligne: 1, px: 0, py: 0 },
  ])('$nom', ({ position, zoom, colonne, ligne, px, py }) => {
    const r = t.tuileDe(position, zoom);
    expect(r).toMatchObject({ zoom, colonne, ligne });
    expect(r.px).toBeCloseTo(px, 1);
    expect(r.py).toBeCloseTo(py, 1);
    const monde = t.pixelMonde(position, zoom);
    expect(monde.x).toBeCloseTo(colonne * 256 + px, 1);
    expect(monde.y).toBeCloseTo(ligne * 256 + py, 1);
  });

  it('le pixel dans la tuile est dans [0, 256[', () => {
    for (const lon of [-4.2, 0, 1.5, 7.75]) {
      for (const lat of [42.1, 44, 48.853, 51]) {
        const r = t.tuileDe({ latitude: lat, longitude: lon }, 19);
        expect(r.px).toBeGreaterThanOrEqual(0);
        expect(r.px).toBeLessThan(256);
        expect(r.py).toBeGreaterThanOrEqual(0);
        expect(r.py).toBeLessThan(256);
        expect(Number.isInteger(r.colonne) && Number.isInteger(r.ligne)).toBe(true);
      }
    }
  });
});

describe('T28b : URL d’une tuile (WMTS KVP, sans clé)', () => {
  it('Géoplateforme, couche orthophoto, jeu PM, ligne et colonne de la tuile', () => {
    const url = new URL(t.urlTuile({ zoom: 19, colonne: 264_328, ligne: 190_641 }));
    expect(url.origin).toBe('https://data.geopf.fr');
    expect(url.pathname).toBe('/wmts');
    const p = new Map([...url.searchParams].map(([k, v]) => [k.toUpperCase(), v]));
    expect(p.get('SERVICE')).toBe('WMTS');
    expect(p.get('REQUEST')).toBe('GetTile');
    expect(p.get('VERSION')).toBe('1.0.0');
    expect(p.get('LAYER')).toBe('ORTHOIMAGERY.ORTHOPHOTOS');
    expect(p.get('STYLE')).toBe('normal');
    expect(p.get('TILEMATRIXSET')).toBe('PM');
    expect(p.get('TILEMATRIX')).toBe('19');
    expect(p.get('TILEROW')).toBe('190641');
    expect(p.get('TILECOL')).toBe('264328');
    expect(p.get('FORMAT')).toBe('image/jpeg');
    // Service sans clé : rien d'autre que ces dix paramètres.
    expect([...p.keys()].sort()).toEqual(['FORMAT', 'LAYER', 'REQUEST', 'SERVICE', 'STYLE', 'TILECOL', 'TILEMATRIX', 'TILEMATRIXSET', 'TILEROW', 'VERSION']);
  });
});

describe('T28b : écran ↔ repère local', () => {
  const vue = (o: Partial<VueCarte> = {}): VueCarte => ({ origine: ORIGINE, centre: { x: 0, y: 0 }, zoom: 19, largeurPx: 1280, hauteurPx: 800, ...o });

  it('mètres par pixel : 2πR·cos φ / (256·2^z) (≈ 0,2148 m à 44° N, zoom 19)', () => {
    expect(t.metresParPixel(44, 19)).toBeCloseTo(0.214782, 5);
    expect(t.metresParPixel(44, 18)).toBeCloseTo(2 * 0.214782, 5);
    expect(t.metresParPixel(0, 0)).toBeCloseTo(156_543.034, 2);
  });

  it('le centre de la vue est au milieu de l’écran ; nord en haut, est à droite', () => {
    const v = vue({ centre: { x: 30, y: -12 } });
    const milieu = t.versEcran(v, { x: 30, y: -12 });
    expect(milieu.x).toBeCloseTo(640, 6);
    expect(milieu.y).toBeCloseTo(400, 6);
    const mpp = t.metresParPixel(44, 19);
    const est = t.versEcran(v, { x: 30 + 100 * mpp, y: -12 });
    expect(est.x).toBeCloseTo(740, 6);
    expect(est.y).toBeCloseTo(400, 6);
    const nord = t.versEcran(v, { x: 30, y: -12 + 50 * mpp });
    expect(nord.x).toBeCloseTo(640, 6);
    expect(nord.y).toBeCloseTo(350, 6);
  });

  it('aller-retour pixel → mètres → pixel, et mètres → pixel → mètres (à 1 mm)', () => {
    for (const v of [vue(), vue({ centre: { x: 2500, y: -1800 }, zoom: 17 }), vue({ zoom: 21, largeurPx: 390, hauteurPx: 700 })]) {
      for (const pixel of [
        { x: 0, y: 0 },
        { x: 123.4, y: 567.8 },
        { x: v.largeurPx, y: v.hauteurPx },
      ]) {
        const retour = t.versEcran(v, t.depuisEcran(v, pixel));
        expect(retour.x).toBeCloseTo(pixel.x, 6);
        expect(retour.y).toBeCloseTo(pixel.y, 6);
      }
      for (const point of [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: -37.25, y: 4.5 },
      ]) {
        const retour = t.depuisEcran(v, t.versEcran(v, point));
        expect(Math.abs(retour.x - point.x)).toBeLessThan(0.001);
        expect(Math.abs(retour.y - point.y)).toBeLessThan(0.001);
      }
    }
  });
});

describe('T28b : tuiles visibles, posées au bon endroit', () => {
  const vue = (o: Partial<VueCarte> = {}): VueCarte => ({ origine: ORIGINE, centre: { x: 0, y: 0 }, zoom: 19, largeurPx: 1280, hauteurPx: 800, ...o });

  /** Pixel de l'écran où la photo montre le point géographique `p`, d'après les tuiles posées. */
  function pixelSurLaPhoto(v: VueCarte, p: { latitude: number; longitude: number }): Point {
    const zoomTuiles = Math.min(v.zoom, t.ZOOM_TUILES_MAX);
    const cible = t.tuileDe(p, zoomTuiles);
    const tuile = t.tuilesVisibles(v).find((x) => x.colonne === cible.colonne && x.ligne === cible.ligne);
    expect(tuile, `tuile ${String(cible.colonne)}/${String(cible.ligne)} absente des tuiles visibles`).toBeDefined();
    if (tuile === undefined) throw new Error('tuile absente');
    expect(tuile.zoom).toBe(zoomTuiles);
    return { x: tuile.x + (cible.px * tuile.largeur) / 256, y: tuile.y + (cible.py * tuile.hauteur) / 256 };
  }

  it.each([
    { nom: 'à l’origine', centre: { x: 0, y: 0 }, zoom: 19, decalages: [0, 0] },
    { nom: 'à 3 km au nord-est de l’origine', centre: { x: 2100, y: 2100 }, zoom: 19, decalages: [2100, 2100] },
    { nom: 'à 3 km au sud-ouest, zoom 17', centre: { x: -2100, y: -2100 }, zoom: 17, decalages: [-2100, -2100] },
    { nom: 'zoom 20 (tuiles de 19 agrandies)', centre: { x: 10, y: 20 }, zoom: 20, decalages: [10, 20] },
  ])('un point montré par la photo tombe sur son pixel à 1 px près : $nom', ({ centre, zoom, decalages }) => {
    const v = vue({ centre, zoom });
    const [dx = 0, dy = 0] = decalages;
    for (const [ex, ey] of [
      [0, 0],
      [40, 25],
      [-55, 30],
      [60, -35],
    ] as const) {
      const local = { x: dx + ex, y: dy + ey };
      const geo = versGeographique(ORIGINE, local);
      const surPhoto = pixelSurLaPhoto(v, geo);
      const attendu = t.versEcran(v, versLocal(ORIGINE, geo));
      expect(Math.abs(surPhoto.x - attendu.x), `x à (${String(local.x)}, ${String(local.y)})`).toBeLessThanOrEqual(1);
      expect(Math.abs(surPhoto.y - attendu.y), `y à (${String(local.x)}, ${String(local.y)})`).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    { largeurPx: 1280, hauteurPx: 800, zoom: 19 },
    { largeurPx: 1920, hauteurPx: 1080, zoom: 18 },
    { largeurPx: 390, hauteurPx: 844, zoom: 20 },
  ])('l’écran $largeurPx × $hauteurPx (zoom $zoom) est couvert, sans tuile en double ni hors écran', ({ largeurPx, hauteurPx, zoom }) => {
    const v = vue({ largeurPx, hauteurPx, zoom, centre: { x: 13.7, y: -8.2 } });
    const tuiles = t.tuilesVisibles(v);
    const cles = tuiles.map((x) => `${String(x.zoom)}/${String(x.colonne)}/${String(x.ligne)}`);
    expect(new Set(cles).size, 'tuile en double').toBe(cles.length);
    const cote = 256 * 2 ** Math.max(0, zoom - t.ZOOM_TUILES_MAX);
    expect(tuiles.length).toBeLessThanOrEqual((Math.ceil(largeurPx / cote) + 2) * (Math.ceil(hauteurPx / cote) + 2));
    for (const x of tuiles) {
      expect(x.url).toBe(t.urlTuile(x));
      expect(x.zoom).toBe(Math.min(zoom, t.ZOOM_TUILES_MAX));
      expect(x.largeur).toBeGreaterThan(cote - 2);
      expect(x.largeur).toBeLessThan(cote + 2);
      expect(x.hauteur).toBeGreaterThan(cote - 2);
      expect(x.hauteur).toBeLessThan(cote + 2);
      const dedans = x.x < largeurPx && x.x + x.largeur > 0 && x.y < hauteurPx && x.y + x.hauteur > 0;
      expect(dedans, `tuile ${String(x.colonne)}/${String(x.ligne)} hors écran`).toBe(true);
    }
    for (let px = 0.5; px < largeurPx; px += 37) {
      for (let py = 0.5; py < hauteurPx; py += 29) {
        const couvert = tuiles.some((x) => px >= x.x - 0.5 && px <= x.x + x.largeur + 0.5 && py >= x.y - 0.5 && py <= x.y + x.hauteur + 0.5);
        expect(couvert, `pixel (${String(px)}, ${String(py)}) sans photo`).toBe(true);
      }
    }
  });
});

describe('T28b : sans bibliothèque de carte', () => {
  it('tuiles.ts n’importe ni React, ni bibliothèque de carte, ni réseau', () => {
    const source = readFileSync(join(import.meta.dirname, 'tuiles.ts'), 'utf8');
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2] ?? '');
    for (const i of imports) expect(['@planif/core'].includes(i) || i.startsWith('./') || i.startsWith('../'), `import « ${i} »`).toBe(true);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|leaflet|maplibre|openlayers|\bol\//i);
  });

  it('@planif/web ne dépend d’aucune bibliothèque de carte', () => {
    const paquet = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const noms = Object.keys({ ...paquet.dependencies, ...paquet.devDependencies });
    for (const n of noms) expect(n, `dépendance ${n}`).not.toMatch(/leaflet|maplibre|mapbox|^ol$|openlayers|proj4|deck\.gl/i);
  });
});

/**
 * Tests d'acceptation T40 — l'appli s'installe sur le téléphone (docs/backlog/T40-installer-appli.md).
 *
 * ── Contrat ──
 *   - Le manifeste de l'appli vit dans `scripts/manifeste.ts` (export `MANIFESTE`), et
 *     vite.config.ts le passe tel quel à VitePWA (`manifest: MANIFESTE`).
 *   - `display: 'standalone'`, `id`, `scope` et `start_url` posés (même racine `/`).
 *   - Icônes PNG 192 × 192 et 512 × 512 (`purpose` « any ») et au moins une icône `maskable`
 *     (512 × 512, fond plein : aucun coin transparent, le téléphone découpe lui-même la forme).
 *   - Chaque icône est un vrai fichier PNG de apps/web/public/, aux dimensions annoncées.
 *   - index.html : `<link rel="apple-touch-icon">` vers un PNG 180 × 180 de public/ (fond plein,
 *     iOS arrondit lui-même), métas iOS `apple-mobile-web-app-capable` (« yes ») et
 *     `apple-mobile-web-app-title` (titre court, celui du manifeste), et le lien du manifeste
 *     reste injecté par vite-plugin-pwa (vérifié dans le vrai navigateur, e2e/installation.e2e.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MANIFESTE } from './manifeste.ts';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const HTML = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const CONFIG_VITE = readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf8');

interface Icone {
  readonly src: string;
  readonly sizes?: string;
  readonly type?: string;
  readonly purpose?: string;
}

interface Png {
  readonly largeur: number;
  readonly hauteur: number;
  /** Alpha du pixel (x, y), 255 si l'image n'a pas de canal alpha. */
  readonly alpha: (x: number, y: number) => number;
}

const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lecture minimale d'un PNG 8 bits (RGB ou RGBA, non entrelacé) : dimensions et canal alpha. */
function lirePng(chemin: string): Png {
  const octets = readFileSync(chemin);
  expect(octets.subarray(0, 8).equals(SIGNATURE_PNG), `${chemin} : signature PNG`).toBe(true);
  const largeur = octets.readUInt32BE(16);
  const hauteur = octets.readUInt32BE(20);
  const profondeur = octets[24];
  const couleur = octets[25];
  const entrelace = octets[28];
  const morceaux: Buffer[] = [];
  for (let i = 8; i < octets.length; ) {
    const longueur = octets.readUInt32BE(i);
    const type = octets.toString('ascii', i + 4, i + 8);
    if (type === 'IDAT') morceaux.push(octets.subarray(i + 8, i + 8 + longueur));
    i += 12 + longueur;
  }
  if (profondeur !== 8 || (couleur !== 2 && couleur !== 6) || entrelace !== 0) {
    // Autre format : les dimensions suffisent, l'alpha est réputé plein (pas de transparence lue).
    return { largeur, hauteur, alpha: () => 255 };
  }
  const canaux = couleur === 6 ? 4 : 3;
  const brut = inflateSync(Buffer.concat(morceaux));
  const ligne = largeur * canaux;
  const pixels = Buffer.alloc(ligne * hauteur);
  const precedente = Buffer.alloc(ligne);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (ligne + 1)];
    const source = brut.subarray(y * (ligne + 1) + 1, (y + 1) * (ligne + 1));
    const cible = pixels.subarray(y * ligne, (y + 1) * ligne);
    const haut = y === 0 ? precedente : pixels.subarray((y - 1) * ligne, y * ligne);
    for (let x = 0; x < ligne; x++) {
      const a = x >= canaux ? (cible[x - canaux] ?? 0) : 0;
      const b = haut[x] ?? 0;
      const c = x >= canaux ? (haut[x - canaux] ?? 0) : 0;
      const s = source[x] ?? 0;
      let v: number;
      if (filtre === 0) v = s;
      else if (filtre === 1) v = s + a;
      else if (filtre === 2) v = s + b;
      else if (filtre === 3) v = s + Math.floor((a + b) / 2);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = s + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cible[x] = v & 0xff;
    }
  }
  return {
    largeur,
    hauteur,
    alpha: (x, y) => (canaux === 4 ? (pixels[(y * largeur + x) * 4 + 3] ?? 0) : 255),
  };
}

function cheminPublic(src: string): string {
  return PUBLIC + src.replace(/^\//, '');
}

function attributs(balise: string): Record<string, string> {
  return Object.fromEntries([...balise.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1] ?? '', m[2] ?? '']));
}

function balises(nom: string): Record<string, string>[] {
  return [...HTML.matchAll(new RegExp(`<${nom}\\b[^>]*>`, 'g'))].map((m) => attributs(m[0]));
}

const icones = (MANIFESTE.icons ?? []) as readonly Icone[];
const buts = (i: Icone): string[] => (i.purpose ?? 'any').split(/\s+/);

describe('T40 : manifeste installable', () => {
  it('vite.config.ts passe MANIFESTE à VitePWA', () => {
    expect(CONFIG_VITE).toMatch(/import\s*\{[^}]*\bMANIFESTE\b[^}]*\}\s*from\s*'\.\/scripts\/manifeste\.ts'/);
    expect(CONFIG_VITE).toMatch(/manifest:\s*MANIFESTE\b/);
  });

  it('display standalone, id, scope et start_url sur la racine', () => {
    expect(MANIFESTE.display).toBe('standalone');
    expect(MANIFESTE.id).toBe('/');
    expect(MANIFESTE.scope).toBe('/');
    expect(MANIFESTE.start_url).toBe('/');
    expect(MANIFESTE.name).toBe('Planifications');
    expect(MANIFESTE.short_name).toBeTruthy();
  });

  it('icônes PNG 192 et 512 « any », et une maskable 512', () => {
    const png = icones.filter((i) => i.type === 'image/png');
    const any = (taille: string) => png.find((i) => i.sizes === taille && buts(i).includes('any'));
    expect(any('192x192'), 'icône PNG 192 any').toBeDefined();
    expect(any('512x512'), 'icône PNG 512 any').toBeDefined();
    expect(png.find((i) => i.sizes === '512x512' && buts(i).includes('maskable')), 'icône PNG 512 maskable').toBeDefined();
  });

  it('chaque icône PNG est un fichier de public/ aux dimensions annoncées', () => {
    for (const icone of icones.filter((i) => i.type === 'image/png')) {
      const [l, h] = (icone.sizes ?? '').split('x').map(Number);
      const png = lirePng(cheminPublic(icone.src));
      expect([png.largeur, png.hauteur], icone.src).toEqual([l, h]);
    }
  });

  it('icône maskable à fond plein : coins et bords opaques', () => {
    for (const icone of icones.filter((i) => buts(i).includes('maskable'))) {
      const png = lirePng(cheminPublic(icone.src));
      const d = png.largeur - 1;
      for (const [x, y] of [
        [0, 0],
        [d, 0],
        [0, d],
        [d, d],
        [Math.floor(d / 2), 0],
      ] as const) {
        expect(png.alpha(x, y), `${icone.src} (${String(x)}, ${String(y)})`).toBe(255);
      }
    }
  });
});

describe('T40 : iPhone (index.html)', () => {
  it('apple-touch-icon : PNG 180 × 180 de public/, fond plein', () => {
    const lien = balises('link').find((a) => a.rel === 'apple-touch-icon');
    expect(lien, '<link rel="apple-touch-icon">').toBeDefined();
    const href = lien?.href ?? '';
    expect(href).toMatch(/\.png$/);
    const png = lirePng(cheminPublic(href));
    expect([png.largeur, png.hauteur]).toEqual([180, 180]);
    expect(png.alpha(0, 0), 'coin opaque (iOS noircit la transparence)').toBe(255);
  });

  it('métas iOS : appli plein écran et titre court', () => {
    const metas = balises('meta');
    expect(metas.find((a) => a.name === 'apple-mobile-web-app-capable')?.content).toBe('yes');
    expect(metas.find((a) => a.name === 'apple-mobile-web-app-title')?.content).toBe(MANIFESTE.short_name);
  });
});

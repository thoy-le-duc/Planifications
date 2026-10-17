/**
 * T40 — icônes PNG de l'appli installée, tirées de public/icone.svg (la seule source).
 *
 *   - icone-192.png, icone-512.png : l'icône telle quelle, coins arrondis transparents (« any ») ;
 *   - icone-maskable-512.png : fond plein, dessin réduit dans la zone sûre (cercle de 80 %) : le
 *     téléphone Android découpe lui-même la forme (rond, goutte, carré arrondi) ;
 *   - apple-touch-icon.png (180) : fond plein, iOS arrondit lui-même et noircirait la transparence.
 *
 * Rendu par le Chromium de Playwright (déjà présent pour les e2e) : `node scripts/icones.ts`
 * depuis apps/web, puis commiter les PNG. À relancer seulement si icone.svg change.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const SVG = readFileSync(`${PUBLIC}icone.svg`, 'utf8');

/** Fond plein : le carré arrondi devient un carré, et le dessin est réduit autour du centre. */
function pleinCadre(echelle: number): string {
  const fond = /<rect width="512" height="512" rx="\d+" fill="(#[0-9A-Fa-f]+)"\/>/.exec(SVG);
  if (fond === null) throw new Error('icone.svg : fond (rect 512 × 512 arrondi) introuvable');
  const dessin = SVG.replace(fond[0], '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const decalage = (512 * (1 - echelle)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${fond[1] ?? ''}"/><g transform="translate(${String(decalage)} ${String(decalage)}) scale(${String(echelle)})">${dessin}</g></svg>`;
}

const ICONES: readonly { readonly fichier: string; readonly taille: number; readonly svg: string }[] = [
  { fichier: 'icone-192.png', taille: 192, svg: SVG },
  { fichier: 'icone-512.png', taille: 512, svg: SVG },
  { fichier: 'icone-maskable-512.png', taille: 512, svg: pleinCadre(0.8) },
  { fichier: 'apple-touch-icon.png', taille: 180, svg: pleinCadre(0.9) },
];

const navigateur = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const { fichier, taille, svg } of ICONES) {
    const page = await navigateur.newPage({ viewport: { width: taille, height: taille }, deviceScaleFactor: 1 });
    const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${source}" width="${String(taille)}" height="${String(taille)}">`);
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    await page.screenshot({ path: `${PUBLIC}${fichier}`, omitBackground: true, clip: { x: 0, y: 0, width: taille, height: taille } });
    await page.close();
    console.log(`${fichier} (${String(taille)} × ${String(taille)})`);
  }
} finally {
  await navigateur.close();
}

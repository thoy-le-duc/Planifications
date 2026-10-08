/**
 * Budgets de poids (gzip) de budget.json, vérifiés sur dist/ :
 *   - jsInitialGzKio : le JavaScript chargé au démarrage (scripts et modulepreload de index.html) ;
 *   - jsVue3dGzKio (T27) : le morceau de la vue 3D, chargé à la demande seulement — les fichiers
 *     hors démarrage qui portent three ou @react-three/fiber, avec leurs imports statiques hors
 *     démarrage (même mesure que scripts/vue3d.test.ts) ;
 *   - jsPlacementGzKio (T28b) : le morceau de l'éditeur de placement sur la photo aérienne, chargé
 *     à la demande seulement — les fichiers hors démarrage qui portent la couche de l'orthophoto,
 *     avec leurs imports statiques hors démarrage (même mesure que scripts/placement.test.ts).
 * Relever une limite se justifie dans la PR.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

interface Budget {
  jsInitialGzKio: number;
  jsVue3dGzKio: number;
  jsPlacementGzKio: number;
}

/** Chaînes qui survivent à la minification : messages de three, propriété posée par fiber. */
const MARQUEURS_3D = ['WebGLRenderer', '__r3f'] as const;

/** Couche de l'orthophoto IGN (tuiles.ts) : elle n'est que dans le morceau de l'éditeur de placement. */
const MARQUEUR_PLACEMENT = 'ORTHOIMAGERY.ORTHOPHOTOS';

const racine = join(import.meta.dirname, '..');
const dist = join(racine, 'dist');
const budget = JSON.parse(readFileSync(join(racine, 'budget.json'), 'utf8')) as Budget;
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const motifs = [
  /<script\b[^>]*\bsrc="\/([^"]+\.js)"/g,
  /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+\.js)"/g,
];
const fichiers = motifs
  .flatMap((motif) => [...html.matchAll(motif)].map((m) => m[1]))
  .filter((f): f is string => f !== undefined);

if (fichiers.length === 0) {
  console.error('Aucun script trouvé dans dist/index.html : lancer le build avant le budget.');
  process.exit(1);
}

const lire = (fichier: string): string => readFileSync(join(dist, ...fichier.split('/')), 'utf8');
const gzKio = (fichier: string): number => gzipSync(readFileSync(join(dist, ...fichier.split('/')))).length / 1024;

const depasses: string[] = [];
function verdict(nom: string, totalKio: number, limite: number): void {
  const ok = totalKio <= limite;
  if (!ok) depasses.push(nom);
  console.log(`${totalKio.toFixed(1).padStart(7)} Kio  ${nom} (budget ${String(limite)} Kio) : ${ok ? 'OK' : 'DÉPASSÉ'}`);
}

// ── Démarrage ────────────────────────────────────────────────────────────────────────────────
let totalKio = 0;
for (const fichier of fichiers) {
  const kio = gzKio(fichier);
  totalKio += kio;
  console.log(`${kio.toFixed(1).padStart(7)} Kio  ${fichier}`);
}
verdict('total au démarrage', totalKio, budget.jsInitialGzKio);

// ── Vue 3D (T27) ─────────────────────────────────────────────────────────────────────────────
function tousLesJs(dossier: string): string[] {
  const liste: string[] = [];
  const pile = [dossier];
  for (let d = pile.pop(); d !== undefined; d = pile.pop()) {
    for (const nom of readdirSync(d)) {
      const chemin = join(d, nom);
      if (statSync(chemin).isDirectory()) pile.push(chemin);
      else if (nom.endsWith('.js')) liste.push(relative(dossier, chemin).split(sep).join('/'));
    }
  }
  return liste;
}

const presents = new Set(tousLesJs(dist));

/** Imports statiques d'un morceau (`from"./x.js"`, `import"./x.js"`), jamais `import("./x.js")`. */
function importsStatiques(fichier: string): string[] {
  const cibles: string[] = [];
  for (const [, cible] of lire(fichier).matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+\.js)["']/g)) {
    if (cible === undefined) continue;
    const resolu = cible.startsWith('.') ? posix.normalize(posix.join(posix.dirname(fichier), cible)) : cible.replace(/^\//, '');
    if (presents.has(resolu)) cibles.push(resolu);
  }
  return cibles;
}

function fermeture(depart: readonly string[], exclus: ReadonlySet<string>): Set<string> {
  const vus = new Set<string>();
  const pile = [...depart];
  for (let f = pile.pop(); f !== undefined; f = pile.pop()) {
    if (vus.has(f) || exclus.has(f) || !presents.has(f)) continue;
    vus.add(f);
    pile.push(...importsStatiques(f));
  }
  return vus;
}

const demarrage = fermeture(fichiers, new Set());
const porteurs = [...presents].filter((f) => !demarrage.has(f) && MARQUEURS_3D.some((m) => lire(f).includes(m)));
if (porteurs.length === 0) {
  console.error('Aucun morceau de la vue 3D (three, fiber) dans dist/ : le budget jsVue3dGzKio ne mesurerait rien.');
  process.exit(1);
}
let total3dKio = 0;
for (const fichier of [...fermeture(porteurs, demarrage)].sort()) {
  const kio = gzKio(fichier);
  total3dKio += kio;
  console.log(`${kio.toFixed(1).padStart(7)} Kio  ${fichier} (vue 3D, à la demande)`);
}
verdict('vue 3D', total3dKio, budget.jsVue3dGzKio);

// ── Éditeur de placement (T28b) ──────────────────────────────────────────────────────────────
const porteursPlacement = [...presents].filter((f) => f !== 'sw.js' && !f.startsWith('workbox-') && !demarrage.has(f) && lire(f).includes(MARQUEUR_PLACEMENT));
if (porteursPlacement.length === 0) {
  console.error('Aucun morceau de l’éditeur de placement (orthophoto IGN) dans dist/ : le budget jsPlacementGzKio ne mesurerait rien.');
  process.exit(1);
}
let totalPlacementKio = 0;
for (const fichier of [...fermeture(porteursPlacement, demarrage)].sort()) {
  const kio = gzKio(fichier);
  totalPlacementKio += kio;
  console.log(`${kio.toFixed(1).padStart(7)} Kio  ${fichier} (éditeur de placement, à la demande)`);
}
verdict('éditeur de placement', totalPlacementKio, budget.jsPlacementGzKio);

if (depasses.length > 0) process.exit(1);

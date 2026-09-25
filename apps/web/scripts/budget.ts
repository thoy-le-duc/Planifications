/**
 * Budget de poids : le JavaScript chargé au démarrage, compressé en gzip,
 * ne doit pas dépasser la limite de budget.json. Relever la limite se justifie dans la PR.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

interface Budget {
  jsInitialGzKio: number;
}

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

let totalKio = 0;
for (const fichier of fichiers) {
  const kio = gzipSync(readFileSync(join(dist, fichier))).length / 1024;
  totalKio += kio;
  console.log(`${kio.toFixed(1).padStart(7)} Kio  ${fichier}`);
}

const verdict = totalKio <= budget.jsInitialGzKio ? 'OK' : 'DÉPASSÉ';
console.log(`${totalKio.toFixed(1).padStart(7)} Kio  total (budget ${String(budget.jsInitialGzKio)} Kio) : ${verdict}`);
if (verdict !== 'OK') process.exit(1);

/**
 * T11c — build des essais : l'appli de production ET les pages de test (mesures/, diagnostic/).
 *
 *   node scripts/build-essais.ts [--depuis dist] [--vers dist-essais]
 *
 * 1. `--vers` est vidé puis rempli d'une copie du build de production `--depuis`, construit juste
 *    avant par `vite build` (`pnpm build:essais` enchaîne les deux : jamais de dist/ périmé) ; si les deux dossiers sont le même, rien n'est copié (cas de
 *    `pnpm e2e:synchro`, qui construit l'appli avec ses URL dans `dist-synchro/`).
 * 2. `vite build --mode essais` construit les seules pages de test dans un dossier temporaire.
 *    Un seul `vite build` pour l'appli et les pages redécouperait les morceaux partagés : l'entrée
 *    de l'appli changerait d'empreinte (voir scripts/builds.test.ts).
 * 3. Ce build est versé dans `--vers` sans rien écraser : un fichier déjà présent (sw.js, morceau
 *    de l'appli) doit être identique octet pour octet, sinon le script échoue.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const RACINE = resolve(import.meta.dirname, '..');

const { values } = parseArgs({
  options: {
    depuis: { type: 'string', default: 'dist' },
    vers: { type: 'string', default: 'dist-essais' },
  },
});
const depuis = resolve(RACINE, values.depuis);
const vers = resolve(RACINE, values.vers);

if (!existsSync(join(depuis, 'index.html'))) {
  console.error(`[build:essais] ${relative(RACINE, depuis)}/index.html absent : lancer le build de production avant (pnpm build).`);
  process.exit(1);
}

function fichiers(dossier: string): string[] {
  const liste: string[] = [];
  const pile = [dossier];
  for (let d = pile.pop(); d !== undefined; d = pile.pop()) {
    for (const nom of readdirSync(d)) {
      const chemin = join(d, nom);
      if (statSync(chemin).isDirectory()) pile.push(chemin);
      else liste.push(relative(dossier, chemin));
    }
  }
  return liste.sort();
}

if (depuis !== vers) {
  rmSync(vers, { recursive: true, force: true });
  cpSync(depuis, vers, { recursive: true });
}

const temporaire = mkdtempSync(join(tmpdir(), 'planif-essais-'));
try {
  const r = spawnSync('pnpm', ['exec', 'vite', 'build', '--mode', 'essais', '--outDir', temporaire, '--emptyOutDir'], {
    cwd: RACINE,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`vite build --mode essais : code ${String(r.status)}`);

  const conflits: string[] = [];
  let ajoutes = 0;
  for (const fichier of fichiers(temporaire)) {
    const cible = join(vers, fichier);
    const source = join(temporaire, fichier);
    if (existsSync(cible)) {
      if (!readFileSync(cible).equals(readFileSync(source))) conflits.push(fichier);
      continue;
    }
    mkdirSync(dirname(cible), { recursive: true });
    cpSync(source, cible);
    ajoutes += 1;
  }
  if (conflits.length > 0) {
    throw new Error(`le build des essais écraserait des fichiers de l'appli : ${conflits.join(', ')}`);
  }
  console.log(`[build:essais] ${String(ajoutes)} fichiers de test ajoutés dans ${relative(RACINE, vers)}/`);
} catch (erreur) {
  console.error(`[build:essais] ${erreur instanceof Error ? erreur.message : String(erreur)}`);
  process.exitCode = 1;
} finally {
  rmSync(temporaire, { recursive: true, force: true });
}

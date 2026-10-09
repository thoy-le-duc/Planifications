/**
 * `pnpm --filter @planif/api build` (lancé par `pnpm build`, donc par la construction Vercel du
 * projet « appli », T38a) : rassemble le point d'entrée Vercel (src/vercel.ts), l'application et
 * ses dépendances (@planif/core, @planif/db, hono, pg, jose, nodemailer…) en UN fichier
 * JavaScript, dist-vercel/fonction.mjs, que la fonction api/[...route].js réexporte.
 *
 * Pourquoi un seul fichier : le constructeur Node de Vercel compile chaque .ts à part sans
 * réécrire les imports `./x.ts` ni les `exports` des paquets du dépôt (qui pointent sur du .ts) ;
 * la fonction ne se chargerait pas. Un fichier tout prêt ne dépend d'aucune de ces règles.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));

await build({
  absWorkingDir: racine,
  entryPoints: ['src/vercel.ts'],
  outfile: 'dist-vercel/fonction.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Module natif facultatif de pg, jamais utilisé : pg retombe sur son client JavaScript.
  external: ['pg-native'],
  // Les dépendances en CommonJS (pg, nodemailer) appellent require() sur les modules de Node.
  banner: { js: "import { createRequire as __creerRequire } from 'node:module'; const require = __creerRequire(import.meta.url);" },
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('Fonction Vercel : apps/api/dist-vercel/fonction.mjs');

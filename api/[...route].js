/**
 * Fonction Vercel du projet « appli » (T38a) : toute requête /api/… arrive ici (vercel.json) et
 * passe à la même application Hono que le serveur Node, configurée par les variables
 * d'environnement du projet Vercel. Le module réexporté est construit par `pnpm build`
 * (apps/api/scripts/construire-vercel.ts) depuis apps/api/src/vercel.ts.
 */
export { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from '../apps/api/dist-vercel/fonction.mjs';

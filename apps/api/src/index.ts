/**
 * Démarrage de l'API : lit l'environnement, puis sert `creerApp`.
 *
 * Variables (aucune valeur secrète par défaut dans le code) :
 *   DATABASE_URL       Postgres (obligatoire)
 *   JWT_CLES_PRIVEES   JWKS de clés privées RS256, la première signe (obligatoire) ;
 *                      `pnpm --filter @planif/api cles` en génère une
 *   JWT_EMETTEUR       claim iss (obligatoire)
 *   JWT_AUDIENCE       claim aud, celle configurée dans PowerSync (obligatoire)
 *   PORT               3000 par défaut
 *   COURRIEL_CONSOLE   « 1 » pour écrire les e-mails dans la console (développement seulement :
 *                      les codes y apparaissent en clair). Aucun service d'envoi réel dans T09.
 */
import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { creerApp } from './app.ts';
import { expediteurConsole, trousseauDepuisJwks } from './auth/index.ts';

function obligatoire(nom: string): string {
  const valeur = process.env[nom] ?? '';
  if (valeur === '') {
    console.error(`Variable d'environnement ${nom} absente.`);
    process.exit(1);
  }
  return valeur;
}

const databaseUrl = obligatoire('DATABASE_URL');
const cles = await trousseauDepuisJwks(obligatoire('JWT_CLES_PRIVEES'));
const emetteur = obligatoire('JWT_EMETTEUR');
const audience = obligatoire('JWT_AUDIENCE');
const port = Number(process.env.PORT ?? 3000);

if (process.env.COURRIEL_CONSOLE !== '1') {
  console.error(
    "Aucun service d'envoi d'e-mail configuré (ticket suivant). En développement : COURRIEL_CONSOLE=1.",
  );
  process.exit(1);
}
const expediteur = expediteurConsole();

const pool = new pg.Pool({ connectionString: databaseUrl });
const app = creerApp({ db: drizzle(pool), expediteur, cles, emetteur, audience });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API à l'écoute sur http://localhost:${String(info.port)}`);
});

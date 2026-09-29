/**
 * Démarrage de l'API : lit la configuration (config.ts, variables documentées là), puis sert
 * `creerApp`. Une configuration invalide arrête le processus en code 1, avec son message.
 */
import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { creerApp } from './app.ts';
import { expediteurConsole, expediteurSmtp, trousseauDepuisJwks } from './auth/index.ts';
import { lireConfig, type Config } from './config.ts';

let config: Config;
try {
  config = lireConfig(process.env);
} catch (erreur) {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exit(1);
}

const cles = await trousseauDepuisJwks(config.jwtClesPrivees);
// COURRIEL_CONSOLE=1 (développement, refusé en production par lireConfig) ou relais SMTP.
const { courriel } = config;
const expediteur = courriel.type === 'console' ? expediteurConsole() : expediteurSmtp(courriel);

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const app = creerApp({
  db: drizzle(pool),
  expediteur,
  cles,
  emetteur: config.emetteur,
  audience: config.audience,
  proxyDeConfiance: config.proxyDeConfiance,
  ...(config.corsOrigines === undefined ? {} : { corsOrigines: config.corsOrigines }),
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`API à l'écoute sur http://localhost:${String(info.port)}`);
});

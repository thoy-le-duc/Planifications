/**
 * Démarrage de l'API : lit la configuration (config.ts, variables documentées là), puis sert
 * `creerApp`. Une configuration invalide arrête le processus en code 1, avec son message. Le
 * relais SMTP est vérifié en tâche de fond (demarrage.ts) : injoignable ou muet, il ne retarde
 * ni n'arrête l'écoute (erreur sur la sortie d'erreur), pour que la synchro démarre quand même.
 */
import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { creerApp } from './app.ts';
import { trousseauDepuisJwks } from './auth/index.ts';
import { lireConfig, type Config } from './config.ts';
import { preparerExpediteur } from './demarrage.ts';

let config: Config;
try {
  config = lireConfig(process.env);
} catch (erreur) {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exit(1);
}

const cles = await trousseauDepuisJwks(config.jwtClesPrivees);
// COURRIEL_CONSOLE=1 (NODE_ENV=development seulement, lireConfig) ou relais SMTP, vérifié en
// tâche de fond sans retarder l'écoute.
const expediteur = await preparerExpediteur(config.courriel);

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

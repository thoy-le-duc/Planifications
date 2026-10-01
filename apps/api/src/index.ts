/**
 * Démarrage de l'API : lit la configuration (config.ts, variables documentées là), vérifie le
 * relais SMTP (demarrage.ts), puis sert `creerApp`. Une configuration invalide arrête le
 * processus en code 1, avec son message ; un relais injoignable n'arrête rien (erreur sur la
 * sortie d'erreur), pour que la synchro démarre quand même.
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
// COURRIEL_CONSOLE=1 (développement, refusé en production par lireConfig) ou relais SMTP,
// vérifié avant d'écouter.
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

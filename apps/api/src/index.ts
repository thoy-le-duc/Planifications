/**
 * Démarrage de l'API : lit la configuration (config.ts, variables documentées là), puis sert
 * `creerApp` par `creerServeur` (serveur.ts). Une configuration invalide arrête le processus en
 * code 1, avec son message. Le relais SMTP est vérifié en tâche de fond (demarrage.ts) :
 * injoignable ou muet, il ne retarde ni n'arrête l'écoute (erreur sur la sortie d'erreur), pour que la synchro démarre quand même.
 */
import pg from 'pg';
import { lireConfig, type Config } from './config.ts';
import { assemblerApp } from './demarrage.ts';
import { journalParDefaut } from './dependances.ts';
import { decrireErreur, journalSur } from './journal.ts';
import { creerServeur } from './serveur.ts';

// Un seul journal pour toute l'API (T10m) : démarrage, routes et erreurs hors requête écrivent
// au même endroit, nettoyé (une ligne) et sans jamais lever.
const journal = journalSur(journalParDefaut);

// Erreurs hors requête : décrites sans leur message (qui peut citer une saisie). Posés avant le
// premier await de niveau module, pour couvrir aussi le démarrage.
process.on('unhandledRejection', (raison) => {
  journal(`[processus] rejet non géré : ${decrireErreur(raison)}`);
});
process.on('uncaughtException', (erreur) => {
  journal(`[processus] exception non rattrapée : ${decrireErreur(erreur)}`);
  // Comportement normal de Node après une exception non rattrapée : arrêt en code 1.
  process.exit(1);
});

let config: Config;
try {
  config = lireConfig(process.env);
} catch (erreur) {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: config.databaseUrl });
// Client inactif du pool coupé (Postgres redémarré…) : sans écouteur, le processus s'arrêterait.
pool.on('error', (erreur) => {
  journal(`[base] erreur d'un client inactif : ${decrireErreur(erreur)}`);
});
// Clés, expéditeur (relais SMTP vérifié en tâche de fond) et creerApp : demarrage.ts, commun à Vercel.
const app = await assemblerApp(config, pool, journal);

// Délai court de lecture du corps (T10f) : un client muet ne garde pas une connexion 300 s.
// Même journal (T10p) : un corps de réponse en flux qui échoue y est décrit, jamais sur la console.
creerServeur({ fetch: app.fetch, journal }).listen(config.port, () => {
  console.log(`API à l'écoute sur http://localhost:${String(config.port)}`);
});

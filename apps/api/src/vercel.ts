/**
 * Point d'entrée Vercel (T38a) : la MÊME application que le serveur Node (`creerApp`, app.ts),
 * servie sous `/api` par des fonctions Vercel (région cdg1, vercel.json à la racine du dépôt,
 * fonction api/[...route].js, qui réexporte ce module rassemblé en un fichier par
 * scripts/construire-vercel.ts). L'appli l'appelle en même origine (VITE_API_URL vide), sans CORS.
 *
 * - Rien n'est lu à l'import ni à la création du gestionnaire : la configuration (`lireConfig`,
 *   mêmes variables que Node, config.ts) est lue au PREMIER appel, une fois par instance de
 *   fonction. Invalide : chaque appel répond 500 `{ erreur: 'configuration_invalide' }` ; le
 *   message de `lireConfig` (qui nomme la variable, jamais sa valeur) va au journal seul.
 * - Aucun état qui doive survivre d'une requête à l'autre en mémoire : codes, tentatives,
 *   sessions, limite par IP et débit de la synchro sont en base.
 * - Pool PostgreSQL à connexions courtes (POOL_VERCEL) : une connexion inactive se ferme vite,
 *   aucune ne reste ouverte longtemps après la fin d'une requête. Adresse « pooled » de Neon.
 * - PROXY_DE_CONFIANCE=1 obligatoire sur Vercel (le proxy de Vercel pose X-Forwarded-For) : absente
 *   en production Vercel (VERCEL=1), un avertissement est écrit au journal au premier appel.
 */
import { Hono } from 'hono';
import pg from 'pg';
import { lireConfig } from './config.ts';
import { assemblerApp } from './demarrage.ts';
import { journalParDefaut } from './dependances.ts';
import { decrireErreur, journalSur } from './journal.ts';

type Environnement = Readonly<Record<string, string | undefined>>;

/** Une requête du web (Request) donne une réponse : la forme que Vercel appelle. */
export type Gestionnaire = (requete: Request) => Promise<Response>;

export interface OptionsGestionnaire {
  /** Journal ; par défaut la sortie d'erreur (journal de la fonction Vercel). */
  readonly journal?: (ligne: string) => void;
}

/** Préfixe sous lequel l'application est servie (réécriture `/api/(.*)` de vercel.json). */
export const PREFIXE_API = '/api';

/**
 * Pool d'une instance de fonction : peu de connexions (plusieurs requêtes peuvent partager une
 * instance), fermées après une seconde d'inactivité. Le serveur Node garde le pool par défaut.
 */
export const POOL_VERCEL = { max: 3, idleTimeoutMillis: 1_000, allowExitOnIdle: true } as const;

function configurationInvalide(): Response {
  return Response.json({ erreur: 'configuration_invalide' }, { status: 500 });
}

/** Application montée sous /api, construite depuis `env` ; lève si la configuration est invalide. */
async function construire(env: Environnement, journal: (ligne: string) => void): Promise<Hono> {
  const config = lireConfig(env);
  if (env.VERCEL === '1' && !config.proxyDeConfiance) {
    journal(
      'Avertissement : PROXY_DE_CONFIANCE=1 absent sur Vercel : sans lui, aucune adresse de client n’est lue et la limite par adresse IP ne s’applique pas. Poser PROXY_DE_CONFIANCE=1 dans les variables du projet Vercel.',
    );
  }
  const pool = new pg.Pool({ connectionString: config.databaseUrl, ...POOL_VERCEL });
  // Client inactif coupé (Neon qui suspend sa base…) : sans écouteur, l'instance s'arrêterait.
  pool.on('error', (erreur) => {
    journal(`[base] erreur d'un client inactif : ${decrireErreur(erreur)}`);
  });
  return new Hono().route(PREFIXE_API, await assemblerApp(config, pool, journal));
}

export function creerGestionnaire(env: Environnement, options: OptionsGestionnaire = {}): Gestionnaire {
  const journal = journalSur(options.journal ?? journalParDefaut);
  let application: Promise<Hono | null> | undefined;

  function preparer(): Promise<Hono | null> {
    application ??= construire(env, journal).catch((erreur: unknown) => {
      // lireConfig et trousseauDepuisJwks lèvent des Error simples dont le message nomme la
      // variable et la règle, jamais une valeur secrète. Toute autre erreur (SyntaxError d'une
      // bibliothèque, qui peut citer la valeur…) est décrite sans son message.
      const detail = erreur instanceof Error && erreur.constructor === Error ? erreur.message : decrireErreur(erreur);
      journal(`[configuration] invalide, l'API répond 500 : ${detail}`);
      return null;
    });
    return application;
  }

  return async (requete) => {
    const app = await preparer();
    if (app === null) return configurationInvalide();
    return app.fetch(requete);
  };
}

/** Ce que Vercel appelle : une fonction par méthode HTTP, sur l'environnement du projet. */
const gerer = creerGestionnaire(process.env);

export const GET: Gestionnaire = (requete) => gerer(requete);
export const HEAD: Gestionnaire = (requete) => gerer(requete);
export const POST: Gestionnaire = (requete) => gerer(requete);
export const PUT: Gestionnaire = (requete) => gerer(requete);
export const PATCH: Gestionnaire = (requete) => gerer(requete);
export const DELETE: Gestionnaire = (requete) => gerer(requete);
export const OPTIONS: Gestionnaire = (requete) => gerer(requete);

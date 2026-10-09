/**
 * Préparation de l'expéditeur d'e-mail au démarrage de l'API (T09c), et assemblage de
 * l'application commun à Node et Vercel (`assemblerApp`, T38a). Sans effet de bord à l'import.
 *
 * Une panne du relais SMTP (Brevo en production) ne doit jamais empêcher ni retarder le
 * démarrage de l'API, donc de la synchro : la vérification part en tâche de fond, son échec est
 * écrit dans le journal, et l'envoi d'un code échouera ensuite normalement. Seule une configuration
 * incomplète (lireConfig) arrête le processus. Contrat : demarrage.test.ts.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Hono } from 'hono';
import type pg from 'pg';
import { creerApp } from './app.ts';
import { ErreurEnvoiCourriel, expediteurConsole, expediteurSmtp, trousseauDepuisJwks, type ExpediteurCourriel } from './auth/index.ts';
import type { Config, ConfigCourriel } from './config.ts';
import { journalParDefaut } from './dependances.ts';
import { decrireErreur, ligneDeJournal } from './journal.ts';

export function preparerExpediteur(
  courriel: ConfigCourriel,
  journal: (ligne: string) => void = journalParDefaut,
): Promise<ExpediteurCourriel> {
  if (courriel.type === 'console') return Promise.resolve(expediteurConsole());
  const expediteur = expediteurSmtp(courriel);
  // Tâche de fond, jamais attendue : un relais muet (jusqu'à DELAI_SMTP_MS) ne retarde pas
  // l'écoute de l'API, donc la synchro.
  void expediteur.verifier().catch((erreur: unknown) => {
    // Une ErreurEnvoiCourriel (verifier()) a un message déjà nettoyé (erreurPropre) ; toute autre
    // erreur (bug, erreur brute d'une bibliothèque) est décrite sans son message (T10m).
    const detail = erreur instanceof ErreurEnvoiCourriel ? erreur.message : decrireErreur(erreur);
    try {
      journal(
        ligneDeJournal(
          `Avertissement : vérification du relais SMTP ${courriel.hote}:${String(courriel.port)} en échec, ` +
            `l'API tourne mais les codes de connexion ne partiront pas tant qu'il ne répond pas. ${detail}`,
        ),
      );
    } catch {
      // Journal en panne (sortie d'erreur fermée…) : rien, surtout pas un rejet non géré qui
      // arrêterait l'API.
    }
  });
  return Promise.resolve(expediteur);
}

/**
 * Assemble l'application depuis une configuration lue (`lireConfig`) et un pool PostgreSQL :
 * trousseau de clés, expéditeur d'e-mail, `creerApp`. Commun au serveur Node (index.ts) et aux
 * fonctions Vercel (vercel.ts, T38a), qui ne diffèrent que par leur pool (connexions courtes sur
 * Vercel) et par la façon de servir l'application. Lève si le JWKS est illisible.
 */
export async function assemblerApp(config: Config, pool: pg.Pool, journal: (ligne: string) => void): Promise<Hono> {
  const cles = await trousseauDepuisJwks(config.jwtClesPrivees);
  // COURRIEL_CONSOLE=1 (NODE_ENV=development seulement, lireConfig) ou relais SMTP, vérifié en
  // tâche de fond sans retarder l'écoute.
  const expediteur = await preparerExpediteur(config.courriel, journal);
  return creerApp({
    db: drizzle(pool),
    expediteur,
    cles,
    emetteur: config.emetteur,
    audience: config.audience,
    proxyDeConfiance: config.proxyDeConfiance,
    journal,
    ...(config.corsOrigines === undefined ? {} : { corsOrigines: config.corsOrigines }),
  });
}

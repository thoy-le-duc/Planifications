/**
 * Serveur HTTP Node de l'API (T10f) : celui de @hono/node-server, avec des délais adaptés.
 *
 * - Lecture du corps : un client qui se tait plus de `delaiLectureCorpsMs` pendant l'envoi du
 *   corps est coupé (408), au lieu de garder une connexion ouverte 300 s. C'est un délai
 *   d'INACTIVITÉ : un téléphone sur un réseau lent mais régulier passe. Une fois le corps reçu,
 *   il ne s'applique plus : un traitement long répond normalement.
 * - Durée totale d'une requête : large (DUREE_MAX_REQUETE_MS), dernier filet de Node.
 *
 * Contrat : serveur.test.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';

/** Silence au plus pendant la réception du corps d'une requête. */
export const DELAI_LECTURE_CORPS_MS = 10_000;
/** Durée au plus d'une requête entière (réception, traitement, réponse). */
export const DUREE_MAX_REQUETE_MS = 120_000;

export interface OptionsServeur {
  /** `creerApp(...).fetch`. */
  readonly fetch: (requete: Request) => Response | Promise<Response>;
  readonly delaiLectureCorpsMs?: number;
}

/** Arme le délai d'inactivité sur la socket tant que le corps de `requete` n'est pas reçu. */
function surveillerCorps(requete: IncomingMessage, reponse: ServerResponse, delaiMs: number): void {
  if (requete.complete) return;
  const socket = requete.socket;
  // Délai de la socket, écouté sur la requête : Node nous laisse répondre au lieu de tout couper.
  const couper = (): void => {
    lever();
    if (requete.complete) return;
    if (reponse.headersSent) {
      socket.destroy();
      return;
    }
    reponse.writeHead(408, { connection: 'close', 'content-type': 'application/json' });
    reponse.end(JSON.stringify({ erreur: 'delai_depasse' }), () => socket.destroy());
  };
  const lever = (): void => {
    requete.setTimeout(0);
    requete.off('timeout', couper);
    requete.off('end', lever);
    reponse.off('close', lever);
  };
  requete.setTimeout(delaiMs, couper);
  requete.once('end', lever);
  reponse.once('close', lever);
}

/** Serveur prêt, pas encore à l'écoute (`listen` reste à appeler). */
export function creerServeur(options: OptionsServeur): Server {
  const delaiMs = options.delaiLectureCorpsMs ?? DELAI_LECTURE_CORPS_MS;
  const ecouteur = getRequestListener(options.fetch);
  const serveur = createServer((requete, reponse) => {
    surveillerCorps(requete, reponse, delaiMs);
    void ecouteur(requete, reponse);
  });
  serveur.requestTimeout = DUREE_MAX_REQUETE_MS;
  return serveur;
}

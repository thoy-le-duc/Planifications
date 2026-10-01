/**
 * Serveur HTTP Node de l'API (T10f) : celui de @hono/node-server, avec des délais adaptés.
 *
 * - Lecture du corps : un client qui se tait plus de `delaiLectureCorpsMs` pendant l'envoi du
 *   corps est coupé (408), au lieu de garder une connexion ouverte 300 s. C'est un délai
 *   d'INACTIVITÉ : un téléphone sur un réseau lent mais régulier passe. Une fois le corps reçu,
 *   ou la réponse partie, il ne s'applique plus : un traitement long répond normalement.
 *   La minuterie est propre à la requête : le délai de la socket (keep-alive de Node) n'est
 *   jamais touché.
 * - En-têtes : reçus en entier en `delaiEnTetesMs` au plus (15 s par défaut).
 * - Durée totale d'une requête : celle de Node (300 s), dernier filet.
 *
 * Contrat : serveur.test.ts, serveur-relecture.test.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';

/** Silence au plus pendant la réception du corps d'une requête. */
export const DELAI_LECTURE_CORPS_MS = 10_000;
/** Réception des en-têtes au plus. */
export const DELAI_EN_TETES_MS = 15_000;
/** Durée au plus d'une requête entière : la valeur par défaut de Node. */
export const DUREE_MAX_REQUETE_MS = 300_000;

export interface OptionsServeur {
  /** `creerApp(...).fetch`. */
  readonly fetch: (requete: Request) => Response | Promise<Response>;
  readonly delaiLectureCorpsMs?: number;
  readonly delaiEnTetesMs?: number;
}

/** Réponse écrite telle quelle sur la socket, comme Node pour son propre délai de requête. */
const REPONSE_408 = 'HTTP/1.1 408 Request Timeout\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

/**
 * Coupe le client qui se tait plus de `delaiMs` pendant l'envoi du corps de `requete`.
 *
 * Node lit la socket lui-même et pousse le corps dans la requête (`push`) : c'est là qu'on voit
 * arriver chaque morceau sans le consommer à la place de l'application, et la fin du corps
 * (`push(null)`). Si l'application ne lit pas encore (tampon plein), le silence vient d'elle, pas
 * du client : on attend.
 */
function surveillerCorps(requete: IncomingMessage, reponse: ServerResponse, delaiMs: number): void {
  if (requete.complete) return;
  let minuterie: NodeJS.Timeout | undefined;
  /** Morceaux reçus : un morceau arrivé pendant le jugement innocente le client. */
  let morceaux = 0;
  const pousser = requete.push.bind(requete);

  const lever = (): void => {
    clearTimeout(minuterie);
    minuterie = undefined;
    requete.push = pousser;
    reponse.off('finish', lever);
    reponse.off('close', lever);
  };
  const relancer = (): void => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      // Après une pause de la boucle d'événements, les octets déjà arrivés ne sont lus qu'après les
      // minuteries : on les laisse passer (setImmediate) avant de juger le client muet.
      const avant = morceaux;
      setImmediate(() => {
        if (minuterie !== undefined && morceaux === avant) couper();
      });
    }, delaiMs);
  };
  function couper(): void {
    if (requete.readableLength >= requete.readableHighWaterMark) {
      relancer();
      return;
    }
    lever();
    const socket = requete.socket;
    // Écrite sur la socket, pas par `reponse` : l'application, qui répondra plus tard sur une
    // socket fermée, ne lève pas ERR_HTTP_HEADERS_SENT.
    if (reponse.headersSent) socket.destroy();
    else socket.end(REPONSE_408, () => socket.destroy());
  }

  requete.push = (morceau: unknown, encodage?: BufferEncoding): boolean => {
    if (morceau === null) lever();
    else {
      morceaux++;
      relancer();
    }
    return pousser(morceau, encodage);
  };
  reponse.once('finish', lever);
  reponse.once('close', lever);
  relancer();
}

/** Serveur prêt, pas encore à l'écoute (`listen` reste à appeler). */
export function creerServeur(options: OptionsServeur): Server {
  const delaiCorpsMs = options.delaiLectureCorpsMs ?? DELAI_LECTURE_CORPS_MS;
  const delaiEnTetesMs = options.delaiEnTetesMs ?? DELAI_EN_TETES_MS;
  const ecouteur = getRequestListener(options.fetch);
  const serveur = createServer(
    // Node ne vérifie les délais d'en-têtes et de requête qu'à cet intervalle (30 s par défaut).
    { connectionsCheckingInterval: Math.min(1_000, Math.max(100, Math.floor(delaiEnTetesMs / 4))) },
    (requete, reponse) => {
      surveillerCorps(requete, reponse, delaiCorpsMs);
      void ecouteur(requete, reponse);
    },
  );
  serveur.headersTimeout = delaiEnTetesMs;
  serveur.requestTimeout = DUREE_MAX_REQUETE_MS;
  return serveur;
}

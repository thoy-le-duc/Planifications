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
 * - Corps de réponse en flux qui échoue en cours d'envoi (T10p) : l'erreur va au journal
 *   (`decrireErreur`, jamais son message) et la connexion est coupée, sans terminer la réponse :
 *   un export tronqué ne passe jamais pour complet. @hono/node-server, lui, écrirait l'erreur
 *   brute sur la console et enverrait `Error: <message>` au client, ou une réponse tronquée
 *   d'apparence complète. Un client parti n'est pas une erreur du serveur : rien au journal.
 * - Erreur levée par `fetch` lui-même (synchrone ou non : flux verrouillé, `start` qui lève…) :
 *   500 et une ligne au journal, rien sur la console.
 *
 * RÈGLES pour tout corps de réponse en flux (export, téléchargement…) :
 * - Un flux qui échoue doit LEVER (`controller.error(erreur)` ou `throw` dans `pull`), jamais se
 *   fermer proprement (`controller.close()`) : sinon la réponse tronquée part comme complète et
 *   le maraîcher croit avoir un export entier.
 * - Ne jamais utiliser `hono/streaming` (stream, streamText, streamSSE) : il attrape lui-même les
 *   erreurs du flux, les écrit sur la console et termine la réponse proprement (test statique,
 *   serveur-flux.test.ts). Rendre `new Response(readableStream)`.
 *
 * Contrat : serveur.test.ts, serveur-relecture.test.ts, serveur-flux.test.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getRequestListener, RequestError } from '@hono/node-server';
import { journalParDefaut } from './dependances.ts';
import { decrireErreur, journalSur } from './journal.ts';

/** Silence au plus pendant la réception du corps d'une requête. */
export const DELAI_LECTURE_CORPS_MS = 10_000;
/** Réception des en-têtes au plus. */
export const DELAI_EN_TETES_MS = 15_000;
/** Durée au plus d'une requête entière : la valeur par défaut de Node. */
export const DUREE_MAX_REQUETE_MS = 300_000;

export interface OptionsServeur {
  /** `creerApp(...).fetch`. */
  readonly fetch: (requete: Request) => Response | Promise<Response>;
  /** Journal du serveur (une ligne par entrée) ; par défaut la sortie d'erreur. */
  readonly journal?: (ligne: string) => void;
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

/** Réponse HTTP/1.1 ou HTTP/2 de Node : `destroy()` coupe la connexion (ou le flux HTTP/2). */
interface Coupable {
  readonly destroyed: boolean;
  destroy(): unknown;
  once(evenement: 'close', ecouteur: () => void): unknown;
}

/**
 * Corps de `source` relu tel quel ; s'il lève en cours d'envoi, l'erreur va au journal, la
 * connexion est coupée (`reponse.destroy()`), puis le flux se termine pour @hono/node-server, qui
 * n'écrit plus rien sur une réponse détruite. Il ne voit donc jamais l'erreur. Si la réponse est
 * déjà fermée (client parti : la source lève souvent à l'abandon de `requete.signal`), rien au
 * journal et pas de second `destroy()`.
 */
function corpsSurveille(
  source: ReadableStream<Uint8Array>,
  reponse: Coupable,
  journal: (ligne: string) => void,
): ReadableStream<Uint8Array> {
  const lecteur = source.getReader();
  let fermee = false;
  reponse.once('close', () => {
    fermee = true;
  });
  return new ReadableStream<Uint8Array>(
    {
      async pull(controleur) {
        let lu: Awaited<ReturnType<typeof lecteur.read>>;
        try {
          lu = await lecteur.read();
        } catch (erreur) {
          if (!fermee && !reponse.destroyed) {
            journal(`[réponse] envoi du corps interrompu, connexion coupée : ${decrireErreur(erreur)}`);
            reponse.destroy();
          }
          controleur.close();
          return;
        }
        if (lu.done) controleur.close();
        else controleur.enqueue(lu.value);
      },
      async cancel(raison) {
        await lecteur.cancel(raison).catch(() => undefined);
      },
    },
    // Rien lu d'avance : on ne tire la source qu'à la demande, comme sans enveloppe.
    { highWaterMark: 0 },
  );
}

/**
 * Corps en flux d'une réponse de @hono/node-server : sa réponse « légère » garde le corps sous un
 * symbole privé (description « cache ») ; le lire là évite de la convertir en Response native (et
 * de perdre l'envoi direct des réponses texte et JSON). Sans ce symbole, `body` (Response native).
 */
function fluxDe(reponse: Response): ReadableStream<Uint8Array> | null {
  const symbole = Object.getOwnPropertySymbols(reponse).find((s) => s.description === 'cache');
  if (symbole !== undefined) {
    const cache: unknown = (reponse as unknown as Record<symbol, unknown>)[symbole];
    const corps: unknown = Array.isArray(cache) ? cache[1] : undefined;
    return corps instanceof ReadableStream ? (corps as ReadableStream<Uint8Array>) : null;
  }
  return reponse.body;
}

/** Serveur prêt, pas encore à l'écoute (`listen` reste à appeler). */
export function creerServeur(options: OptionsServeur): Server {
  const delaiCorpsMs = options.delaiLectureCorpsMs ?? DELAI_LECTURE_CORPS_MS;
  const delaiEnTetesMs = options.delaiEnTetesMs ?? DELAI_EN_TETES_MS;
  const journal = journalSur(options.journal ?? journalParDefaut);
  /** Corps en flux enveloppé ; toute autre réponse rendue telle quelle. */
  const surveiller = (reponse: Response, outgoing: Coupable): Response => {
    const flux = fluxDe(reponse);
    if (flux === null) return reponse;
    // Ni `body` ni `statusText` de la réponse d'origine ensuite : ils la convertiraient en
    // Response native, avec un corps déjà verrouillé par l'enveloppe.
    return new Response(corpsSurveille(flux, outgoing, journal), {
      status: reponse.status,
      headers: reponse.headers,
    });
  };
  /**
   * `fetch` (ou l'enveloppe) a levé, avant toute réponse : 500 et une ligne au journal, au lieu du
   * 500 muet de @hono/node-server. Requête illisible (RequestError) : 400, comme sans ce
   * gestionnaire ; délai dépassé (TimeoutError) : 504, idem.
   */
  const surErreur = (erreur: unknown): Response => {
    if (erreur instanceof RequestError) return new Response(null, { status: 400 });
    journal(`[réponse] erreur avant toute réponse : ${decrireErreur(erreur)}`);
    const delai = erreur instanceof Error && (erreur.name === 'TimeoutError' || erreur.constructor.name === 'TimeoutError');
    return new Response(null, { status: delai ? 504 : 500 });
  };
  const ecouteur = getRequestListener(
    (requete, { outgoing }) => {
      const reponse = options.fetch(requete);
      // Réponse immédiate gardée immédiate : @hono/node-server l'envoie alors sans attente.
      return reponse instanceof Promise
        ? reponse.then((r) => surveiller(r, outgoing))
        : surveiller(reponse, outgoing);
    },
    { errorHandler: surErreur },
  );
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

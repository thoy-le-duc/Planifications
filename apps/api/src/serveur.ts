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
 * - Durée totale d'une requête : celle de Node (300 s), dernier filet. Elle ne couvre que la
 *   réception de la requête : ni la production de la réponse (attente du premier morceau, lecture
 *   en mémoire en HTTP/1.0), ni son envoi.
 * - Corps de réponse en flux qui échoue en cours d'envoi (T10p) : l'erreur va au journal
 *   (`decrireErreur`, jamais son message) et la connexion est coupée, sans terminer la réponse :
 *   un export tronqué ne passe jamais pour complet. @hono/node-server, lui, écrirait l'erreur
 *   brute sur la console et enverrait `Error: <message>` au client, ou une réponse tronquée
 *   d'apparence complète. Un client parti n'est pas une erreur du serveur : rien au journal.
 * - Corps en flux qui échoue AVANT son premier morceau (T10q) : les en-têtes ne partent qu'avec
 *   le premier morceau ; un échec avant donne un 500 complet et une ligne au journal, pas
 *   « 200 puis coupure ».
 * - Requête HTTP/1.0 (T10q), corps en flux sans Content-Length : pas d'envoi par morceaux en
 *   HTTP/1.0, la fin du corps n'y est que la fermeture, indiscernable d'une coupure. Le corps est
 *   donc lu en mémoire et envoyé avec un Content-Length exact ; lecture qui échoue : 500 complet ;
 *   au-delà de `plafondHttp10Octets` (32 Mio par défaut) : 505 sans corps. Une réponse qui annonce
 *   déjà son Content-Length reste en flux : sa coupure se voit.
 * - Client parti pendant l'attente du premier morceau ou la lecture en mémoire : la source est
 *   annulée (`cancel`), même si elle ignore `requete.signal` ; rien au journal.
 *   En production, le proxy parle HTTP/1.1 à l'API (README, « Déploiement »).
 * - Erreur levée par `fetch` lui-même (synchrone ou non : flux verrouillé, `start` qui lève…) :
 *   500 et une ligne au journal, rien sur la console ; délai (TimeoutError) : 504 ; requête
 *   illisible : 400. Ne lève jamais, même sur une erreur piégée (T10q).
 *
 * RÈGLES pour tout corps de réponse en flux (export, téléchargement…) :
 * - Un flux qui échoue doit LEVER (`controller.error(erreur)` ou `throw` dans `pull`), jamais se
 *   fermer proprement (`controller.close()`) : sinon la réponse tronquée part comme complète et
 *   le maraîcher croit avoir un export entier.
 * - Ne jamais utiliser `hono/streaming` (stream, streamText, streamSSE) : il attrape lui-même les
 *   erreurs du flux, les écrit sur la console et termine la réponse proprement (test statique,
 *   serveur-flux.test.ts). Rendre `new Response(readableStream)`.
 *
 * Contrat : serveur.test.ts, serveur-relecture.test.ts, serveur-flux.test.ts,
 * serveur-flux-suites.test.ts, serveur-flux-suites-relecture.test.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import { getRequestListener, RequestError } from '@hono/node-server';
import { journalParDefaut } from './dependances.ts';
import { decrireErreur, journalSur } from './journal.ts';

/** Silence au plus pendant la réception du corps d'une requête. */
export const DELAI_LECTURE_CORPS_MS = 10_000;
/** Réception des en-têtes au plus. */
export const DELAI_EN_TETES_MS = 15_000;
/** Durée au plus d'une requête entière : la valeur par défaut de Node. */
export const DUREE_MAX_REQUETE_MS = 300_000;
/** Corps en flux lu en mémoire au plus pour une requête HTTP/1.0 (32 Mio). */
export const PLAFOND_CORPS_HTTP10_OCTETS = 32 * 1024 * 1024;

export interface OptionsServeur {
  /** `creerApp(...).fetch`. */
  readonly fetch: (requete: Request) => Response | Promise<Response>;
  /** Journal du serveur (une ligne par entrée) ; par défaut la sortie d'erreur. */
  readonly journal?: (ligne: string) => void;
  readonly delaiLectureCorpsMs?: number;
  readonly delaiEnTetesMs?: number;
  /** Plafond du corps lu en mémoire en HTTP/1.0 ; par défaut PLAFOND_CORPS_HTTP10_OCTETS. */
  readonly plafondHttp10Octets?: number;
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

/** Suit la fermeture de la réponse (client parti, ou connexion coupée par nous). */
function suivreFermeture(reponse: Coupable): () => boolean {
  let fermee = false;
  reponse.once('close', () => {
    fermee = true;
  });
  return () => fermee || reponse.destroyed;
}

/**
 * Corps relu tel quel depuis `lecteur`, `premier` (morceau déjà lu) en tête ; si la source lève en
 * cours d'envoi, l'erreur va au journal, la connexion est coupée (`reponse.destroy()`), puis le
 * flux se termine pour @hono/node-server, qui n'écrit plus rien sur une réponse détruite. Il ne
 * voit donc jamais l'erreur. Si la réponse est déjà fermée (client parti : la source lève souvent
 * à l'abandon de `requete.signal`), rien au journal et pas de second `destroy()`.
 */
function corpsSurveille(
  lecteur: ReadableStreamDefaultReader<Uint8Array>,
  premier: Uint8Array,
  reponse: Coupable,
  fermee: () => boolean,
  journal: (ligne: string) => void,
): ReadableStream<Uint8Array> {
  let enAttente: Uint8Array | null = premier;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controleur) {
        if (enAttente !== null) {
          controleur.enqueue(enAttente);
          enAttente = null;
          return;
        }
        let lu: Awaited<ReturnType<typeof lecteur.read>>;
        try {
          lu = await lecteur.read();
        } catch (erreur) {
          if (!fermee()) {
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
 * Corps entier de `lecteur` en mémoire (HTTP/1.0) ; lève si la source lève. Au-delà de `plafond`
 * octets : lecture arrêtée, source annulée, `null`.
 *
 * Plafond atteint pile : on ne tire pas un morceau de plus (une source qui a préparé un morceau
 * d'avance en produirait alors un autre). On regarde seulement si la source s'est déjà terminée,
 * au plus tard au tour suivant de la boucle d'événements ; sinon le corps est tenu pour trop gros.
 * Limite assumée : une source d'exactement `plafond` octets qui ne se ferme que plus tard → 505.
 */
async function lireEnEntier(lecteur: ReadableStreamDefaultReader<Uint8Array>, plafond: number): Promise<Uint8Array | null> {
  const morceaux: Uint8Array[] = [];
  let longueur = 0;
  for (;;) {
    const lu = await lecteur.read();
    if (lu.done) break;
    longueur += lu.value.byteLength;
    if (longueur > plafond) {
      await lecteur.cancel().catch(() => undefined);
      return null;
    }
    morceaux.push(lu.value);
    if (longueur === plafond) {
      const fin = await finDejaConnue(lecteur);
      if (fin === 'erreur') await lecteur.read(); // lève l'erreur de la source
      if (fin !== 'fermee') {
        await lecteur.cancel().catch(() => undefined);
        return null;
      }
      break;
    }
  }
  const corps = new Uint8Array(longueur);
  let position = 0;
  for (const morceau of morceaux) {
    corps.set(morceau, position);
    position += morceau.byteLength;
  }
  return corps;
}

/** La source est-elle déjà fermée (ou en erreur), sans rien en tirer ? Attend au plus un tour. */
function finDejaConnue(lecteur: ReadableStreamDefaultReader<Uint8Array>): Promise<'fermee' | 'erreur' | 'inconnue'> {
  return Promise.race([
    lecteur.closed.then(
      () => 'fermee' as const,
      () => 'erreur' as const,
    ),
    new Promise<'inconnue'>((ok) => {
      setImmediate(() => {
        ok('inconnue');
      });
    }),
  ]);
}

/** Statut qui n'a jamais de corps (1xx, 204, 304). */
function sansCorps(status: number): boolean {
  return status < 200 || status === 204 || status === 304;
}

/** Requête HTTP/1.0 : ni envoi par morceaux, ni fin de corps distincte d'une coupure. */
function enHttp10(requete: IncomingMessage | Http2ServerRequest): boolean {
  return requete.httpVersionMajor === 1 && requete.httpVersionMinor === 0;
}

/** Erreur de délai (DOMException, nom ou classe TimeoutError) ; une lecture qui lève compte pour non. */
function estDelai(erreur: unknown): boolean {
  try {
    if (!(erreur instanceof Error)) return false;
  } catch {
    return false;
  }
  try {
    if (erreur.name === 'TimeoutError') return true;
  } catch {
    // Accesseur `name` piégé : on regarde la classe.
  }
  try {
    return erreur.constructor.name === 'TimeoutError';
  } catch {
    return false;
  }
}

/** Requête illisible (URL, Host) : `instanceof` lui-même peut lever (Proxy piégé). */
function estRequeteIllisible(erreur: unknown): boolean {
  try {
    return erreur instanceof RequestError;
  } catch {
    return false;
  }
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
  const plafondHttp10 = options.plafondHttp10Octets ?? PLAFOND_CORPS_HTTP10_OCTETS;
  const journal = journalSur(options.journal ?? journalParDefaut);
  /** 500 sans corps : jamais rien de l'erreur au client. */
  const reponse500 = (): Response => new Response(null, { status: 500 });
  /**
   * Corps en flux pris en main ; toute autre réponse rendue telle quelle.
   * - HTTP/1.0 sans Content-Length : corps lu en entier, puis envoyé avec un Content-Length exact
   *   (sinon une coupure ressemblerait à une fin). Lecture qui échoue : 500, une ligne au journal.
   * - Sinon : premier morceau attendu avant d'envoyer les en-têtes. Échec avant lui : 500 complet,
   *   une ligne au journal ; échec après : coupure (T10p, `corpsSurveille`).
   */
  const surveiller = async (
    reponse: Response,
    incoming: IncomingMessage | Http2ServerRequest,
    outgoing: Coupable,
  ): Promise<Response> => {
    const flux = fluxDe(reponse);
    if (flux === null) return reponse;
    // Ni `body` ni `statusText` de la réponse d'origine ensuite : ils la convertiraient en
    // Response native, avec un corps déjà verrouillé par le lecteur.
    const { status, headers } = reponse;
    const fermee = suivreFermeture(outgoing);
    const lecteur = flux.getReader();
    // Client parti (avant le premier morceau, pendant la lecture en mémoire) : la source est
    // annulée même si elle ignore `requete.signal`. Après une fin normale, sans effet.
    outgoing.once('close', () => {
      lecteur.cancel().catch(() => undefined);
    });
    const echec = (erreur: unknown, quand: string): Response => {
      if (!fermee()) journal(`[réponse] corps en flux en échec ${quand}, 500 : ${decrireErreur(erreur)}`);
      return reponse500();
    };

    // HTTP/1.0 avec un Content-Length annoncé : reste en flux, sa coupure se voit (corps plus
    // court que l'annonce).
    if (enHttp10(incoming) && !headers.has('content-length')) {
      const enTetes = new Headers(headers);
      // Pas d'envoi par morceaux en HTTP/1.0, même si l'appli l'a demandé.
      enTetes.delete('transfer-encoding');
      if (sansCorps(status)) {
        await lecteur.cancel().catch(() => undefined);
        return new Response(null, { status, headers: enTetes });
      }
      let corps: Uint8Array | null;
      try {
        corps = await lireEnEntier(lecteur, plafondHttp10);
      } catch (erreur) {
        return echec(erreur, 'pendant la lecture en mémoire (HTTP/1.0)');
      }
      if (fermee()) return reponse500();
      if (corps === null) {
        journal(`[réponse] corps en flux au-delà de ${String(plafondHttp10)} octets en HTTP/1.0, 505`);
        return new Response(null, { status: 505 });
      }
      enTetes.set('content-length', String(corps.byteLength));
      return new Response(corps.byteLength === 0 ? null : corps, { status, headers: enTetes });
    }

    let premier: Awaited<ReturnType<typeof lecteur.read>>;
    try {
      premier = await lecteur.read();
    } catch (erreur) {
      return echec(erreur, 'avant le premier morceau');
    }
    if (premier.done) return new Response(null, { status, headers });
    return new Response(corpsSurveille(lecteur, premier.value, outgoing, fermee, journal), { status, headers });
  };
  /**
   * Requête illisible (RequestError) : 400 ; `fetch` (ou l'enveloppe) a levé avant toute réponse :
   * 500 et une ligne au journal, au lieu du 500 muet de @hono/node-server ; délai dépassé
   * (TimeoutError) : 504. Ne lève jamais, même sur une erreur piégée (accesseur `name` ou
   * `constructor`, Proxy) : sinon @hono/node-server écrirait l'erreur sur la console et
   * enverrait `Error: <message>` au client.
   */
  const surErreur = (erreur: unknown): Response => {
    try {
      if (estRequeteIllisible(erreur)) return new Response(null, { status: 400 });
      journal(`[réponse] erreur avant toute réponse : ${decrireErreur(erreur)}`);
      return new Response(null, { status: estDelai(erreur) ? 504 : 500 });
    } catch {
      return reponse500();
    }
  };
  const ecouteur = getRequestListener(
    (requete, { incoming, outgoing }) => {
      const reponse = options.fetch(requete);
      if (reponse instanceof Promise) return reponse.then((r) => surveiller(r, incoming, outgoing));
      // Réponse immédiate sans flux gardée immédiate : @hono/node-server l'envoie sans attente.
      return fluxDe(reponse) === null ? reponse : surveiller(reponse, incoming, outgoing);
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

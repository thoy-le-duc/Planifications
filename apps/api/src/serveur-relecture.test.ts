/**
 * T10f, relecture du chef — délais du serveur HTTP Node (creerServeur, serveur.ts), vrai serveur,
 * socket brute. Complète serveur.test.ts.
 *
 * (a) Keep-alive : une connexion inactive après une réponse est fermée par le serveur au bout de
 *     `keepAliveTimeout` (propriété standard du serveur Node, quelques secondes ; abaissée ici
 *     après creerServeur), y compris après un POST dont l'application n'a pas lu le corps
 *     (401 ou 429 répondu avant lecture). Le délai de lecture du corps ne doit pas l'annuler.
 * (b) Une application qui NE lit PAS le corps et répond après plus que le délai de lecture obtient
 *     sa réponse (GET et POST) : le délai ne vise que le client muet, pas le traitement.
 * (c) Un corps envoyé EN ENTIER par le client, lu par l'application après plus que le délai
 *     (1 Mio : il ne tient pas dans les tampons, la socket paraît inactive), donne 200 ; aucune
 *     erreur ERR_HTTP_HEADERS_SENT journalisée.
 * (f) Durée totale d'une requête (`requestTimeout`) : au moins 300 s, la valeur de Node (un envoi
 *     lent mais légitime n'est jamais coupé en cours). Délai des en-têtes (`headersTimeout`) : au
 *     plus 15 s, et inférieur à `requestTimeout` ; injectable par `delaiEnTetesMs` de
 *     creerServeur : des en-têtes jamais terminés sont coupés en quelques délais.
 */
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

interface OptionsServeur {
  fetch: (requete: Request) => Response | Promise<Response>;
  delaiLectureCorpsMs?: number;
  delaiEnTetesMs?: number;
}

interface ModuleServeur {
  creerServeur(options: OptionsServeur): Server;
}

const CHEMIN_MODULE = './serveur.ts';
const DELAI_TEST = 500;
const KEEP_ALIVE_TEST = 400;
const MIO = 1_048_576;

interface Issue {
  /** Fermeture de la connexion (ms depuis la connexion), null si toujours ouverte à la fin de l'attente. */
  readonly fermeeApresMs: number | null;
  /** Fin de réception de la réponse complète (ms), null si aucune. */
  readonly reponseApresMs: number | null;
  readonly reponse: string;
}

const pause = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

/**
 * Ouvre une socket brute, écrit `envoi` (requête brute, éventuellement incomplète) et attend la
 * fermeture par le serveur (au plus `attenteMaxMs`). La réponse est jugée complète quand le corps
 * annoncé par son Content-Length est arrivé.
 */
function brut(port: number, envoi: string, attenteMaxMs: number): Promise<Issue> {
  return new Promise((resoudre) => {
    const socket = connect(port, '127.0.0.1');
    const debut = Date.now();
    let reponse = '';
    let reponseApresMs: number | null = null;
    let fini = false;
    const finir = (fermee: boolean) => {
      if (fini) return;
      fini = true;
      clearTimeout(garde);
      socket.destroy();
      resoudre({ fermeeApresMs: fermee ? Date.now() - debut : null, reponseApresMs, reponse });
    };
    const garde = setTimeout(() => {
      finir(false);
    }, attenteMaxMs);
    socket.on('data', (d: Buffer) => {
      reponse += d.toString('latin1');
      const fin = reponse.indexOf('\r\n\r\n');
      const longueur = /content-length:\s*(\d+)/i.exec(reponse);
      if (reponseApresMs === null && fin >= 0 && longueur !== null && reponse.length - fin - 4 >= Number(longueur[1])) {
        reponseApresMs = Date.now() - debut;
      }
    });
    socket.on('close', () => {
      finir(true);
    });
    socket.on('error', () => {
      finir(true);
    });
    socket.on('connect', () => {
      socket.write(envoi);
    });
  });
}

const requete = (methode: string, corps: string, connexion: 'keep-alive' | 'close'): string =>
  `${methode} /sync/upload HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: ${connexion}\r\n` +
  (corps === '' && methode === 'GET' ? '' : `Content-Type: application/json\r\nContent-Length: ${String(Buffer.byteLength(corps))}\r\n`) +
  `\r\n${corps}`;

describe('T10f (relecture) : délais du serveur HTTP Node', { timeout: 30_000 }, () => {
  let mod: ModuleServeur;
  let serveur: Server | null = null;

  beforeAll(async () => {
    mod = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleServeur;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const s = serveur;
    serveur = null;
    if (s !== null) {
      s.closeAllConnections();
      await new Promise<void>((ok) =>
        s.close(() => {
          ok();
        }),
      );
    }
  });

  async function demarrer(fetch: OptionsServeur['fetch'], reglages: { keepAliveMs?: number; delaiEnTetesMs?: number } = {}): Promise<number> {
    const s = mod.creerServeur({
      fetch,
      delaiLectureCorpsMs: DELAI_TEST,
      ...(reglages.delaiEnTetesMs === undefined ? {} : { delaiEnTetesMs: reglages.delaiEnTetesMs }),
    });
    if (reglages.keepAliveMs !== undefined) s.keepAliveTimeout = reglages.keepAliveMs;
    serveur = s;
    await new Promise<void>((ok) =>
      s.listen(0, '127.0.0.1', () => {
        ok();
      }),
    );
    return (s.address() as AddressInfo).port;
  }

  describe('(a) keep-alive : connexion inactive fermée après keepAliveTimeout', () => {
    it('après un GET', async () => {
      const port = await demarrer(() => new Response('ok'), { keepAliveMs: KEEP_ALIVE_TEST });
      const issue = await brut(port, requete('GET', '', 'keep-alive'), 15 * KEEP_ALIVE_TEST);
      expect(issue.reponse).toMatch(/^HTTP\/1\.1 200/);
      expect(issue.fermeeApresMs, 'connexion inactive jamais fermée').not.toBeNull();
      expect((issue.fermeeApresMs ?? Infinity) - (issue.reponseApresMs ?? 0)).toBeLessThanOrEqual(KEEP_ALIVE_TEST + 2_000);
    });

    it('après un POST répondu (401) sans que l’application lise le corps', async () => {
      const port = await demarrer(() => Response.json({ erreur: 'non_authentifie' }, { status: 401 }), { keepAliveMs: KEEP_ALIVE_TEST });
      const issue = await brut(port, requete('POST', '{"ecritures":[]}', 'keep-alive'), 15 * KEEP_ALIVE_TEST);
      expect(issue.reponse).toMatch(/^HTTP\/1\.1 401/);
      expect(issue.fermeeApresMs, 'connexion inactive jamais fermée').not.toBeNull();
      expect((issue.fermeeApresMs ?? Infinity) - (issue.reponseApresMs ?? 0)).toBeLessThanOrEqual(KEEP_ALIVE_TEST + 2_000);
    });

    it('après un POST répondu 429 avant lecture, corps encore en route : idem', async () => {
      const port = await demarrer(() => Response.json({ erreur: 'trop_de_requetes' }, { status: 429, headers: { 'retry-after': '30' } }), {
        keepAliveMs: KEEP_ALIVE_TEST,
      });
      const issue = await brut(port, requete('POST', 'x'.repeat(64 * 1_024), 'keep-alive'), 15 * KEEP_ALIVE_TEST);
      expect(issue.reponse).toMatch(/^HTTP\/1\.1 429/);
      expect(issue.fermeeApresMs, 'connexion inactive jamais fermée').not.toBeNull();
      expect((issue.fermeeApresMs ?? Infinity) - (issue.reponseApresMs ?? 0)).toBeLessThanOrEqual(KEEP_ALIVE_TEST + 2_000);
    });

    it('keepAliveTimeout par défaut : quelques secondes (au plus 10 s)', async () => {
      await demarrer(() => new Response('ok'));
      const s = serveur;
      expect(s?.keepAliveTimeout ?? 0).toBeGreaterThan(0);
      expect(s?.keepAliveTimeout ?? Infinity).toBeLessThanOrEqual(10_000);
    });
  });

  describe('(b) une application qui ne lit pas le corps et répond tard obtient sa réponse', () => {
    const tardive = async (): Promise<Response> => {
      await pause(3 * DELAI_TEST);
      return new Response('tard');
    };

    it('GET', async () => {
      const port = await demarrer(tardive);
      const issue = await brut(port, requete('GET', '', 'close'), 20 * DELAI_TEST);
      expect(issue.reponse).toMatch(/^HTTP\/1\.1 200/);
      expect(issue.reponse.endsWith('tard')).toBe(true);
    });

    it('POST (corps envoyé en entier, jamais lu)', async () => {
      const port = await demarrer(tardive);
      const issue = await brut(port, requete('POST', '{"ecritures":[]}', 'close'), 20 * DELAI_TEST);
      expect(issue.reponse).toMatch(/^HTTP\/1\.1 200/);
      expect(issue.reponse.endsWith('tard')).toBe(true);
    });
  });

  it('(c) corps de 1 Mio envoyé en entier, lu après plus que le délai : 200, aucun ERR_HTTP_HEADERS_SENT', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const avertissements: string[] = [];
    const surErreur = (e: unknown) => avertissements.push(String(e));
    process.on('uncaughtException', surErreur);
    process.on('unhandledRejection', surErreur);
    try {
      const port = await demarrer(async (r) => {
        await pause(3 * DELAI_TEST);
        const corps = await r.arrayBuffer();
        return new Response(String(corps.byteLength));
      });
      const issue = await brut(port, requete('POST', 'x'.repeat(MIO), 'close'), 20 * DELAI_TEST);
      expect(issue.reponse).toMatch(/^HTTP\/1\.1 200/);
      expect(issue.reponse.endsWith(String(MIO))).toBe(true);
      await pause(100);
      const traces = [...journal.mock.calls.map((a) => a.map((x) => (x instanceof Error ? `${x.name} ${(x as { code?: string }).code ?? ''} ${x.message}` : String(x))).join(' ')), ...avertissements];
      expect(traces.filter((t) => t.includes('ERR_HTTP_HEADERS_SENT'))).toEqual([]);
    } finally {
      process.off('uncaughtException', surErreur);
      process.off('unhandledRejection', surErreur);
    }
  });

  describe('(f) durée totale et délai des en-têtes', () => {
    it('par défaut : requestTimeout ≥ 300 s (valeur de Node), headersTimeout ≤ 15 s et inférieur', async () => {
      await demarrer(() => new Response('ok'));
      const s = serveur;
      expect(s?.requestTimeout ?? 0, 'requestTimeout').toBeGreaterThanOrEqual(300_000);
      expect(s?.headersTimeout ?? Infinity, 'headersTimeout').toBeLessThanOrEqual(15_000);
      expect(s?.headersTimeout ?? 0).toBeGreaterThan(0);
      expect(s?.headersTimeout ?? Infinity).toBeLessThan(s?.requestTimeout ?? 0);
    });

    it('délai des en-têtes injecté : des en-têtes jamais terminés sont coupés en quelques délais', async () => {
      const port = await demarrer(() => new Response('ok'), { delaiEnTetesMs: DELAI_TEST });
      const issue = await brut(port, 'POST /sync/upload HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Lent: ', 20 * DELAI_TEST);
      expect(issue.fermeeApresMs, 'connexion jamais fermée').not.toBeNull();
      expect(issue.fermeeApresMs ?? Infinity).toBeLessThanOrEqual(5 * DELAI_TEST);
      expect(issue.reponse).not.toMatch(/^HTTP\/1\.1 200/);
    });

    it('sans injection : des en-têtes jamais terminés sont coupés en moins de ~15 s', async () => {
      const port = await demarrer(() => new Response('ok'));
      const issue = await brut(port, 'GET /sante HTTP/1.1\r\nHost: 127.0.0.1\r\n', 20_000);
      expect(issue.fermeeApresMs, 'connexion jamais fermée').not.toBeNull();
      expect(issue.fermeeApresMs ?? Infinity).toBeLessThanOrEqual(17_000);
    });
  });
});

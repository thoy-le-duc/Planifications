/**
 * T10f, règle 3 — délai court de lecture du corps, au niveau du VRAI serveur HTTP de Node.
 *
 * Pourquoi : un client qui annonce `Content-Length: 1000` et n'envoie que 10 octets garde une
 * connexion (et la mémoire qui va avec) ouverte jusqu'au délai de Node, 300 s par défaut. Quelques
 * centaines de téléphones malveillants suffiraient à occuper le serveur. Il doit être coupé en
 * quelques secondes. Mais une saisie légitime ne doit jamais être coupée : un téléphone au fond
 * d'une serre, sur un réseau lent, envoie son corps lentement MAIS sans arrêt ; et une fois le
 * corps reçu, le traitement (base) peut durer plus longtemps que le délai.
 *
 * Contrat (nouveau module apps/api/src/serveur.ts, utilisé par index.ts à la place de `serve`) :
 *
 *   export const DELAI_LECTURE_CORPS_MS: number   // proposé : 10 000
 *   export function creerServeur(options: {
 *     fetch: (requete: Request) => Response | Promise<Response>;   // creerApp(...).fetch
 *     delaiLectureCorpsMs?: number;                                 // défaut DELAI_LECTURE_CORPS_MS
 *   }): import('node:http').Server                                  // pas encore à l'écoute
 *
 *   - Pendant la réception du corps, plus de `delaiLectureCorpsMs` SANS AUCUN octet reçu : la
 *     connexion est coupée (fermée, avec ou sans réponse 408), sans attendre les 300 s de Node ;
 *     l'application ne reçoit jamais de corps complet.
 *   - C'est un délai d'INACTIVITÉ, pas une durée totale : un corps qui arrive lentement mais sans
 *     pause aussi longue passe, même si l'envoi complet dure plusieurs fois le délai.
 *   - Une fois le corps reçu, le délai ne s'applique plus : un traitement plus long que le délai
 *     répond normalement.
 *
 * Le délai est abaissé ici (DELAI_TEST) par injection, pour que le test reste rapide.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

interface ModuleServeur {
  readonly DELAI_LECTURE_CORPS_MS: number;
  creerServeur(options: { fetch: (requete: Request) => Response | Promise<Response>; delaiLectureCorpsMs?: number }): Server;
}

const CHEMIN_MODULE = './serveur.ts';
const DELAI_TEST = 500;

/** Résultat d'une connexion brute : quand elle s'est fermée (ms depuis l'envoi), et ce que le serveur a répondu. */
interface Issue {
  readonly fermeeApresMs: number | null;
  readonly reponse: string;
}

const pause = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

describe('T10f : délai court de lecture du corps (serveur HTTP Node)', { timeout: 15_000 }, () => {
  let mod: ModuleServeur;
  let serveur: Server | null = null;
  /** Corps reçus en entier par l'application. */
  let corpsComplets: number[];

  beforeAll(async () => {
    mod = (await import(/* @vite-ignore */ CHEMIN_MODULE)) as ModuleServeur;
  });

  afterEach(async () => {
    const s = serveur;
    serveur = null;
    if (s !== null) {
      s.closeAllConnections();
      await new Promise<void>((ok) => s.close(() => { ok(); }));
    }
  });

  /** Serveur de test : l'application lit le corps puis attend `traitementMs` avant de répondre sa taille. */
  async function demarrer(traitementMs = 0): Promise<number> {
    corpsComplets = [];
    const s = mod.creerServeur({
      fetch: async (requete) => {
        const corps = await requete.arrayBuffer();
        corpsComplets.push(corps.byteLength);
        if (traitementMs > 0) await pause(traitementMs);
        return new Response(String(corps.byteLength), { status: 200 });
      },
      delaiLectureCorpsMs: DELAI_TEST,
    });
    serveur = s;
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => { ok(); }));
    return (s.address() as AddressInfo).port;
  }

  /**
   * Ouvre une socket brute, envoie l'en-tête (Content-Length annoncé) puis les morceaux de corps
   * avec leurs pauses, et attend la fermeture (au plus `attenteMaxMs`).
   */
  function connexionBrute(port: number, annonce: number, morceaux: readonly { pauseMs: number; octets: number }[], attenteMaxMs: number): Promise<Issue> {
    return new Promise((resoudre) => {
      const socket = connect(port, '127.0.0.1');
      const debut = Date.now();
      let reponse = '';
      let fini = false;
      const finir = (fermee: boolean) => {
        if (fini) return;
        fini = true;
        clearTimeout(garde);
        socket.destroy();
        resoudre({ fermeeApresMs: fermee ? Date.now() - debut : null, reponse });
      };
      const garde = setTimeout(() => { finir(false); }, attenteMaxMs);
      socket.on('data', (d: Buffer) => {
        reponse += d.toString('latin1');
      });
      socket.on('close', () => { finir(true); });
      socket.on('error', () => { finir(true); });
      socket.on('connect', () => {
        socket.write(`POST /sync/upload HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${String(annonce)}\r\n\r\n`);
        void (async () => {
          for (const m of morceaux) {
            if (m.pauseMs > 0) await pause(m.pauseMs);
            if (fini) return;
            socket.write('x'.repeat(m.octets));
          }
        })();
      });
    });
  }

  it('DELAI_LECTURE_CORPS_MS exporté : quelques secondes (entre 1 et 30 s), loin des 300 s de Node', () => {
    expect(mod.DELAI_LECTURE_CORPS_MS).toBeTypeOf('number');
    expect(mod.DELAI_LECTURE_CORPS_MS).toBeGreaterThanOrEqual(1_000);
    expect(mod.DELAI_LECTURE_CORPS_MS).toBeLessThanOrEqual(30_000);
  });

  it('annonce 1 000 octets, en envoie 10 puis se tait : coupé peu après le délai, l’application ne reçoit jamais le corps', async () => {
    const port = await demarrer();
    const issue = await connexionBrute(port, 1_000, [{ pauseMs: 0, octets: 10 }], 10 * DELAI_TEST);
    expect(issue.fermeeApresMs, 'la connexion doit être fermée par le serveur').not.toBeNull();
    expect(issue.fermeeApresMs ?? Infinity).toBeGreaterThanOrEqual(DELAI_TEST * 0.8);
    expect(issue.fermeeApresMs ?? Infinity, 'coupé en quelques délais au plus').toBeLessThanOrEqual(4 * DELAI_TEST);
    expect(issue.reponse, 'jamais de 200').not.toMatch(/^HTTP\/1\.1 200/);
    if (issue.reponse !== '') expect(issue.reponse).toMatch(/^HTTP\/1\.1 408/);
    expect(corpsComplets).toEqual([]);
  });

  it('client lent mais régulier (un morceau toutes les 0,4 × délai, 5 délais en tout) : servi normalement', async () => {
    const port = await demarrer();
    const morceaux = Array.from({ length: 13 }, (_, i) => ({ pauseMs: i === 0 ? 0 : Math.round(0.4 * DELAI_TEST), octets: i < 12 ? 80 : 40 }));
    const issue = await connexionBrute(port, 1_000, morceaux, 20 * DELAI_TEST);
    expect(issue.reponse).toMatch(/^HTTP\/1\.1 200/);
    expect(issue.reponse.endsWith('1000')).toBe(true);
    expect(corpsComplets).toEqual([1_000]);
  });

  it('corps reçu en entier, traitement plus long que le délai (3 délais) : la réponse arrive', async () => {
    const port = await demarrer(3 * DELAI_TEST);
    const issue = await connexionBrute(port, 1_000, [{ pauseMs: 0, octets: 1_000 }], 20 * DELAI_TEST);
    expect(issue.reponse).toMatch(/^HTTP\/1\.1 200/);
    expect(issue.reponse.endsWith('1000')).toBe(true);
  });

  it('un client coupé n’empêche pas les autres : une requête normale juste après passe', async () => {
    const port = await demarrer();
    const [bloquee, normale] = await Promise.all([
      connexionBrute(port, 1_000, [{ pauseMs: 0, octets: 10 }], 10 * DELAI_TEST),
      fetch(`http://127.0.0.1:${String(port)}/sync/upload`, { method: 'POST', body: 'y'.repeat(100) }),
    ]);
    expect(normale.status).toBe(200);
    expect(await normale.text()).toBe('100');
    expect(bloquee.fermeeApresMs).not.toBeNull();
  });

  it('index.ts démarre l’API avec creerServeur (le délai s’applique en production)', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/creerServeur\(/);
  });
});

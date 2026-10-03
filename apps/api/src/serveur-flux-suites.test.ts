/**
 * Tests d'acceptation T10q — réponses en flux : HTTP/1.0, erreur avant le premier morceau,
 * `surErreur` (400, 504, jamais d'exception).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 *   creerServeur({ fetch, journal?: (ligne: string) => void, ... })      (serveur.ts)
 *
 * 1. Requête HTTP/1.0 dont la réponse serait en flux (corps ReadableStream sans Content-Length) :
 *    pas d'envoi en flux. En HTTP/1.0 il n'y a pas d'envoi par morceaux : la fin du corps n'est
 *    marquée que par la fermeture, et une réponse coupée ressemble à une réponse complète. Le
 *    serveur lit donc le corps entier en mémoire et répond avec un Content-Length exact. Si la
 *    lecture échoue (avant ou après le premier morceau) : 500 propre, aucun octet du corps, une
 *    ligne au journal (decrireErreur), rien sur la console.
 *    Les réponses HTTP/1.1 restent en flux (témoin : envoi par morceaux).
 *    apps/api/README.md, section de déploiement : le proxy parle HTTP/1.1 à l'API (nginx parle
 *    HTTP/1.0 à l'amont par défaut).
 * 2. HTTP/1.1, flux qui échoue AVANT son premier morceau : 500 propre (réponse complète, pas
 *    « 200 puis coupure »), une ligne au journal, rien sur la console. Flux qui émet puis échoue :
 *    comportement T10p inchangé (200, morceau reçu, connexion coupée, réponse jamais complète).
 * 3. `surErreur` (errorHandler de @hono/node-server) :
 *    - requête illisible (RequestError : URL absolue invalide, en-tête Host invalide) → 400, sans
 *      appeler `fetch`, rien sur la console ;
 *    - `fetch` lève (ou rejette) une erreur de délai (nom ou classe TimeoutError) → 504, une ligne
 *      au journal ;
 *    - ne lève jamais, même sur une erreur piégée (accesseur `name` ou `constructor` qui lève,
 *      Proxy dont le prototype est illisible) : une réponse 500, une ligne propre au journal, rien
 *      sur la console, ni « Error: » ni le message au client.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrireErreur } from './journal.ts';
import { creerServeur } from './serveur.ts';

/** Message piégé : saisie, adresse, et fausse entrée de journal après un saut de ligne. */
const PIEGE = 'tomate jean@exemple.fr\n[faux]';
const MORCEAUX_INTERDITS = ['tomate', 'jean@exemple.fr', '[faux]'];
const SAUT_OU_CONTROLE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const DEBUT = 'debut-du-flux;';
const MORCEAUX_SAINS = [DEBUT, 'milieu-du-flux;', 'fin-du-flux'];

const pause = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const encodeur = new TextEncoder();
const EN_TETE_CSV = { status: 200, headers: { 'content-type': 'text/csv' } };

/** Requête brute GET, en HTTP/1.0 ou HTTP/1.1. */
function requeteBrute(version: '1.0' | '1.1', chemin = '/export.csv'): string {
  return version === '1.0'
    ? `GET ${chemin} HTTP/1.0\r\nHost: localhost\r\n\r\n`
    : `GET ${chemin} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`;
}

/** Corps lent qui envoie MORCEAUX_SAINS (30 ms entre chaque) puis se termine normalement. */
function fluxSainLent(): ReadableStream<Uint8Array> {
  const reste = [...MORCEAUX_SAINS];
  return new ReadableStream<Uint8Array>({
    async pull(controleur) {
      await pause(30);
      const suivant = reste.shift();
      if (suivant === undefined) controleur.close();
      else controleur.enqueue(encodeur.encode(suivant));
    },
  });
}

/** Corps qui envoie DEBUT, puis lève `erreur` après `delaiMs`. */
function fluxQuiCasseApres(erreur: unknown, delaiMs: number): ReadableStream<Uint8Array> {
  let envoye = false;
  return new ReadableStream<Uint8Array>({
    async pull(controleur) {
      if (!envoye) {
        envoye = true;
        controleur.enqueue(encodeur.encode(DEBUT));
        return;
      }
      await pause(delaiMs);
      throw erreur;
    },
  });
}

/** Corps qui échoue avant tout morceau : `throw` dans pull (après `delaiMs`) ou controleur.error. */
function fluxQuiCasseAvant(erreur: unknown, delaiMs: number, maniere: 'throw' | 'controleur.error'): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controleur) {
      if (delaiMs > 0) await pause(delaiMs);
      if (maniere === 'throw') throw erreur;
      controleur.error(erreur);
    },
  });
}

interface Essai {
  /** Octets bruts reçus par le client (ligne d'état, en-têtes, corps), en latin1. */
  readonly brut: string;
  readonly lignes: readonly string[];
  /** Tout ce qui est parti sur la console ou sur process.stderr. */
  readonly sorties: readonly string[];
}

let serveur: Server | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  const s = serveur;
  serveur = null;
  if (s !== null) {
    s.closeAllConnections();
    await new Promise<void>((ok) => s.close(() => { ok(); }));
  }
});

/** Démarre un serveur de test sur `fetch`, envoie `requete` sur une socket brute, lit tout. */
async function essayer(fetch: (requete: Request) => Response | Promise<Response>, requete: string): Promise<Essai> {
  const lignes: string[] = [];
  const sorties: string[] = [];
  const capter = (...args: unknown[]): void => {
    sorties.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ''}` : String(a))).join(' '));
  };
  for (const methode of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, methode).mockImplementation(capter);
  vi.spyOn(process.stderr, 'write').mockImplementation((morceau: unknown) => {
    sorties.push(typeof morceau === 'string' ? morceau : Buffer.from(morceau as Uint8Array).toString('utf8'));
    return true;
  });

  const s = creerServeur({
    fetch,
    journal: (ligne: string) => {
      lignes.push(ligne);
    },
  });
  serveur = s;
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => { ok(); }));
  const port = (s.address() as AddressInfo).port;

  const brut = await new Promise<string>((ok) => {
    const morceaux: Buffer[] = [];
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(requete);
    });
    const fin = (): void => {
      clearTimeout(garde);
      ok(Buffer.concat(morceaux).toString('latin1'));
    };
    const garde = setTimeout(() => {
      socket.destroy();
    }, 3_000);
    socket.on('data', (m: Buffer) => morceaux.push(m));
    socket.on('error', () => {
      // Connexion coupée par le serveur : attendu dans certains cas.
    });
    socket.on('close', fin);
  });

  // L'entrée du journal peut partir juste après la fermeture de la connexion.
  for (let i = 0; i < 50 && lignes.length === 0; i++) await pause(10);
  await pause(50);
  return { brut, lignes, sorties };
}

function statut(brut: string): number {
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(brut);
  return m === null ? 0 : Number(m[1]);
}

function entetesDe(brut: string): string {
  const separation = brut.indexOf('\r\n\r\n');
  return separation < 0 ? brut.toLowerCase() : brut.slice(0, separation).toLowerCase();
}

function corpsDe(brut: string): string {
  const separation = brut.indexOf('\r\n\r\n');
  return separation < 0 ? '' : brut.slice(separation + 4);
}

function contentLength(brut: string): number | null {
  const m = /\r\ncontent-length:\s*(\d+)/.exec(entetesDe(brut));
  return m === null ? null : Number(m[1]);
}

function enMorceaux(brut: string): boolean {
  return /\r\ntransfer-encoding:\s*chunked/.test(entetesDe(brut));
}

/** Une réponse HTTP brute a-t-elle l'air complète (corps entier, fin d'envoi reçue) ? */
function completeEnApparence(brut: string): boolean {
  if (!brut.includes('\r\n\r\n')) return false;
  const corps = corpsDe(brut);
  if (enMorceaux(brut)) return corps.endsWith('0\r\n\r\n');
  const longueur = contentLength(brut);
  if (longueur !== null) return Buffer.byteLength(corps, 'latin1') >= longueur;
  // Ni l'un ni l'autre : fin de corps = fermeture, indiscernable d'une coupure ; on la tient pour complète.
  return true;
}

function verifierClientMuet(essai: Essai): void {
  expect(essai.brut, 'pas de « Error: » au client').not.toContain('Error:');
  for (const morceau of MORCEAUX_INTERDITS) expect(essai.brut, `le client ne reçoit pas « ${morceau} »`).not.toContain(morceau);
}

/** Exactement une ligne au journal, propre ; rien sur la console. */
function verifierUneLignePropre(essai: Essai): void {
  expect(essai.lignes, 'exactement une ligne au journal injecté').toHaveLength(1);
  for (const ligne of essai.lignes) {
    expect(ligne, 'entrée sur une seule ligne').not.toMatch(SAUT_OU_CONTROLE);
    for (const morceau of MORCEAUX_INTERDITS) expect(ligne, `l'entrée ne cite pas « ${morceau} »`).not.toContain(morceau);
  }
  expect(essai.sorties, 'rien sur la console ni sur process.stderr').toEqual([]);
}

/** 500 propre : statut 500, réponse complète en apparence, aucun octet du corps d'origine. */
function verifier500Propre(essai: Essai): void {
  expect(statut(essai.brut), `500 attendu :\n${essai.brut}`).toBe(500);
  expect(completeEnApparence(essai.brut), `500 complet, pas coupé :\n${essai.brut}`).toBe(true);
  expect(essai.brut, 'aucun octet du corps d’origine').not.toContain(DEBUT);
}

// ── 1. HTTP/1.0 ──────────────────────────────────────────────────────────────────────────────

describe('T10q — requête HTTP/1.0 : pas de réponse en flux', { timeout: 10_000 }, () => {
  it('flux sain : réponse entière, Content-Length exact, pas d’envoi par morceaux, rien au journal', async () => {
    const essai = await essayer(() => new Response(fluxSainLent(), EN_TETE_CSV), requeteBrute('1.0'));
    const attendu = MORCEAUX_SAINS.join('');
    expect(statut(essai.brut), essai.brut).toBe(200);
    expect(enMorceaux(essai.brut), 'pas de Transfer-Encoding: chunked').toBe(false);
    expect(contentLength(essai.brut), `Content-Length exact :\n${essai.brut}`).toBe(Buffer.byteLength(attendu));
    expect(corpsDe(essai.brut)).toBe(attendu);
    expect(essai.lignes).toEqual([]);
    expect(essai.sorties).toEqual([]);
  });

  it('flux sain, fetch asynchrone : même chose', async () => {
    const essai = await essayer(async () => {
      await pause(10);
      return new Response(fluxSainLent(), EN_TETE_CSV);
    }, requeteBrute('1.0'));
    const attendu = MORCEAUX_SAINS.join('');
    expect(statut(essai.brut), essai.brut).toBe(200);
    expect(contentLength(essai.brut), `Content-Length exact :\n${essai.brut}`).toBe(Buffer.byteLength(attendu));
    expect(corpsDe(essai.brut)).toBe(attendu);
  });

  it('flux qui échoue après un morceau : 500 propre, pas de corps tronqué, une ligne au journal', async () => {
    const erreur = new RangeError(PIEGE);
    const essai = await essayer(() => new Response(fluxQuiCasseApres(erreur, 50), EN_TETE_CSV), requeteBrute('1.0'));
    verifier500Propre(essai);
    verifierClientMuet(essai);
    verifierUneLignePropre(essai);
    expect(essai.lignes.join('\n'), 'la ligne décrit l’erreur par decrireErreur').toContain(decrireErreur(erreur));
  });

  it('flux qui échoue avant tout morceau : 500 propre, une ligne au journal', async () => {
    const erreur = new RangeError(PIEGE);
    const essai = await essayer(() => new Response(fluxQuiCasseAvant(erreur, 50, 'throw'), EN_TETE_CSV), requeteBrute('1.0'));
    verifier500Propre(essai);
    verifierClientMuet(essai);
    verifierUneLignePropre(essai);
    expect(essai.lignes.join('\n')).toContain(decrireErreur(erreur));
  });

  it('témoin : c.text en HTTP/1.0 garde son Content-Length et son corps', async () => {
    const app = new Hono();
    app.get('/texte', (c) => c.text('bonjour'));
    const essai = await essayer(app.fetch, requeteBrute('1.0', '/texte'));
    expect(statut(essai.brut)).toBe(200);
    expect(contentLength(essai.brut)).toBe(7);
    expect(corpsDe(essai.brut)).toBe('bonjour');
    expect(essai.lignes).toEqual([]);
  });

  it('témoin : en HTTP/1.1, le même flux reste envoyé par morceaux (pas mis en mémoire)', async () => {
    const essai = await essayer(() => new Response(fluxSainLent(), EN_TETE_CSV), requeteBrute('1.1'));
    expect(statut(essai.brut)).toBe(200);
    expect(enMorceaux(essai.brut), `Transfer-Encoding: chunked attendu :\n${essai.brut}`).toBe(true);
    expect(completeEnApparence(essai.brut)).toBe(true);
    for (const morceau of MORCEAUX_SAINS) expect(essai.brut).toContain(morceau);
  });
});

describe('T10q — README : le proxy parle HTTP/1.1 à l’API', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

  /** Sections `## …` / `### …` dont le titre parle de déploiement, avec leur texte. */
  function sectionsDeploiement(): string[] {
    const sections: string[] = [];
    let courante: string[] | null = null;
    for (const ligne of readme.split('\n')) {
      const titre = /^#{2,3}\s+(.*)$/.exec(ligne);
      if (titre !== null) {
        if (courante !== null) sections.push(courante.join('\n'));
        courante = /d[ée]ploi/i.test(titre[1] ?? '') ? [] : null;
      } else if (courante !== null) courante.push(ligne);
    }
    if (courante !== null) sections.push(courante.join('\n'));
    return sections;
  }

  it('une section de déploiement existe', () => {
    expect(sectionsDeploiement().length, 'titre ## ou ### contenant « Déploiement »').toBeGreaterThan(0);
  });

  it('elle exige un proxy en HTTP/1.1 vers l’API (une phrase cite « HTTP/1.1 » et le proxy)', () => {
    const phrases = sectionsDeploiement()
      .join('\n')
      .split(/(?<=[.!?;])\s+|\n\s*\n/);
    const trouvee = phrases.some((p) => p.includes('HTTP/1.1') && /proxy/i.test(p));
    expect(trouvee, 'phrase contenant « HTTP/1.1 » et « proxy » dans la section de déploiement').toBe(true);
  });
});

// ── 2. HTTP/1.1, échec avant le premier morceau ──────────────────────────────────────────────

describe('T10q — HTTP/1.1 : flux qui échoue avant son premier morceau', { timeout: 10_000 }, () => {
  for (const [nom, delaiMs, maniere] of [
    ['throw immédiat dans pull', 0, 'throw'],
    ['throw dans pull après 50 ms', 50, 'throw'],
    ['controleur.error dans pull après 50 ms', 50, 'controleur.error'],
  ] as const) {
    for (const asynchrone of [false, true]) {
      it(`${nom}${asynchrone ? ' (fetch asynchrone)' : ''} : 500 propre, une ligne au journal, rien sur la console`, async () => {
        const erreur = new RangeError(PIEGE);
        const reponse = (): Response => new Response(fluxQuiCasseAvant(erreur, delaiMs, maniere), EN_TETE_CSV);
        const essai = await essayer(asynchrone ? async () => { await pause(10); return reponse(); } : reponse, requeteBrute('1.1'));
        verifier500Propre(essai);
        verifierClientMuet(essai);
        verifierUneLignePropre(essai);
        expect(essai.lignes.join('\n'), 'la ligne décrit l’erreur par decrireErreur').toContain(decrireErreur(erreur));
      });
    }
  }

  it('flux qui émet puis échoue : comportement T10p inchangé (200, morceau reçu, réponse coupée)', async () => {
    const erreur = new RangeError(PIEGE);
    const essai = await essayer(() => new Response(fluxQuiCasseApres(erreur, 50), EN_TETE_CSV), requeteBrute('1.1'));
    expect(statut(essai.brut), essai.brut).toBe(200);
    expect(essai.brut, 'le premier morceau est parti').toContain(DEBUT);
    expect(completeEnApparence(essai.brut), `réponse coupée, pas terminée proprement :\n${essai.brut}`).toBe(false);
    verifierClientMuet(essai);
    verifierUneLignePropre(essai);
  });
});

// ── 3. surErreur ─────────────────────────────────────────────────────────────────────────────

describe('T10q — surErreur : requête illisible → 400', { timeout: 10_000 }, () => {
  for (const [nom, requete] of [
    ['URL absolue invalide', 'GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'],
    ['en-tête Host invalide', 'GET / HTTP/1.1\r\nHost: a/b\r\nConnection: close\r\n\r\n'],
  ] as const) {
    it(`${nom} : 400, fetch jamais appelé, rien sur la console`, async () => {
      let appels = 0;
      const essai = await essayer(() => {
        appels++;
        return new Response('ok');
      }, requete);
      expect(statut(essai.brut), essai.brut).toBe(400);
      expect(completeEnApparence(essai.brut)).toBe(true);
      expect(appels, 'fetch n’est pas appelé sur une requête illisible').toBe(0);
      expect(essai.brut).not.toContain('Error:');
      expect(essai.sorties).toEqual([]);
    });
  }
});

describe('T10q — surErreur : délai dépassé → 504', { timeout: 10_000 }, () => {
  class TimeoutError extends Error {}
  const cas: readonly (readonly [string, () => Error])[] = [
    ['DOMException TimeoutError', () => new DOMException(PIEGE, 'TimeoutError')],
    ['Error nommée TimeoutError', () => Object.assign(new Error(PIEGE), { name: 'TimeoutError' })],
    ['classe TimeoutError', () => new TimeoutError(PIEGE)],
  ];
  for (const [nom, fabriquer] of cas) {
    for (const asynchrone of [false, true]) {
      it(`${nom}, fetch ${asynchrone ? 'qui rejette' : 'qui lève'} : 504, une ligne propre au journal, client muet`, async () => {
        const essai = await essayer(
          asynchrone
            ? () => Promise.reject(fabriquer())
            : () => {
                throw fabriquer();
              },
          requeteBrute('1.1'),
        );
        expect(statut(essai.brut), essai.brut).toBe(504);
        expect(completeEnApparence(essai.brut)).toBe(true);
        verifierClientMuet(essai);
        verifierUneLignePropre(essai);
      });
    }
  }
});

describe('T10q — surErreur ne lève jamais', { timeout: 10_000 }, () => {
  /** Erreur dont l'accesseur `name` lève. */
  class NomPiege extends Error {
    override get name(): string {
      throw new Error(PIEGE);
    }
  }
  const cas: readonly (readonly [string, () => Error])[] = [
    ['accesseur `name` qui lève', () => new NomPiege(PIEGE)],
    [
      'accesseur `constructor` qui lève',
      () =>
        Object.defineProperty(new RangeError(PIEGE), 'constructor', {
          get(): never {
            throw new Error(PIEGE);
          },
        }),
    ],
    [
      'accesseurs `name` et `constructor` qui lèvent',
      () =>
        Object.defineProperty(new NomPiege(PIEGE), 'constructor', {
          get(): never {
            throw new Error(PIEGE);
          },
        }),
    ],
    [
      'Proxy dont le prototype est illisible (instanceof lève)',
      () =>
        new Proxy(new RangeError(PIEGE), {
          getPrototypeOf(): never {
            throw new Error(PIEGE);
          },
        }),
    ],
  ];
  for (const [nom, fabriquer] of cas) {
    for (const asynchrone of [false, true]) {
      it(`${nom}, fetch ${asynchrone ? 'qui rejette' : 'qui lève'} : 500, une ligne propre au journal, rien sur la console`, async () => {
        const essai = await essayer(
          asynchrone
            ? () => Promise.reject(fabriquer())
            : () => {
                throw fabriquer();
              },
          requeteBrute('1.1'),
        );
        expect(statut(essai.brut), essai.brut).toBe(500);
        expect(completeEnApparence(essai.brut)).toBe(true);
        verifierClientMuet(essai);
        verifierUneLignePropre(essai);
      });
    }
  }
});

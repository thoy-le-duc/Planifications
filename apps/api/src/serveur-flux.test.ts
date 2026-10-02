/**
 * Tests d'acceptation T10p — erreur d'envoi d'une réponse en flux : même règle que T10m.
 *
 * Constat : quand le corps d'une réponse en flux (ReadableStream) échoue en cours d'envoi,
 * @hono/node-server écrit l'erreur brute sur la console (`console.error(e)`, message et pile) et,
 * selon le moment, renvoie `Error: <message>` au client ou termine proprement une réponse
 * tronquée (Content-Length calculé sur le seul premier morceau). Le premier export en flux
 * ouvrirait cette fuite.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 *   creerServeur({ fetch, journal?: (ligne: string) => void, ... })      (serveur.ts)
 *
 * - Une erreur levée par le corps en flux pendant l'envoi est écrite dans le journal injecté :
 *   au moins une entrée, chacune sur une ligne, qui contient `decrireErreur(erreur)` (classe,
 *   positions de pile ; jamais le message).
 * - Rien sur la console (console.error/warn/log/info) ni sur process.stderr : tout passe par le
 *   journal.
 * - Le client ne reçoit ni « Error: », ni le message de l'erreur.
 * - Le client ne reçoit pas une réponse qui a l'air complète : soit un 5xx (si l'erreur arrive
 *   avant l'envoi des en-têtes), soit une réponse coupée (ni le dernier morceau « 0\r\n\r\n » d'un
 *   envoi par morceaux, ni un corps de la longueur annoncée). Un export tronqué ne doit jamais
 *   passer pour un export entier.
 * - Témoin : un flux qui se termine normalement arrive en entier, rien au journal.
 *
 * index.ts (test statique, dans l'esprit de journal-serveur.test.ts) : l'appel à creerServeur
 * reçoit le journal unique de l'API (`journal`, la variable bâtie par journalSur), en propriété
 * `journal` de son objet d'options (`{ fetch: app.fetch, journal }` ou `journal: journal`).
 *
 * Deux moments d'échec sont essayés : juste après le premier morceau (pendant que
 * @hono/node-server lit les premiers morceaux avant d'écrire les en-têtes), et plus tard (en-têtes
 * déjà partis, envoi par morceaux en cours).
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrireErreur } from './journal.ts';
import { creerServeur } from './serveur.ts';

/** Message piégé : saisie, adresse, et fausse entrée de journal après un saut de ligne. */
const PIEGE = 'tomate jean@exemple.fr\n[faux]';
const MORCEAUX_INTERDITS = ['tomate', 'jean@exemple.fr', '[faux]'];
const SAUT_OU_CONTROLE = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const DEBUT = 'debut-du-flux;';

const pause = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const encodeur = new TextEncoder();

/** Corps qui envoie DEBUT puis lève `erreur`, tout de suite ou après `delaiMs`. */
function fluxQuiCasse(erreur: Error, delaiMs: number): ReadableStream<Uint8Array> {
  let envoye = false;
  return new ReadableStream<Uint8Array>({
    async pull(controleur) {
      if (!envoye) {
        envoye = true;
        controleur.enqueue(encodeur.encode(DEBUT));
        return;
      }
      if (delaiMs > 0) await pause(delaiMs);
      throw erreur;
    },
  });
}

/** Corps qui envoie deux morceaux et se termine normalement. */
function fluxSain(): ReadableStream<Uint8Array> {
  const morceaux = [DEBUT, 'fin-du-flux'];
  return new ReadableStream<Uint8Array>({
    async pull(controleur) {
      await pause(10);
      const suivant = morceaux.shift();
      if (suivant === undefined) controleur.close();
      else controleur.enqueue(encodeur.encode(suivant));
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

/** Démarre un serveur de test dont l'unique route répond `corps()`, et lit la réponse brute. */
async function essayer(corps: () => ReadableStream<Uint8Array>): Promise<Essai> {
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
    fetch: () => new Response(corps(), { status: 200, headers: { 'content-type': 'text/csv' } }),
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
      socket.write('GET /export.csv HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
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
      // Connexion coupée par le serveur : attendu quand le flux casse.
    });
    socket.on('close', fin);
  });

  // L'entrée du journal peut partir juste après la fermeture de la connexion.
  for (let i = 0; i < 50 && lignes.length === 0; i++) await pause(10);
  await pause(20);
  return { brut, lignes, sorties };
}

/** Une réponse HTTP/1.1 brute a-t-elle l'air complète (corps entier, fin d'envoi reçue) ? */
function completeEnApparence(brut: string): boolean {
  const separation = brut.indexOf('\r\n\r\n');
  if (separation < 0) return false;
  const entetes = brut.slice(0, separation).toLowerCase();
  const corps = brut.slice(separation + 4);
  if (/\r\ntransfer-encoding:\s*chunked/.test(entetes)) return corps.endsWith('0\r\n\r\n');
  const longueur = /\r\ncontent-length:\s*(\d+)/.exec(entetes);
  if (longueur !== null) return Buffer.byteLength(corps, 'latin1') >= Number(longueur[1]);
  // Ni l'un ni l'autre : fin de corps = fermeture, indiscernable d'une coupure ; on la tient pour complète.
  return true;
}

function statut(brut: string): number {
  const m = /^HTTP\/1\.1 (\d{3})/.exec(brut);
  return m === null ? 0 : Number(m[1]);
}

describe('T10p — réponse en flux qui échoue en cours d’envoi', { timeout: 10_000 }, () => {
  for (const [nom, delaiMs] of [
    ['juste après le premier morceau', 0],
    ['plus tard, en-têtes déjà partis', 50],
  ] as const) {
    describe(nom, () => {
      it('le client ne reçoit ni « Error: » ni le message', async () => {
        const essai = await essayer(() => fluxQuiCasse(new RangeError(PIEGE), delaiMs));
        expect(essai.brut, 'pas de « Error: » au client').not.toContain('Error:');
        for (const morceau of MORCEAUX_INTERDITS) expect(essai.brut, `le client ne reçoit pas « ${morceau} »`).not.toContain(morceau);
      });

      it('rien sur la console ni sur process.stderr', async () => {
        const essai = await essayer(() => fluxQuiCasse(new RangeError(PIEGE), delaiMs));
        expect(essai.sorties, 'aucune sortie brute : tout passe par le journal injecté').toEqual([]);
      });

      it('le journal injecté reçoit une ligne propre : decrireErreur(erreur), sans le message', async () => {
        const erreur = new RangeError(PIEGE);
        const essai = await essayer(() => fluxQuiCasse(erreur, delaiMs));
        expect(essai.lignes.length, 'au moins une entrée dans le journal injecté').toBeGreaterThan(0);
        for (const ligne of essai.lignes) {
          expect(ligne, 'entrée sur une seule ligne').not.toMatch(SAUT_OU_CONTROLE);
          for (const morceau of MORCEAUX_INTERDITS) expect(ligne, `l'entrée ne cite pas « ${morceau} »`).not.toContain(morceau);
        }
        const description = decrireErreur(erreur);
        expect(description, 'témoin : la description cite la classe').toContain('RangeError');
        expect(essai.lignes.join('\n'), 'l’entrée décrit l’erreur par decrireErreur').toContain(description);
      });

      it('le client ne reçoit pas une réponse qui a l’air complète (5xx ou réponse coupée)', async () => {
        const essai = await essayer(() => fluxQuiCasse(new RangeError(PIEGE), delaiMs));
        const code = statut(essai.brut);
        if (code < 500) expect(completeEnApparence(essai.brut), `réponse ${String(code)} coupée, pas terminée proprement :\n${essai.brut}`).toBe(false);
      });
    });
  }

  it('témoin : un flux qui se termine normalement arrive en entier, rien au journal ni sur la console', async () => {
    const essai = await essayer(fluxSain);
    expect(statut(essai.brut)).toBe(200);
    expect(completeEnApparence(essai.brut)).toBe(true);
    expect(essai.brut).toContain(DEBUT);
    expect(essai.brut).toContain('fin-du-flux');
    expect(essai.lignes).toEqual([]);
    expect(essai.sorties).toEqual([]);
  });
});

describe('T10p — index.ts passe le journal à creerServeur', () => {
  const texte = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('index.ts', texte, ts.ScriptTarget.Latest, true);

  /** Objets d'options de chaque appel `creerServeur({...})`. */
  function appelsCreerServeur(): ts.ObjectLiteralExpression[] {
    const trouves: ts.ObjectLiteralExpression[] = [];
    const visiter = (noeud: ts.Node): void => {
      if (ts.isCallExpression(noeud) && ts.isIdentifier(noeud.expression) && noeud.expression.text === 'creerServeur') {
        const [options] = noeud.arguments;
        if (options !== undefined && ts.isObjectLiteralExpression(options)) trouves.push(options);
      }
      ts.forEachChild(noeud, visiter);
    };
    visiter(source);
    return trouves;
  }

  it('témoin : index.ts appelle creerServeur avec un objet d’options', () => {
    expect(appelsCreerServeur().length).toBeGreaterThan(0);
  });

  it('chaque appel à creerServeur reçoit `journal` : le journal unique de l’API', () => {
    const appels = appelsCreerServeur();
    expect(appels.length).toBeGreaterThan(0);
    for (const options of appels) {
      const propriete = options.properties.find((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'journal');
      expect(propriete, `creerServeur(${options.getText(source)}) sans journal`).toBeDefined();
      if (propriete === undefined) continue;
      const valeur = ts.isShorthandPropertyAssignment(propriete)
        ? 'journal'
        : ts.isPropertyAssignment(propriete)
          ? propriete.initializer.getText(source)
          : null;
      expect(valeur, 'la valeur est la variable `journal` d’index.ts').toBe('journal');
    }
  });
});

// ── Relecture T10p : cas supplémentaires ─────────────────────────────────────────────────────
//
// - Client qui coupe pendant un flux : `cancel` remonte à la source, et AUCUNE ligne au journal
//   (un client parti n'est pas une erreur du serveur), rien sur la console. Y compris quand la
//   source est liée à `requete.signal` et lève à l'abandon.
// - Témoin : `c.json` et `c.text` gardent leur Content-Length (pas d'envoi en morceaux) ; casse si
//   une mise à jour de @hono/node-server ou l'enveloppe du flux changent cela.
// - Flux déjà verrouillé (getReader lève) : 500, une ligne propre au journal, rien sur la console.
// - Erreur dans `start` avant tout octet, erreur non-Error (chaîne), fetch asynchrone : journal
//   propre, rien sur la console, réponse jamais complète.

interface Options {
  /** Le client coupe la connexion dès qu'il a reçu ce texte. */
  readonly couperApres?: string;
  readonly chemin?: string;
}

/** Comme `essayer`, avec un `fetch` quelconque (synchrone ou non) et un client qui peut couper. */
async function essayerFetch(fetch: (requete: Request) => Response | Promise<Response>, options: Options = {}): Promise<Essai> {
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
      socket.write(`GET ${options.chemin ?? '/export.csv'} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    const fin = (): void => {
      clearTimeout(garde);
      ok(Buffer.concat(morceaux).toString('latin1'));
    };
    const garde = setTimeout(() => {
      socket.destroy();
    }, 3_000);
    socket.on('data', (m: Buffer) => {
      morceaux.push(m);
      if (options.couperApres !== undefined && Buffer.concat(morceaux).toString('latin1').includes(options.couperApres)) socket.destroy();
    });
    socket.on('error', () => {
      // Connexion coupée : attendu.
    });
    socket.on('close', fin);
  });

  // Laisser au serveur le temps de voir la coupure et d'écrire (ou non) au journal.
  for (let i = 0; i < 30 && lignes.length === 0; i++) await pause(10);
  await pause(50);
  return { brut, lignes, sorties };
}

function verifierJournalPropre(essai: Essai): void {
  expect(essai.lignes.length, 'au moins une entrée dans le journal injecté').toBeGreaterThan(0);
  for (const ligne of essai.lignes) {
    expect(ligne, 'entrée sur une seule ligne').not.toMatch(SAUT_OU_CONTROLE);
    for (const morceau of MORCEAUX_INTERDITS) expect(ligne, `l'entrée ne cite pas « ${morceau} »`).not.toContain(morceau);
  }
  expect(essai.sorties, 'rien sur la console ni sur process.stderr').toEqual([]);
}

function verifierClientMuet(essai: Essai): void {
  expect(essai.brut, 'pas de « Error: » au client').not.toContain('Error:');
  for (const morceau of MORCEAUX_INTERDITS) expect(essai.brut, `le client ne reçoit pas « ${morceau} »`).not.toContain(morceau);
}

function verifierJamaisComplete(essai: Essai): void {
  const code = statut(essai.brut);
  if (code < 500) expect(completeEnApparence(essai.brut), `réponse ${String(code)} coupée, pas terminée proprement :\n${essai.brut}`).toBe(false);
}

describe('T10p (relecture) — le client coupe pendant un flux', { timeout: 10_000 }, () => {
  it('source sans lien au signal : `cancel` remonte à la source, aucune ligne au journal, rien sur la console', async () => {
    const etat = { annulee: false };
    const essai = await essayerFetch(() => {
      const source = new ReadableStream<Uint8Array>({
        async pull(controleur) {
          await pause(20);
          controleur.enqueue(encodeur.encode(DEBUT));
        },
        cancel() {
          etat.annulee = true;
        },
      });
      return new Response(source, { status: 200, headers: { 'content-type': 'text/csv' } });
    }, { couperApres: DEBUT });
    for (let i = 0; i < 50 && !etat.annulee; i++) await pause(10);
    expect(essai.brut, 'témoin : le client a reçu un morceau avant de couper').toContain(DEBUT);
    expect(etat.annulee, 'cancel appelé sur la source').toBe(true);
    expect(essai.lignes, 'aucune ligne : un client parti n’est pas une erreur').toEqual([]);
    expect(essai.sorties, 'rien sur la console').toEqual([]);
  });

  it('source liée à requete.signal (lève à l’abandon) : aucune ligne au journal, rien sur la console', async () => {
    const etat = { abandonnee: false };
    const essai = await essayerFetch((requete) => {
      const source = new ReadableStream<Uint8Array>({
        start(controleur) {
          requete.signal.addEventListener('abort', () => {
            etat.abandonnee = true;
            controleur.error(new RangeError(PIEGE));
          });
        },
        async pull(controleur) {
          await pause(20);
          if (!requete.signal.aborted) controleur.enqueue(encodeur.encode(DEBUT));
        },
      });
      return new Response(source, { status: 200, headers: { 'content-type': 'text/csv' } });
    }, { couperApres: DEBUT });
    for (let i = 0; i < 50 && !etat.abandonnee; i++) await pause(10);
    await pause(50);
    expect(essai.brut, 'témoin : le client a reçu un morceau avant de couper').toContain(DEBUT);
    expect(etat.abandonnee, 'témoin : le signal de la requête a été abandonné').toBe(true);
    expect(essai.lignes, 'aucune ligne : un client parti n’est pas une erreur').toEqual([]);
    expect(essai.sorties, 'rien sur la console').toEqual([]);
  });
});

describe('T10p (relecture) — témoin : c.json et c.text gardent leur Content-Length', { timeout: 10_000 }, () => {
  const app = new Hono();
  app.get('/json', (c) => c.json({ culture: 'carotte', planches: 3 }));
  app.get('/texte', (c) => c.text('bonjour'));

  for (const [chemin, corps] of [
    ['/json', '{"culture":"carotte","planches":3}'],
    ['/texte', 'bonjour'],
  ] as const) {
    it(`${chemin} : Content-Length présent et juste, pas d’envoi en morceaux`, async () => {
      const essai = await essayerFetch(app.fetch, { chemin });
      expect(statut(essai.brut)).toBe(200);
      const [entetes = '', reste = ''] = essai.brut.split('\r\n\r\n');
      expect(entetes.toLowerCase()).not.toMatch(/\r\ntransfer-encoding:\s*chunked/);
      expect(entetes.toLowerCase()).toMatch(new RegExp(`\\r\\ncontent-length:\\s*${String(Buffer.byteLength(corps))}\\r?$`, 'm'));
      expect(reste).toBe(corps);
      expect(essai.lignes).toEqual([]);
      expect(essai.sorties).toEqual([]);
    });
  }
});

describe('T10p (relecture) — flux déjà verrouillé (getReader lève)', { timeout: 10_000 }, () => {
  /** Corps dont un lecteur a déjà été pris : getReader lève une TypeError. */
  function reponseVerrouillee(): Response {
    const flux = new ReadableStream<Uint8Array>({
      pull(controleur) {
        controleur.enqueue(encodeur.encode(DEBUT));
      },
    });
    flux.getReader();
    return new Response(flux, { status: 200, headers: { 'content-type': 'text/csv' } });
  }

  for (const [nom, fetch] of [
    ['fetch synchrone', () => reponseVerrouillee()],
    ['fetch asynchrone', () => Promise.resolve().then(reponseVerrouillee)],
  ] as const) {
    it(`${nom} : 500, une ligne propre au journal, rien sur la console`, async () => {
      const essai = await essayerFetch(fetch);
      expect(statut(essai.brut)).toBe(500);
      verifierClientMuet(essai);
      verifierJournalPropre(essai);
      expect(essai.lignes.join('\n')).toContain('TypeError');
    });
  }
});

describe('T10p (relecture) — autres échecs du flux', { timeout: 10_000 }, () => {
  const enTete = { status: 200, headers: { 'content-type': 'text/csv' } };
  const cas: readonly (readonly [string, (requete: Request) => Response | Promise<Response>])[] = [
    [
      'erreur levée dans `start` (le constructeur la relève : fetch lève avant toute réponse)',
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              throw new RangeError(PIEGE);
            },
          }),
          enTete,
        ),
    ],
    [
      'erreur posée par controleur.error dans `start`',
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controleur) {
              controleur.error(new RangeError(PIEGE));
            },
          }),
          enTete,
        ),
    ],
    [
      'erreur non-Error (chaîne piégée) après un morceau',
      () => {
        let envoye = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            async pull(controleur) {
              if (!envoye) {
                envoye = true;
                controleur.enqueue(encodeur.encode(DEBUT));
                return;
              }
              await pause(30);
              // eslint-disable-next-line @typescript-eslint/only-throw-error -- le cas testé : une valeur levée qui n'est pas une Error
              throw PIEGE;
            },
          }),
          enTete,
        );
      },
    ],
    [
      'fetch asynchrone, flux qui casse après un morceau',
      async () => {
        await pause(10);
        return new Response(fluxQuiCasse(new RangeError(PIEGE), 30), enTete);
      },
    ],
  ];

  for (const [nom, fetch] of cas) {
    it(`${nom} : journal propre, rien sur la console, client muet, réponse jamais complète`, async () => {
      const essai = await essayerFetch(fetch);
      verifierClientMuet(essai);
      verifierJournalPropre(essai);
      verifierJamaisComplete(essai);
    });
  }
});

describe('T10p (relecture) — pas de hono/streaming dans le code de production', () => {
  const RACINE_SRC = fileURLToPath(new URL('.', import.meta.url));

  function fichiersProduction(dossier: string): string[] {
    const trouves: string[] = [];
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (entree.name !== 'test' && entree.name !== 'node_modules') trouves.push(...fichiersProduction(chemin));
      } else if (entree.name.endsWith('.ts') && !entree.name.endsWith('.test.ts') && !entree.name.endsWith('.d.ts')) {
        trouves.push(chemin);
      }
    }
    return trouves;
  }

  /** Modules importés (import, export … from, import(), require()) qui sont hono/streaming. */
  function importsStreaming(nom: string, texte: string): string[] {
    const source = ts.createSourceFile(nom, texte, ts.ScriptTarget.Latest, true);
    const trouves: string[] = [];
    const noter = (specificateur: ts.Node | undefined): void => {
      if (specificateur !== undefined && ts.isStringLiteralLike(specificateur) && /^hono\/streaming(?:\/|$)/.test(specificateur.text)) trouves.push(specificateur.text);
    };
    const visiter = (noeud: ts.Node): void => {
      if (ts.isImportDeclaration(noeud) || ts.isExportDeclaration(noeud)) noter(noeud.moduleSpecifier);
      else if (ts.isCallExpression(noeud) && (noeud.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(noeud.expression) && noeud.expression.text === 'require'))) noter(noeud.arguments[0]);
      ts.forEachChild(noeud, visiter);
    };
    visiter(source);
    return trouves;
  }

  it('témoin : le repérage voit import, export from, import() et require()', () => {
    const texte = [
      "import { stream } from 'hono/streaming';",
      "export { streamSSE } from 'hono/streaming';",
      "const m = await import('hono/streaming');",
      "const r = require('hono/streaming');",
      "// import { streamText } from 'hono/streaming'",
      "const s = 'hono/streaming';",
    ].join('\n');
    expect(importsStreaming('t.ts', texte)).toHaveLength(4);
  });

  it('témoin : le balayage trouve les fichiers de production', () => {
    const fichiers = fichiersProduction(RACINE_SRC).map((f) => relative(RACINE_SRC, f).split('\\').join('/'));
    expect(fichiers).toContain('serveur.ts');
    expect(fichiers).toContain('app.ts');
  });

  it('aucun import de hono/streaming (stream, streamText, streamSSE) hors des tests', () => {
    const fautifs: string[] = [];
    for (const chemin of fichiersProduction(RACINE_SRC)) {
      const nom = relative(RACINE_SRC, chemin).split('\\').join('/');
      for (const module of importsStreaming(nom, readFileSync(chemin, 'utf8'))) fautifs.push(`${nom} : ${module}`);
    }
    expect(fautifs, 'hono/streaming attrape lui-même les erreurs du flux et les écrit sur la console').toEqual([]);
  });
});

/**
 * Tests d'acceptation T10q (relecture) — bloquants B1, B2, B3 et point N1.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 *   creerServeur({ fetch, journal?, plafondHttp10Octets?, ... })            (serveur.ts)
 *   export const PLAFOND_CORPS_HTTP10_OCTETS: number                       (serveur.ts)
 *
 * B1. Client qui coupe AVANT le premier morceau, avec une source qui ignore `requete.signal` :
 *     - HTTP/1.1 et HTTP/1.0 : `cancel` de la source est appelé, rien au journal (un client parti
 *       n'est pas une erreur du serveur), rien sur la console ;
 *     - client parti, puis premier morceau qui arrive plus tard : `cancel` appelé quand même ;
 *     - HTTP/1.0 : une source sans fin n'est pas lue jusqu'au bout après le départ du client (le
 *       nombre de tirages cesse d'augmenter).
 * B2. HTTP/1.0 : le corps lu en mémoire est plafonné à `PLAFOND_CORPS_HTTP10_OCTETS` octets
 *     (entier positif exporté). L'option `plafondHttp10Octets` de creerServeur remplace ce plafond
 *     (choix du testeur : les tests passent un petit plafond pour ne pas générer des dizaines de
 *     Mo ; un seul test exerce la valeur par défaut, avec un même tampon de 1 Mio réutilisé).
 *     Corps de taille égale au plafond : 200, corps entier. Au-delà (strictement) : 505 sans corps,
 *     réponse complète, une ligne au journal, `cancel` de la source appelé, lecture arrêtée au
 *     plafond (au plus un morceau de plus que le plafond n'est tiré). README, section de
 *     déploiement : une phrase cite « HTTP/1.0 » et « plafond » ou « limite ».
 * B3. HTTP/1.0 : réponse en flux à laquelle l'appli a posé `transfer-encoding: chunked` : corps
 *     non découpé (pas de cadres de morceaux), Content-Length exact, AUCUN Transfer-Encoding.
 * N1. HTTP/1.0 : `new Response(flux, { status: 204 })` (et 304) : ni Content-Length ni corps.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as moduleServeur from './serveur.ts';
import { creerServeur } from './serveur.ts';

const pause = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const encodeur = new TextEncoder();
const EN_TETE_CSV = { status: 200, headers: { 'content-type': 'text/csv' } };

const REQUETE_10 = 'GET /export.csv HTTP/1.0\r\nHost: localhost\r\n\r\n';
const REQUETE_11 = 'GET /export.csv HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n';

interface Essai {
  /** Octets bruts reçus par le client, en latin1. */
  readonly brut: string;
  readonly lignes: readonly string[];
  readonly sorties: readonly string[];
}

interface OptionsEssai {
  /** Le client coupe la connexion ce nombre de ms après l'envoi de la requête. */
  readonly couperApresMs?: number;
  /** Options supplémentaires passées telles quelles à creerServeur (ex. plafondHttp10Octets). */
  readonly enPlus?: Readonly<Record<string, unknown>>;
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

async function essayer(
  fetch: (requete: Request) => Response | Promise<Response>,
  requete: string,
  options: OptionsEssai = {},
): Promise<Essai> {
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

  // Objet bâti à part : une option encore inconnue du type OptionsServeur passe le typage.
  const optionsServeur = {
    fetch,
    journal: (ligne: string) => {
      lignes.push(ligne);
    },
    ...options.enPlus,
  };
  const s = creerServeur(optionsServeur);
  serveur = s;
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => { ok(); }));
  const port = (s.address() as AddressInfo).port;

  const brut = await new Promise<string>((ok) => {
    const morceaux: Buffer[] = [];
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(requete);
      if (options.couperApresMs !== undefined) {
        setTimeout(() => {
          socket.destroy();
        }, options.couperApresMs);
      }
    });
    const fin = (): void => {
      clearTimeout(garde);
      ok(Buffer.concat(morceaux).toString('latin1'));
    };
    const garde = setTimeout(() => {
      socket.destroy();
    }, 5_000);
    socket.on('data', (m: Buffer) => morceaux.push(m));
    socket.on('error', () => {
      // Connexion coupée : attendu dans certains cas.
    });
    socket.on('close', fin);
  });

  for (let i = 0; i < 30 && lignes.length === 0; i++) await pause(10);
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

function aTransferEncoding(brut: string): boolean {
  return entetesDe(brut).includes('\r\ntransfer-encoding:');
}

async function attendre(condition: () => boolean, maxMs = 1_000): Promise<void> {
  for (let i = 0; i < maxMs / 10 && !condition(); i++) await pause(10);
}

// ── B1. Client qui coupe avant le premier morceau ───────────────────────────────────────────

describe('T10q (relecture B1) — client parti avant le premier morceau, source qui ignore le signal', { timeout: 10_000 }, () => {
  for (const [version, requete] of [
    ['HTTP/1.1', REQUETE_11],
    ['HTTP/1.0', REQUETE_10],
  ] as const) {
    it(`${version}, source qui ne répond jamais : cancel appelé, rien au journal ni sur la console`, async () => {
      const etat = { annulee: false };
      const essai = await essayer(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull() {
                return new Promise<void>(() => {
                  // Ne répond jamais, ignore requete.signal.
                });
              },
              cancel() {
                etat.annulee = true;
              },
            }),
            EN_TETE_CSV,
          ),
        requete,
        { couperApresMs: 50 },
      );
      await attendre(() => etat.annulee);
      expect(etat.annulee, 'cancel de la source appelé après le départ du client').toBe(true);
      expect(essai.lignes, 'un client parti n’est pas une erreur').toEqual([]);
      expect(essai.sorties).toEqual([]);
    });

    it(`${version}, client parti puis premier morceau qui arrive : cancel appelé, rien au journal`, async () => {
      const etat = { annulee: false, tirages: 0 };
      const essai = await essayer(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              async pull(controleur) {
                etat.tirages++;
                await pause(etat.tirages === 1 ? 200 : 20);
                controleur.enqueue(encodeur.encode('morceau;'));
              },
              cancel() {
                etat.annulee = true;
              },
            }),
            EN_TETE_CSV,
          ),
        requete,
        { couperApresMs: 50 },
      );
      await attendre(() => etat.annulee, 1_500);
      expect(etat.annulee, 'cancel appelé une fois le premier morceau arrivé').toBe(true);
      expect(essai.lignes).toEqual([]);
      expect(essai.sorties).toEqual([]);
    });
  }

  it('HTTP/1.0, source sans fin : plus aucun tirage après le départ du client', async () => {
    const etat = { annulee: false, tirages: 0 };
    const morceau = encodeur.encode('x'.repeat(1_024));
    const essai = await essayer(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async pull(controleur) {
              etat.tirages++;
              await pause(5);
              // Garde-fou : finie au bout de 2 000 tirages (10 s), bien après la fin du test.
              if (etat.tirages > 2_000) controleur.close();
              else controleur.enqueue(morceau);
            },
            cancel() {
              etat.annulee = true;
            },
          }),
          EN_TETE_CSV,
        ),
      REQUETE_10,
      { couperApresMs: 60 },
    );
    await attendre(() => etat.annulee);
    await pause(100);
    const avant = etat.tirages;
    await pause(300);
    expect(etat.tirages, 'la source n’est plus tirée après le départ du client').toBe(avant);
    expect(etat.annulee, 'cancel de la source appelé').toBe(true);
    expect(essai.lignes).toEqual([]);
    expect(essai.sorties).toEqual([]);
  });
});

// ── B2. Plafond du corps en mémoire (HTTP/1.0) ──────────────────────────────────────────────

/**
 * Source de `nombre` morceaux de `taille` octets, qui compte ses tirages. Les « longues » sources
 * restent finies : un serveur sans plafond ne doit pas épuiser la mémoire du test.
 */
function sourceComptee(taille: number, nombre: number, morceau: Uint8Array = new Uint8Array(taille).fill(97)) {
  const etat = { annulee: false, octetsTires: 0 };
  let restants = nombre;
  const flux = new ReadableStream<Uint8Array>({
    pull(controleur) {
      if (restants <= 0) {
        controleur.close();
        return;
      }
      restants--;
      etat.octetsTires += morceau.byteLength;
      controleur.enqueue(morceau);
    },
    cancel() {
      etat.annulee = true;
    },
  });
  return { etat, flux };
}

describe('T10q (relecture B2) — HTTP/1.0 : plafond du corps lu en mémoire', { timeout: 20_000 }, () => {
  const PLAFOND_ESSAI = 1_000;
  const petitPlafond = { plafondHttp10Octets: PLAFOND_ESSAI };

  it('PLAFOND_CORPS_HTTP10_OCTETS est exporté : un entier positif', () => {
    const plafond = (moduleServeur as Readonly<Record<string, unknown>>).PLAFOND_CORPS_HTTP10_OCTETS;
    expect(typeof plafond, 'export PLAFOND_CORPS_HTTP10_OCTETS de serveur.ts').toBe('number');
    expect(Number.isSafeInteger(plafond) && (plafond as number) > 0).toBe(true);
  });

  it('corps égal au plafond (option plafondHttp10Octets) : 200, Content-Length exact, corps entier', async () => {
    const { flux } = sourceComptee(100, 10);
    const essai = await essayer(() => new Response(flux, EN_TETE_CSV), REQUETE_10, { enPlus: petitPlafond });
    expect(statut(essai.brut), essai.brut).toBe(200);
    expect(contentLength(essai.brut)).toBe(PLAFOND_ESSAI);
    expect(corpsDe(essai.brut)).toBe('a'.repeat(PLAFOND_ESSAI));
    expect(essai.lignes).toEqual([]);
  });

  for (const [nom, nombre] of [
    ['un octet de trop (un morceau de plus)', 11],
    ['source longue (1 000 morceaux, 100 fois le plafond)', 1_000],
  ] as const) {
    it(`au-delà du plafond, ${nom} : 505 sans corps, une ligne au journal, cancel, lecture arrêtée au plafond`, async () => {
      const { etat, flux } = sourceComptee(100, nombre);
      const essai = await essayer(() => new Response(flux, EN_TETE_CSV), REQUETE_10, { enPlus: petitPlafond });
      await attendre(() => etat.annulee);
      expect(statut(essai.brut), essai.brut).toBe(505);
      expect(essai.brut, 'en-têtes complets').toContain('\r\n\r\n');
      expect(corpsDe(essai.brut), 'aucun corps').toBe('');
      expect(contentLength(essai.brut) ?? 0, 'Content-Length nul ou absent').toBe(0);
      expect(essai.brut, 'aucun octet de la source').not.toContain('aaaa');
      expect(essai.lignes, 'exactement une ligne au journal').toHaveLength(1);
      expect(essai.sorties).toEqual([]);
      expect(etat.annulee, 'cancel de la source appelé').toBe(true);
      expect(etat.octetsTires, 'lecture arrêtée au plafond (au plus un morceau de plus)').toBeLessThanOrEqual(PLAFOND_ESSAI + 100);
    });
  }

  it('sans option : la valeur par défaut PLAFOND_CORPS_HTTP10_OCTETS s’applique', async () => {
    const plafond = (moduleServeur as Readonly<Record<string, unknown>>).PLAFOND_CORPS_HTTP10_OCTETS;
    expect(typeof plafond).toBe('number');
    if (typeof plafond !== 'number') return;
    const MIO = 1_048_576;
    // Un seul tampon réutilisé : rien n'est alloué par morceau côté test.
    const { etat, flux } = sourceComptee(MIO, Math.ceil(plafond / MIO) + 4, new Uint8Array(MIO));
    const essai = await essayer(() => new Response(flux, EN_TETE_CSV), REQUETE_10);
    await attendre(() => etat.annulee);
    expect(statut(essai.brut)).toBe(505);
    expect(etat.annulee).toBe(true);
    expect(etat.octetsTires).toBeGreaterThan(plafond);
    expect(etat.octetsTires).toBeLessThanOrEqual(plafond + MIO);
  });

  it('README, section de déploiement : la limite HTTP/1.0 est mentionnée', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
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
    const phrases = sections.join('\n').split(/(?<=[.!?;])\s+|\n\s*\n/);
    const trouvee = phrases.some((p) => p.includes('HTTP/1.0') && /plafond|limite/i.test(p));
    expect(trouvee, 'phrase contenant « HTTP/1.0 » et « plafond » ou « limite »').toBe(true);
  });
});

// ── B3. Transfer-Encoding posé par l'appli (HTTP/1.0) ───────────────────────────────────────

describe('T10q (relecture B3) — HTTP/1.0 : transfer-encoding posé par l’appli', { timeout: 10_000 }, () => {
  it('corps non découpé, Content-Length exact, aucun Transfer-Encoding', async () => {
    const morceaux = ['debut;', 'milieu;', 'fin'];
    const attendu = morceaux.join('');
    const essai = await essayer(() => {
      const reste = [...morceaux];
      const flux = new ReadableStream<Uint8Array>({
        async pull(controleur) {
          await pause(20);
          const suivant = reste.shift();
          if (suivant === undefined) controleur.close();
          else controleur.enqueue(encodeur.encode(suivant));
        },
      });
      return new Response(flux, { status: 200, headers: { 'content-type': 'text/csv', 'transfer-encoding': 'chunked' } });
    }, REQUETE_10);
    expect(statut(essai.brut), essai.brut).toBe(200);
    expect(aTransferEncoding(essai.brut), `aucun Transfer-Encoding :\n${essai.brut}`).toBe(false);
    expect(contentLength(essai.brut), `Content-Length exact :\n${essai.brut}`).toBe(Buffer.byteLength(attendu));
    expect(corpsDe(essai.brut), 'corps sans cadres de morceaux').toBe(attendu);
    expect(essai.lignes).toEqual([]);
  });
});

// ── N1. Statuts sans corps (HTTP/1.0) ───────────────────────────────────────────────────────

describe('T10q (relecture N1) — HTTP/1.0 : 204 et 304 avec un flux', { timeout: 10_000 }, () => {
  for (const code of [204, 304]) {
    it(`${String(code)} : ni Content-Length ni corps`, async () => {
      const essai = await essayer(() => {
        const flux = new ReadableStream<Uint8Array>({
          pull(controleur) {
            controleur.enqueue(encodeur.encode('ne-doit-pas-partir'));
            controleur.close();
          },
        });
        return new Response(flux, { status: code });
      }, REQUETE_10);
      expect(statut(essai.brut), essai.brut).toBe(code);
      expect(contentLength(essai.brut), `pas de Content-Length :\n${essai.brut}`).toBeNull();
      expect(corpsDe(essai.brut), 'aucun corps').toBe('');
      expect(essai.sorties).toEqual([]);
    });
  }
});

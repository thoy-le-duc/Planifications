/**
 * Tests d'acceptation T10r — réponses en flux : délai jusqu'au premier morceau, plafond HTTP/1.0
 * exact.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 *   creerServeur({ fetch, journal?, delaiPremierMorceauMs?, plafondHttp10Octets?, ... })  (serveur.ts)
 *   export const DELAI_PREMIER_MORCEAU_MS = 60_000                                        (serveur.ts)
 *
 * 1. Délai jusqu'au premier morceau (option `delaiPremierMorceauMs`, par défaut
 *    DELAI_PREMIER_MORCEAU_MS) :
 *    - source muette au-delà du délai, en HTTP/1.1 comme en HTTP/1.0 : 504 complet sans corps,
 *      `cancel` de la source appelé, exactement une ligne propre au journal (sans saut de ligne
 *      ni caractère de contrôle), rien sur la console ;
 *    - premier morceau avant le délai : réponse normale ; le délai ne s'applique plus ensuite (une
 *      source lente après son premier morceau n'est pas coupée par lui).
 * 2. Plafond HTTP/1.0 exact : source d'exactement le plafond qui ne se ferme que plus tard → 200,
 *    Content-Length exact, corps entier (avant T10r : 505). Source qui le dépasse d'un octet,
 *    plus tard → 505 comme avant, au plus un morceau tiré au-delà du plafond. Source d'exactement
 *    le plafond qui lève plus tard → 500 (lecture qui échoue, T10q), pas 505.
 * 3. Client parti pendant l'attente du premier morceau : comportement T10q inchangé (`cancel`,
 *    rien au journal), même quand le délai expire ensuite.
 */
import type { Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as moduleServeur from './serveur.ts';
import { creerServeur } from './serveur.ts';

const pause = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const encodeur = new TextEncoder();
const EN_TETE_CSV = { status: 200, headers: { 'content-type': 'text/csv' } };
const SAUT_OU_CONTROLE = /[\p{Cc}\p{Zl}\p{Zp}]/u;

const REQUETE_10 = 'GET /export.csv HTTP/1.0\r\nHost: localhost\r\n\r\n';
const REQUETE_11 = 'GET /export.csv HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n';
const VERSIONS = [
  ['HTTP/1.1', REQUETE_11],
  ['HTTP/1.0', REQUETE_10],
] as const;

/** Délai court passé au serveur dans les tests. */
const DELAI_ESSAI_MS = 150;

interface Essai {
  /** Octets bruts reçus par le client, en latin1. */
  readonly brut: string;
  readonly lignes: readonly string[];
  readonly sorties: readonly string[];
  /** Temps entre l'envoi de la requête et la fermeture de la connexion. */
  readonly dureeMs: number;
}

interface OptionsEssai {
  /** Le client coupe la connexion ce nombre de ms après l'envoi de la requête. */
  readonly couperApresMs?: number;
  /** Options passées telles quelles à creerServeur (ex. delaiPremierMorceauMs). */
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

  let debut = 0;
  const brut = await new Promise<string>((ok) => {
    const morceaux: Buffer[] = [];
    const socket = connect(port, '127.0.0.1', () => {
      debut = performance.now();
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
    // Garde du test : une source muette sans délai côté serveur garderait la requête ouverte.
    const garde = setTimeout(() => {
      socket.destroy();
    }, 3_000);
    socket.on('data', (m: Buffer) => morceaux.push(m));
    socket.on('error', () => {
      // Connexion coupée : attendu dans certains cas.
    });
    socket.on('close', fin);
  });
  const dureeMs = performance.now() - debut;

  for (let i = 0; i < 30 && lignes.length === 0; i++) await pause(10);
  await pause(50);
  return { brut, lignes, sorties, dureeMs };
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

/** Corps décodé : retire les cadres de l'envoi par morceaux s'il y en a. */
function corpsDecode(brut: string): string {
  const corps = corpsDe(brut);
  if (!enMorceaux(brut)) return corps;
  let reste = corps;
  let sortie = '';
  for (;;) {
    const finTaille = reste.indexOf('\r\n');
    if (finTaille < 0) return sortie;
    const taille = parseInt(reste.slice(0, finTaille), 16);
    if (!Number.isFinite(taille) || taille === 0) return sortie;
    sortie += reste.slice(finTaille + 2, finTaille + 2 + taille);
    reste = reste.slice(finTaille + 2 + taille + 2);
  }
}

async function attendre(condition: () => boolean, maxMs = 1_000): Promise<void> {
  for (let i = 0; i < maxMs / 10 && !condition(); i++) await pause(10);
}

/** Source qui ne produit jamais rien et ignore `requete.signal`. */
function sourceMuette() {
  const etat = { annulee: false, tirages: 0 };
  const flux = new ReadableStream<Uint8Array>({
    pull() {
      etat.tirages++;
      return new Promise<void>(() => {
        // Ne répond jamais.
      });
    },
    cancel() {
      etat.annulee = true;
    },
  });
  return { etat, flux };
}

// ── 1. Délai jusqu'au premier morceau ───────────────────────────────────────────────────────

describe('T10r — délai jusqu’au premier morceau', { timeout: 10_000 }, () => {
  it('DELAI_PREMIER_MORCEAU_MS est exporté : 60 000 ms', () => {
    const delai = (moduleServeur as Readonly<Record<string, unknown>>).DELAI_PREMIER_MORCEAU_MS;
    expect(delai, 'export DELAI_PREMIER_MORCEAU_MS de serveur.ts').toBe(60_000);
  });

  for (const [version, requete] of VERSIONS) {
    it(`${version}, source muette au-delà du délai : 504 complet sans corps, cancel, une ligne au journal`, async () => {
      const { etat, flux } = sourceMuette();
      const essai = await essayer(() => new Response(flux, EN_TETE_CSV), requete, {
        enPlus: { delaiPremierMorceauMs: DELAI_ESSAI_MS },
      });
      await attendre(() => etat.annulee);
      expect(statut(essai.brut), `504 attendu, reçu :\n${essai.brut}`).toBe(504);
      expect(essai.brut, 'en-têtes complets').toContain('\r\n\r\n');
      expect(contentLength(essai.brut) ?? 0, 'Content-Length nul ou absent').toBe(0);
      expect(corpsDecode(essai.brut), 'aucun corps').toBe('');
      expect(essai.dureeMs, 'pas de 504 avant le délai').toBeGreaterThanOrEqual(DELAI_ESSAI_MS - 10);
      expect(essai.dureeMs, 'réponse peu après le délai, pas à la garde du test').toBeLessThan(2_000);
      expect(etat.annulee, 'cancel de la source appelé').toBe(true);
      expect(essai.lignes, 'exactement une ligne au journal').toHaveLength(1);
      expect(essai.lignes[0], 'ligne propre').not.toMatch(SAUT_OU_CONTROLE);
      expect(essai.sorties, 'rien sur la console').toEqual([]);
    });

    it(`${version}, réponse asynchrone (Promise) et source muette : 504 aussi`, async () => {
      const { etat, flux } = sourceMuette();
      const essai = await essayer(
        async () => {
          await pause(10);
          return new Response(flux, EN_TETE_CSV);
        },
        requete,
        { enPlus: { delaiPremierMorceauMs: DELAI_ESSAI_MS } },
      );
      await attendre(() => etat.annulee);
      expect(statut(essai.brut), essai.brut).toBe(504);
      expect(etat.annulee).toBe(true);
      expect(essai.lignes).toHaveLength(1);
      expect(essai.sorties).toEqual([]);
    });

    it(`${version}, premier morceau avant le délai puis source lente : réponse normale, pas coupée`, async () => {
      // Premier morceau à 30 ms (délai 150 ms) ; les suivants à 200 ms d'écart chacun : la
      // réponse entière dure bien plus que le délai, qui ne s'applique plus après le premier.
      const morceaux = ['debut;', 'milieu;', 'fin'];
      const etat = { annulee: false, tirages: 0 };
      const flux = new ReadableStream<Uint8Array>(
        {
          async pull(controleur) {
            etat.tirages++;
            await pause(etat.tirages === 1 ? 30 : 200);
            const suivant = morceaux[etat.tirages - 1];
            if (suivant === undefined) controleur.close();
            else controleur.enqueue(encodeur.encode(suivant));
          },
          cancel() {
            etat.annulee = true;
          },
        },
        { highWaterMark: 0 },
      );
      const essai = await essayer(() => new Response(flux, EN_TETE_CSV), requete, {
        enPlus: { delaiPremierMorceauMs: DELAI_ESSAI_MS },
      });
      expect(statut(essai.brut), essai.brut).toBe(200);
      expect(corpsDecode(essai.brut), 'corps entier').toBe(morceaux.join(''));
      if (version === 'HTTP/1.0') expect(contentLength(essai.brut)).toBe(Buffer.byteLength(morceaux.join('')));
      expect(essai.dureeMs, 'la réponse a bien duré plus que le délai').toBeGreaterThan(DELAI_ESSAI_MS);
      expect(etat.annulee, 'source pas annulée').toBe(false);
      expect(essai.lignes, 'rien au journal').toEqual([]);
      expect(essai.sorties).toEqual([]);
    });

    it(`${version}, premier morceau juste avant le délai : pas de 504`, async () => {
      const etat = { tirages: 0 };
      const flux = new ReadableStream<Uint8Array>(
        {
          async pull(controleur) {
            etat.tirages++;
            if (etat.tirages === 1) {
              await pause(DELAI_ESSAI_MS - 70);
              controleur.enqueue(encodeur.encode('seul;'));
            } else controleur.close();
          },
        },
        { highWaterMark: 0 },
      );
      const essai = await essayer(() => new Response(flux, EN_TETE_CSV), requete, {
        enPlus: { delaiPremierMorceauMs: DELAI_ESSAI_MS },
      });
      expect(statut(essai.brut), essai.brut).toBe(200);
      expect(corpsDecode(essai.brut)).toBe('seul;');
      expect(essai.lignes).toEqual([]);
    });
  }
});

// ── 3. Client parti pendant l'attente (T10q inchangé) ───────────────────────────────────────

describe('T10r — client parti pendant l’attente du premier morceau', { timeout: 10_000 }, () => {
  for (const [version, requete] of VERSIONS) {
    it(`${version} : cancel, rien au journal, même quand le délai expire ensuite`, async () => {
      const { etat, flux } = sourceMuette();
      const essai = await essayer(() => new Response(flux, EN_TETE_CSV), requete, {
        couperApresMs: 30,
        enPlus: { delaiPremierMorceauMs: DELAI_ESSAI_MS },
      });
      await attendre(() => etat.annulee);
      // Laisse passer le délai : aucune ligne « 504 » pour un client déjà parti.
      await pause(DELAI_ESSAI_MS + 100);
      expect(etat.annulee, 'cancel de la source appelé').toBe(true);
      expect(essai.lignes, 'un client parti n’est pas une erreur').toEqual([]);
      expect(essai.sorties).toEqual([]);
    });
  }
});

// ── 2. Plafond HTTP/1.0 exact ───────────────────────────────────────────────────────────────

const PLAFOND_ESSAI = 1_000;
const TAILLE_MORCEAU = 100;

/**
 * Source de 10 morceaux de 100 octets (exactement PLAFOND_ESSAI), puis, `apresMs` plus tard :
 * - 'fermer' : se ferme ;
 * - 'octet' : un octet de plus, puis des morceaux de 100 octets (finis : 50) ;
 * - 'erreur' : lève.
 * Rien n'est tiré d'avance (highWaterMark 0) : `octetsTires` compte exactement ce que le serveur
 * a demandé.
 */
function sourcePlafond(suite: 'fermer' | 'octet' | 'erreur', apresMs: number) {
  const etat = { annulee: false, octetsTires: 0, tirages: 0 };
  const morceau = new Uint8Array(TAILLE_MORCEAU).fill(97);
  const flux = new ReadableStream<Uint8Array>(
    {
      async pull(controleur) {
        etat.tirages++;
        if (etat.tirages <= PLAFOND_ESSAI / TAILLE_MORCEAU) {
          etat.octetsTires += morceau.byteLength;
          controleur.enqueue(morceau);
          return;
        }
        if (etat.tirages === PLAFOND_ESSAI / TAILLE_MORCEAU + 1) {
          await pause(apresMs);
          if (suite === 'fermer') {
            controleur.close();
            return;
          }
          if (suite === 'erreur') throw new Error('source cassée');
          etat.octetsTires += 1;
          controleur.enqueue(new Uint8Array([98]));
          return;
        }
        if (etat.tirages > PLAFOND_ESSAI / TAILLE_MORCEAU + 51) {
          controleur.close();
          return;
        }
        etat.octetsTires += morceau.byteLength;
        controleur.enqueue(morceau);
      },
      cancel() {
        etat.annulee = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { etat, flux };
}

// Plafond exact retiré du ticket (décision du chef, T10r) : avec une source qui prépare un morceau
// d'avance, lire un morceau de plus au plafond contredit les garanties de T10q (cancel, tirages bornés).
// Une source d'exactement le plafond qui ne se ferme que plus tard reçoit 505 : limite assumée.
describe('T10r — HTTP/1.0 : plafond', { timeout: 10_000 }, () => {
  const petitPlafond = { plafondHttp10Octets: PLAFOND_ESSAI };

  it('un octet de plus, 50 ms plus tard : 505, une ligne au journal, cancel, au plus un morceau tiré au-delà', async () => {
    const { etat, flux } = sourcePlafond('octet', 50);
    const essai = await essayer(() => new Response(flux, EN_TETE_CSV), REQUETE_10, { enPlus: petitPlafond });
    await attendre(() => etat.annulee);
    expect(statut(essai.brut), essai.brut).toBe(505);
    expect(essai.brut, 'en-têtes complets').toContain('\r\n\r\n');
    expect(corpsDe(essai.brut), 'aucun corps').toBe('');
    expect(contentLength(essai.brut) ?? 0).toBe(0);
    expect(essai.lignes, 'exactement une ligne au journal').toHaveLength(1);
    expect(essai.sorties).toEqual([]);
    expect(etat.annulee, 'cancel de la source appelé').toBe(true);
    // Laisse finir un éventuel tirage en cours, puis vérifie qu'aucun autre n'a suivi.
    await pause(150);
    expect(etat.octetsTires, 'au plus un morceau (l’octet de trop) tiré au-delà du plafond').toBeLessThanOrEqual(PLAFOND_ESSAI + 1);
  });

});

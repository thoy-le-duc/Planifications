// @vitest-environment happy-dom
/**
 * Tests d'acceptation T39b — suites de T39 : jamais deux fermes, jamais d'attente muette
 * (docs/backlog/T39b-creer-ferme-suites.md). Complète ./EcranCreerFerme.test.tsx (T39).
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 * src/donnees/ferme-memorisee.ts :
 *   cleFermeEnCours(utilisateurId) = `planif.ferme-en-cours.<utilisateurId>` : id (UUID) de la
 *   ferme en cours d'envoi, rangé AVANT le POST /fermes, réutilisé à chaque essai, même après un
 *   rechargement de la page ; retiré quand la ferme est créée (201 ou 409) et à la déconnexion
 *   (connexion/deconnexion.ts, comme cleFermeCreee).
 *
 * src/donnees/ferme-active.ts : suivreFermeActive retire `planif.ferme-creee.<utilisateurId>`
 *   (et l'id en cours) dès qu'il signale 'prete' : la ferme est arrivée.
 *
 * EcranCreerFerme (props en plus : surReessayer?: () => void, par défaut recharge la page) :
 *   - 'premiere-synchro' ou 'creee' depuis DELAI_ATTENTE_SYNCHRO_MS (30 s, creer-ferme.ts) :
 *     message franc (role="alert") : la synchronisation ne répond pas (réseau, service), et un
 *     bouton « Réessayer » qui appelle surReessayer ; l'attente repart de zéro.
 *   - synchro 'session-expiree' : data-etat 'session-expiree', pas de formulaire, message qui
 *     invite à se reconnecter (choisirEcranSansFerme rend 'session-expiree' en ligne ; hors ligne,
 *     'hors-ligne' de T39 prime : se reconnecter demande du réseau). Prime sur 'creee' : rien
 *     n'arrive par la synchro avant la reconnexion.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import { deconnecter } from '../../connexion/deconnexion.ts';
import type { SessionConnexion } from '../../connexion/session.ts';
import type { EtatSynchro } from '../../donnees/connecteur.ts';
import { suivreFermeActive, type FermeActive } from '../../donnees/ferme-active.ts';
import { cleChoix, cleFermeCreee, cleFermeEnCours } from '../../donnees/ferme-memorisee.ts';
import { choisirEcranSansFerme, DELAI_ATTENTE_SYNCHRO_MS } from './creer-ferme.ts';
import EcranCreerFerme from './EcranCreerFerme.tsx';

const MOI = '0192f0c1-13f1-7000-8000-0000000000a1';
const AUTRE = '0192f0c1-13f1-7000-8000-0000000000a2';
const FERME = '0192f0c1-13f1-7000-8000-0000000000f1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jetonValableUneHeure(): string {
  const maintenant = Math.floor(Date.now() / 1000);
  const charge = btoa(JSON.stringify({ sub: MOI, iat: maintenant, exp: maintenant + 3600 }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  return `e30.${charge}.signature`;
}

let session: SessionConnexion;
let conteneur: HTMLDivElement;
let racine: Root;

interface Envoi {
  readonly corps: { id: string; nom: string };
  readonly repondre: (r: Response | Error) => void;
}
let envois: Envoi[] = [];
const surReessayer = vi.fn();

const adresse = (u: RequestInfo | URL): string => (typeof u === 'string' ? u : u instanceof URL ? u.href : u.url);

beforeEach(() => {
  session = { utilisateurId: MOI, email: 'theophane@ferme.fr', jetonAcces: jetonValableUneHeure(), jetonRenouvellement: 'r'.repeat(43) };
  localStorage.setItem('planif.session', JSON.stringify(session));
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => true);
  envois = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      // GET /moi (ferme créée lors d'une ouverture précédente) : pas de réponse, la synchro tranche.
      if (!adresse(url).endsWith('/fermes')) return new Promise<Response>(() => undefined);
      return new Promise<Response>((resoudre, rejeter) => {
        envois.push({
          corps: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Envoi['corps'],
          repondre: (r) => {
            if (r instanceof Error) rejeter(r);
            else resoudre(r);
          },
        });
      });
    }),
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  conteneur = document.createElement('div');
  document.body.append(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => {
    racine.unmount();
  });
  conteneur.remove();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function unTour(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function attendre(condition: () => boolean, message: string, delaiMs = 2_000): Promise<void> {
  const fin = performance.now() + delaiMs;
  while (!condition() && performance.now() < fin) await unTour();
  expect(condition(), message).toBe(true);
}

function monter(synchro: EtatSynchro = 'synchronise', surReessayer?: () => void): void {
  act(() => {
    racine.render(<EcranCreerFerme session={session} synchro={synchro} surReessayer={surReessayer} />);
  });
}

const ecran = () => conteneur.querySelector<HTMLElement>('[data-testid="creer-ferme"]');
const etat = () => ecran()?.getAttribute('data-etat') ?? null;
const champ = () => conteneur.querySelector<HTMLInputElement>('input[name="nom-ferme"]');
const boutonNomme = (texte: string) => [...conteneur.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent.includes(texte)) ?? null;
const alerte = () => conteneur.querySelector('[role="alert"]')?.textContent ?? null;

function saisirEtCreer(valeur: string): void {
  const input = champ();
  if (input === null) throw new Error('champ « Nom de la ferme » absent');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, valeur);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    boutonNomme('Créer ma ferme')?.click();
  });
}

const reponse = (statut: number): Response => new Response('{}', { status: statut, headers: { 'content-type': 'application/json' } });

async function repondre(i: number, r: Response | Error): Promise<void> {
  const e = envois[i];
  if (e === undefined) throw new Error(`envoi ${String(i)} absent`);
  e.repondre(r);
  await unTour();
  await unTour();
}

describe('T39b — 1. id de la ferme en cours gardé sur le téléphone', () => {
  it('l’id est rangé avant que la réponse du POST arrive', async () => {
    monter();
    saisirEtCreer('Ferme de Benoît');
    await attendre(() => envois.length === 1, 'un envoi');
    const id = envois[0]?.corps.id ?? '';
    expect(id).toMatch(UUID);
    expect(localStorage.getItem(cleFermeEnCours(MOI))).toBe(id);
  });

  it('réponse perdue, rechargement, nouvel essai : même id envoyé, 409 = réussite, une seule ferme', async () => {
    // Page précédente : POST parti avec cet id, réponse perdue, puis rechargement.
    localStorage.setItem(cleFermeEnCours(MOI), FERME);
    monter();
    expect(etat()).toBe('formulaire');
    saisirEtCreer('Ferme de Benoît');
    await attendre(() => envois.length === 1, 'un envoi');
    expect(envois[0]?.corps.id).toBe(FERME);
    await repondre(0, reponse(409));
    expect(etat()).toBe('creee');
    expect(localStorage.getItem(cleChoix(MOI))).toBe(FERME);
    expect(localStorage.getItem(cleFermeCreee(MOI))).toBe(FERME);
    expect(localStorage.getItem(cleFermeEnCours(MOI)), 'ferme arrivée côté API : id en cours effacé').toBeNull();
  });

  it('l’id en cours d’un autre compte du téléphone n’est pas repris', async () => {
    localStorage.setItem(cleFermeEnCours(AUTRE), FERME);
    monter();
    saisirEtCreer('Ferme de Benoît');
    await attendre(() => envois.length === 1, 'un envoi');
    expect(envois[0]?.corps.id).not.toBe(FERME);
    expect(localStorage.getItem(cleFermeEnCours(AUTRE))).toBe(FERME);
  });
});

describe('T39b — 2. attente bornée à 30 s', () => {
  it('le délai est de 30 s', () => {
    expect(DELAI_ATTENTE_SYNCHRO_MS).toBe(30_000);
  });

  it.each([
    ['première synchronisation', () => monter('connexion', surReessayer), 'premiere-synchro'],
    [
      'ferme créée, pas encore arrivée',
      () => {
        localStorage.setItem(cleFermeCreee(MOI), FERME);
        monter('synchronise', surReessayer);
      },
      'creee',
    ],
  ] as const)('%s : au-delà de 30 s, message franc et bouton « Réessayer »', (_cas, preparer, attendu) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    surReessayer.mockClear();
    preparer();
    expect(etat()).toBe(attendu);
    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(boutonNomme('Réessayer'), 'pas avant 30 s').toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(alerte()).toMatch(/synchronisation ne répond pas/i);
    expect(alerte()).toMatch(/réseau/i);
    const b = boutonNomme('Réessayer');
    expect(b).not.toBeNull();
    act(() => {
      b?.click();
    });
    expect(surReessayer).toHaveBeenCalledTimes(1);
    expect(boutonNomme('Réessayer'), 'l’attente repart de zéro').toBeNull();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(boutonNomme('Réessayer')).not.toBeNull();
  });
});

describe('T39b — 3. clés effacées quand la ferme arrive, et à la déconnexion', () => {
  it('la clé ferme-creee disparaît au passage à « prete »', async () => {
    localStorage.setItem(cleFermeCreee(MOI), FERME);
    localStorage.setItem(cleFermeCreee(AUTRE), FERME);
    const base = creerBaseMemoire(SCHEMA_LOCAL);
    const etats: FermeActive[] = [];
    const arreter = suivreFermeActive(base, { utilisateurId: MOI, stockage: localStorage }, (e) => etats.push(e));
    try {
      await attendre(() => etats.at(-1)?.etat === 'sans-ferme', 'sans ferme avant la synchro');
      expect(localStorage.getItem(cleFermeCreee(MOI)), 'pas encore arrivée : gardée').toBe(FERME);
      base.recevoir('INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, supprime_le) VALUES (?, ?, ?, ?, NULL)', [FERME, 'Ferme', 'Europe/Paris', '2026-10-17T08:00:00.000Z']);
      base.recevoir('INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, cree_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)', [
        '0192f0c1-13f1-7000-8000-000000000101',
        MOI,
        FERME,
        'gerant',
        'accepte',
        '2026-10-17T08:00:00.000Z',
      ]);
      await attendre(() => etats.at(-1)?.etat === 'prete', 'ferme arrivée');
      expect(localStorage.getItem(cleFermeCreee(MOI))).toBeNull();
      expect(localStorage.getItem(cleFermeCreee(AUTRE)), 'l’autre compte n’est pas touché').toBe(FERME);
    } finally {
      arreter();
      base.fermer();
    }
  });

  it('la déconnexion retire ferme-creee et l’id en cours, pas ceux d’un autre compte', async () => {
    const valeurs = new Map<string, string>();
    const stockage = {
      getItem: (c: string) => valeurs.get(c) ?? null,
      setItem: (c: string, v: string) => {
        valeurs.set(c, v);
      },
      removeItem: (c: string) => {
        valeurs.delete(c);
      },
    };
    for (const id of [MOI, AUTRE]) {
      stockage.setItem(cleFermeCreee(id), FERME);
      stockage.setItem(cleFermeEnCours(id), FERME);
    }
    await deconnecter(session, {
      urlApi: 'https://api',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      stockage,
      effacerBaseLocale: () => Promise.resolve(),
      delaiMs: 10,
    });
    expect(valeurs.has(cleFermeCreee(MOI))).toBe(false);
    expect(valeurs.has(cleFermeEnCours(MOI))).toBe(false);
    expect(valeurs.get(cleFermeCreee(AUTRE))).toBe(FERME);
    expect(valeurs.get(cleFermeEnCours(AUTRE))).toBe(FERME);
  });
});

describe('T39b — 4. session expirée : pas de formulaire voué à l’échec', () => {
  it('choisirEcranSansFerme rend « session-expiree » en ligne ; hors ligne, « hors-ligne » (T39) prime', () => {
    expect(choisirEcranSansFerme({ synchro: 'session-expiree', enLigne: true })).toBe('session-expiree');
    expect(choisirEcranSansFerme({ synchro: 'session-expiree', enLigne: false })).toBe('hors-ligne');
  });

  it('l’écran le dit avant la saisie : message de reconnexion, ni champ ni bouton', () => {
    monter('session-expiree');
    expect(etat()).toBe('session-expiree');
    expect(champ()).toBeNull();
    expect(boutonNomme('Créer ma ferme')).toBeNull();
    expect(ecran()?.textContent).toMatch(/session a expiré/i);
    expect(ecran()?.textContent).toMatch(/reconnect/i);
  });

  it('même avec une ferme créée pas encore arrivée : rien n’arrivera avant de se reconnecter', () => {
    localStorage.setItem(cleFermeCreee(MOI), FERME);
    monter('session-expiree');
    expect(etat()).toBe('session-expiree');
    expect(ecran()?.textContent).toMatch(/reconnect/i);
  });
});

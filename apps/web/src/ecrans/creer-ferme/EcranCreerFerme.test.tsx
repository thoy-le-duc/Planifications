// @vitest-environment happy-dom
/**
 * Tests d'acceptation T39 — l'écran « Créer ma ferme » (docs/backlog/T39-creer-sa-ferme.md).
 *
 * ── Écran attendu (apps/web/src/ecrans/creer-ferme/EcranCreerFerme.tsx, export par défaut) ──
 *
 * EcranCreerFerme(props: { session: SessionConnexion; synchro: EtatSynchro })
 *   Montré par la coquille quand la base est 'sans-ferme' (onglets Aujourd'hui, Planches, Ferme).
 *   Chargé à la demande, jamais au démarrage. Racine [data-testid="creer-ferme"], dont
 *   data-etat dit ce qui est montré :
 *     'formulaire'        champ « Nom de la ferme » (maxlength 200) et bouton « Créer ma ferme » ;
 *     'hors-ligne'        pas de bouton : il faut du réseau pour créer la ferme la première fois ;
 *     'premiere-synchro'  pas de bouton : la première synchronisation n'est pas finie ;
 *     'creee'             « Ferme créée, synchronisation… » en attendant que la synchro l'apporte.
 *   Le choix suit choisirEcranSansFerme (creer-ferme.ts) avec navigator.onLine, mis à jour par
 *   les événements online / offline.
 *
 *   Envoi : creerFerme (creer-ferme.ts) avec fetch, urlApi() et les jetons de la session
 *   (gererJetons, src/donnees/jeton.ts : renouvellement compris), un id neuf (UUID) par ferme,
 *   GARDÉ d'un essai à l'autre tant que la ferme n'est pas créée (une réponse perdue ne crée pas
 *   deux fermes). Un seul envoi à la fois : bouton désactivé pendant l'envoi, double tap sans
 *   effet. Nom invalide : message (role="alert"), rien n'est envoyé.
 *   Échec : message de messageCreation (role="alert"), le nom saisi reste dans le champ.
 *   Réussite : la ferme est mémorisée comme ferme choisie (memoriserFerme,
 *   src/donnees/ferme-memorisee.ts) et l'écran passe à 'creee' ; il y reste si on change
 *   d'onglet (écran démonté puis remonté) : jamais une seconde ferme par erreur.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire, type BaseMemoire } from '../../../../../packages/sync/src/test/base-memoire.ts';
import type { SessionConnexion } from '../../connexion/session.ts';
import type { EtatSynchro } from '../../donnees/connecteur.ts';
import { suivreFermeActive, type FermeActive } from '../../donnees/ferme-active.ts';
import { cleChoix, lireFermeMemorisee } from '../../donnees/ferme-memorisee.ts';
import EcranCreerFerme from './EcranCreerFerme.tsx';

const MOI = '0192f0c1-13f1-7000-8000-0000000000a1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JWT lisible par le téléphone, valable une heure : aucun renouvellement avant l'envoi. */
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
let enLigne = true;

interface Envoi {
  readonly url: string;
  readonly entetes: Headers;
  readonly corps: { id: string; nom: string; fuseauHoraire: string };
  readonly repondre: (r: Response | Error) => void;
}
let envois: Envoi[] = [];

const adresse = (u: RequestInfo | URL): string => (typeof u === 'string' ? u : u instanceof URL ? u.href : u.url);

beforeEach(() => {
  session = { utilisateurId: MOI, email: 'theophane@ferme.fr', jetonAcces: jetonValableUneHeure(), jetonRenouvellement: 'r'.repeat(43) };
  localStorage.setItem('planif.session', JSON.stringify(session));
  enLigne = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => enLigne);
  envois = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (!adresse(url).endsWith('/fermes')) return Promise.reject(new Error(`appel inattendu : ${adresse(url)}`));
      return new Promise<Response>((resoudre, rejeter) => {
        envois.push({
          url: adresse(url),
          entetes: new Headers(init?.headers),
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

function monter(synchro: EtatSynchro = 'synchronise'): void {
  act(() => {
    racine.render(<EcranCreerFerme session={session} synchro={synchro} />);
  });
}

const ecran = () => conteneur.querySelector<HTMLElement>('[data-testid="creer-ferme"]');
const etat = () => ecran()?.getAttribute('data-etat') ?? null;
const champ = () => [...conteneur.querySelectorAll<HTMLInputElement>('input')].find((i) => i.labels?.[0]?.textContent.includes('Nom de la ferme') ?? false) ?? null;
const bouton = () => [...conteneur.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent.includes('Créer ma ferme')) ?? null;
const alerte = () => conteneur.querySelector('[role="alert"]')?.textContent ?? null;

function saisir(valeur: string): void {
  const input = champ();
  if (input === null) throw new Error('champ « Nom de la ferme » absent');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, valeur);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function taper(): void {
  const b = bouton();
  if (b === null) throw new Error('bouton « Créer ma ferme » absent');
  act(() => {
    b.click();
  });
}

function reponse(statut: number, corps: unknown = {}): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
}

async function repondre(i: number, r: Response | Error): Promise<void> {
  const e = envois[i];
  if (e === undefined) throw new Error(`envoi ${String(i)} absent`);
  e.repondre(r);
  await unTour();
  await unTour();
}

describe('T39 — choix de l’écran selon le réseau et la synchro', () => {
  it('en ligne, synchro faite : le formulaire, champ de 200 caractères au plus', () => {
    monter('synchronise');
    expect(etat()).toBe('formulaire');
    expect(champ()).not.toBeNull();
    expect(champ()?.maxLength).toBe(200);
    expect(bouton()).not.toBeNull();
  });

  it('hors ligne : pas de bouton qui échouera, on dit qu’il faut du réseau', () => {
    enLigne = false;
    monter('hors-ligne');
    expect(etat()).toBe('hors-ligne');
    expect(bouton()).toBeNull();
    expect(ecran()?.textContent).toMatch(/réseau/i);
  });

  it('première synchro pas terminée : pas de bouton (la ferme existe peut-être déjà)', () => {
    monter('connexion');
    expect(etat()).toBe('premiere-synchro');
    expect(bouton()).toBeNull();
    expect(ecran()?.textContent).toMatch(/synchronisation/i);
  });

  it('le réseau qui part puis revient change l’écran sans rechargement', () => {
    monter('synchronise');
    expect(etat()).toBe('formulaire');
    act(() => {
      enLigne = false;
      window.dispatchEvent(new Event('offline'));
    });
    expect(etat()).toBe('hors-ligne');
    act(() => {
      enLigne = true;
      window.dispatchEvent(new Event('online'));
    });
    expect(etat()).toBe('formulaire');
  });
});

describe('T39 — formulaire', () => {
  it('nom vide : refusé, rien n’est envoyé', async () => {
    monter();
    saisir('   ');
    taper();
    await unTour();
    expect(envois).toHaveLength(0);
    expect(alerte()).toMatch(/nom/i);
  });

  it('nom trop long (201 caractères) : refusé, rien n’est envoyé, le nom reste', async () => {
    monter();
    saisir('a'.repeat(201));
    taper();
    await unTour();
    expect(envois).toHaveLength(0);
    expect(alerte()).toMatch(/200/);
    expect(champ()?.value).toBe('a'.repeat(201));
  });

  it('un tap : POST /fermes avec le jeton de la session, id UUID, nom et Europe/Paris', async () => {
    monter();
    saisir('  Ferme de Benoît ');
    taper();
    await attendre(() => envois.length === 1, 'un envoi');
    const [e] = envois;
    expect(e?.url).toMatch(/\/fermes$/);
    expect(e?.entetes.get('authorization')).toBe(`Bearer ${session.jetonAcces}`);
    expect(e?.corps.nom).toBe('Ferme de Benoît');
    expect(e?.corps.fuseauHoraire).toBe('Europe/Paris');
    expect(e?.corps.id).toMatch(UUID);
  });

  it('double tap : un seul envoi, bouton désactivé pendant l’envoi', async () => {
    monter();
    saisir('Ferme de Benoît');
    taper();
    taper();
    await unTour();
    act(() => {
      bouton()?.click();
    });
    await unTour();
    expect(envois).toHaveLength(1);
    expect(bouton()?.disabled).toBe(true);
    await repondre(0, reponse(500));
    expect(bouton()?.disabled).toBe(false);
    expect(envois).toHaveLength(1);
  });

  it.each([
    ['réseau absent', () => new TypeError('Failed to fetch'), /réseau/i],
    ['nom refusé (400)', () => reponse(400, { erreur: 'requete_invalide' }), /nom/i],
    ['erreur du serveur (500)', () => reponse(500), /réessayez/i],
  ] as const)('échec — %s : message clair, le nom saisi reste', async (_cas, faire, attendu) => {
    monter();
    saisir('Ferme de Benoît');
    taper();
    await attendre(() => envois.length === 1, 'un envoi');
    await repondre(0, faire());
    expect(etat()).toBe('formulaire');
    expect(alerte()).toMatch(attendu);
    expect(champ()?.value).toBe('Ferme de Benoît');
    expect(lireFermeMemorisee(localStorage, MOI)).toBeNull();
  });

  it('échec — session expirée (401 deux fois) : message qui invite à se reconnecter', async () => {
    // Le second essai part après un renouvellement : il est refusé aussi.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) =>
        Promise.resolve(adresse(url).endsWith('/auth/renouveler') ? reponse(401, { erreur: 'session_expiree' }) : reponse(401)),
      ),
    );
    monter();
    saisir('Ferme de Benoît');
    taper();
    await attendre(() => alerte() !== null, 'un message');
    expect(alerte()).toMatch(/reconnect/i);
    expect(champ()?.value).toBe('Ferme de Benoît');
  });

  it('nouvel essai après un échec : même id (une réponse perdue ne crée pas deux fermes)', async () => {
    monter();
    saisir('Ferme de Benoît');
    taper();
    await attendre(() => envois.length === 1, 'premier envoi');
    await repondre(0, new TypeError('Failed to fetch'));
    taper();
    await attendre(() => envois.length === 2, 'second envoi');
    expect(envois[1]?.corps.id).toBe(envois[0]?.corps.id);
  });
});

describe('T39 — réussite', () => {
  it('« Ferme créée, synchronisation… », ferme mémorisée comme ferme choisie', async () => {
    monter();
    saisir('Ferme de Benoît');
    taper();
    await attendre(() => envois.length === 1, 'un envoi');
    const id = envois[0]?.corps.id ?? '';
    await repondre(0, reponse(201, { id, nom: 'Ferme de Benoît', fuseauHoraire: 'Europe/Paris', role: 'gerant' }));
    expect(etat()).toBe('creee');
    expect(ecran()?.textContent).toContain('Ferme créée, synchronisation…');
    expect(bouton()).toBeNull();
    expect(localStorage.getItem(cleChoix(MOI))).toBe(id);
  });

  it('changer d’onglet (écran démonté puis remonté) ne repropose pas le formulaire', async () => {
    monter();
    saisir('Ferme de Benoît');
    taper();
    await attendre(() => envois.length === 1, 'un envoi');
    await repondre(0, reponse(201));
    act(() => {
      racine.render(<p>autre onglet</p>);
    });
    monter();
    expect(etat()).toBe('creee');
    expect(bouton()).toBeNull();
  });

  describe('la ferme créée devient active quand la synchro apporte membre et ferme', () => {
    let base: BaseMemoire;
    afterEach(() => {
      base.fermer();
    });

    it('même si une autre ferme (plus ancienne) arrive en même temps : c’est la ferme créée', async () => {
      monter();
      saisir('Ferme de Benoît');
      taper();
      await attendre(() => envois.length === 1, 'un envoi');
      const id = envois[0]?.corps.id ?? '';
      await repondre(0, reponse(201));

      base = creerBaseMemoire(SCHEMA_LOCAL);
      const etats: FermeActive[] = [];
      const arreter = suivreFermeActive(base, { utilisateurId: MOI, stockage: localStorage }, (e) => etats.push(e));
      await attendre(() => etats.at(-1)?.etat === 'sans-ferme', 'sans ferme avant la synchro');

      // Une invitation acceptée plus ancienne, puis la ferme créée : la synchro apporte tout.
      const AUTRE = '0192f0c1-13f1-7000-8000-0000000000f2';
      const ajouter = (fermeId: string, creeLe: string, n: number) => {
        base.recevoir('INSERT INTO ferme (id, nom, fuseau_horaire, cree_le, supprime_le) VALUES (?, ?, ?, ?, NULL)', [fermeId, 'Ferme', 'Europe/Paris', creeLe]);
        base.recevoir('INSERT INTO membre (id, utilisateur_id, ferme_id, role, etat, cree_le, supprime_le) VALUES (?, ?, ?, ?, ?, ?, NULL)', [
          `0192f0c1-13f1-7000-8000-00000000010${String(n)}`,
          MOI,
          fermeId,
          'gerant',
          'accepte',
          creeLe,
        ]);
      };
      ajouter(AUTRE, '2026-01-01T00:00:00.000Z', 1);
      ajouter(id, '2026-10-16T08:00:00.000Z', 2);
      await attendre(() => {
        const e = etats.at(-1);
        return e?.etat === 'prete' && e.fermeId === id;
      }, 'la ferme créée est active');
      expect(lireFermeMemorisee(localStorage, MOI)).toBe(id);
      arreter();
    });
  });
});

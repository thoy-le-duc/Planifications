/**
 * Relecture T10 (C4) — session expirée visible, sans boucle de renouvellement.
 *
 * Avant : quand /auth/renouveler répondait 401 (session révoquée ou expirée), le connecteur
 * levait SessionExpiree, PowerSync réessayait chaque seconde (retryDelayMs) : un appel à
 * /auth/renouveler par seconde, sans fin, et rien à l'écran.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * apps/web/src/donnees/connecteur.ts exporte, en plus de creerConnecteur :
 *
 *   brancherSynchro(base: BaseSynchronisable, options: OptionsBranchement): SynchroBranchee
 *
 *   - crée le connecteur (creerConnecteur) et appelle `base.connect(connecteur, …)` une fois ;
 *   - expose l'état : `etat()` et `surveillerEtat(rappel)` (rappel appelé tout de suite, puis à
 *     chaque changement ; rend le désabonnement). Hors session expirée, l'état est celui de
 *     `etatDepuisStatut(base.currentStatus, options.enLigne())` ;
 *   - si le renouvellement du jeton échoue avec SessionExpiree, que ce soit dans
 *     `fetchCredentials` ou dans `uploadData` (envoi : 401 → jeton invalidé → renouvellement
 *     refusé) : l'état passe à 'session-expiree' (nouvelle valeur de `EtatSynchro`) et y RESTE
 *     (un changement de statut de la base ne l'efface pas), et `base.disconnect()` est appelé :
 *     plus aucun appel à /auth/renouveler ni à /sync/upload. Les écritures restent dans la file
 *     locale (aucun `complete()`), elles partiront après reconnexion.
 *   - `invaliderJeton` de l'envoi est `jetons.invalider` (voir jeton.test.ts).
 *
 * ouvrirDonnees (ouvrir.ts) délègue à brancherSynchro et expose le même état. connecteur.ts
 * n'importe de @powersync/web que des types (testable sous Node, sans navigateur).
 *
 * Double de PowerSync ci-dessous : comme le SDK avec retryDelayMs = 1000, il rappelle
 * `fetchCredentials` chaque seconde tant qu'il n'a pas d'identifiants, puis `uploadData` chaque
 * seconde tant que la file n'est pas vide, jusqu'à `disconnect()`. Horloge simulée (vi).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConnexion } from '../connexion/session.ts';
import { gererJetons, type GestionJetons } from './jeton.ts';

// ── Contrat attendu de connecteur.ts (chargé dynamiquement : il n'existe pas encore) ──────────

type EtatSynchroAttendu = 'connexion' | 'synchronise' | 'hors-ligne' | 'session-expiree';

interface StatutSynchro {
  readonly connected: boolean;
  readonly hasSynced?: boolean;
}

interface EcritureCrud {
  readonly op: 'PUT' | 'PATCH' | 'DELETE';
  readonly table: string;
  readonly id: string;
  readonly opData?: Record<string, unknown>;
}

interface TransactionCrud {
  readonly crud: readonly EcritureCrud[];
  complete(): Promise<void>;
}

interface ConnecteurSynchro {
  fetchCredentials(): Promise<{ endpoint: string; token: string } | null>;
  uploadData(base: BaseSynchronisable): Promise<void>;
}

/** Sous-ensemble de PowerSyncDatabase utilisé par brancherSynchro. */
interface BaseSynchronisable {
  getNextCrudTransaction(): Promise<TransactionCrud | null>;
  connect(connecteur: ConnecteurSynchro, options?: Readonly<Record<string, unknown>>): Promise<void>;
  disconnect(): Promise<void>;
  readonly currentStatus: StatutSynchro;
  registerListener(ecouteur: { statusChanged?: (statut: StatutSynchro) => void }): () => void;
}

interface OptionsBranchement {
  readonly urlApi: string;
  readonly urlPowerSync: string;
  readonly jetons: GestionJetons;
  readonly fetch: typeof fetch;
  /** navigator.onLine dans l'appli. */
  readonly enLigne: () => boolean;
}

interface SynchroBranchee {
  etat(): EtatSynchroAttendu;
  surveillerEtat(rappel: (etat: EtatSynchroAttendu) => void): () => void;
}

interface ModuleConnecteur {
  brancherSynchro(base: BaseSynchronisable, options: OptionsBranchement): SynchroBranchee;
}

const CHEMIN_CONNECTEUR = './connecteur.ts';
async function chargerConnecteur(): Promise<ModuleConnecteur> {
  return (await import(/* @vite-ignore */ CHEMIN_CONNECTEUR)) as ModuleConnecteur;
}

// ── Doubles ──────────────────────────────────────────────────────────────────────────────────

const URL_API = 'https://api.planif.test';
const URL_POWERSYNC = 'https://powersync.planif.test';
const DEPART = Date.parse('2026-10-01T06:00:00Z');
const RETRY_MS = 1000;

const PUT_RECOLTE: EcritureCrud = {
  op: 'PUT',
  table: 'evenement',
  id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b50',
  opData: { ferme_id: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b20', type: 'recolte' },
};

const attendre = (ms: number) =>
  new Promise<void>((fin) => {
    setTimeout(fin, ms);
  });

class PowerSyncSimule implements BaseSynchronisable {
  currentStatus: StatutSynchro = { connected: false, hasSynced: false };
  connexions = 0;
  deconnexions = 0;
  actif = false;
  readonly terminees: number[] = [];
  private readonly ecouteurs = new Set<(statut: StatutSynchro) => void>();
  private position = 0;
  private readonly transactions: readonly (readonly EcritureCrud[])[];

  constructor(transactions: readonly (readonly EcritureCrud[])[]) {
    this.transactions = transactions;
  }

  /** Relu à chaque tour : `disconnect()` peut survenir pendant un await. */
  estActif(): boolean {
    return this.actif;
  }

  enAttente(): number {
    return this.transactions.length - this.position;
  }

  getNextCrudTransaction(): Promise<TransactionCrud | null> {
    const i = this.position;
    const crud = this.transactions[i];
    if (crud === undefined) return Promise.resolve(null);
    return Promise.resolve({
      crud,
      complete: () => {
        this.terminees.push(i);
        this.position = i + 1;
        return Promise.resolve();
      },
    });
  }

  connect(connecteur: ConnecteurSynchro): Promise<void> {
    this.connexions++;
    this.actif = true;
    void this.boucle(connecteur);
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.deconnexions++;
    this.actif = false;
    this.changerStatut({ connected: false, hasSynced: this.currentStatus.hasSynced === true });
    return Promise.resolve();
  }

  registerListener(ecouteur: { statusChanged?: (statut: StatutSynchro) => void }): () => void {
    const f = ecouteur.statusChanged;
    if (f === undefined) return () => undefined;
    this.ecouteurs.add(f);
    return () => this.ecouteurs.delete(f);
  }

  private changerStatut(statut: StatutSynchro): void {
    this.currentStatus = statut;
    for (const f of this.ecouteurs) f(statut);
  }

  /** Comme le SDK : identifiants jusqu'à réussite, puis envoi de la file, un essai par seconde. */
  private async boucle(connecteur: ConnecteurSynchro): Promise<void> {
    while (this.estActif()) {
      try {
        const identifiants = await connecteur.fetchCredentials();
        if (identifiants !== null && this.estActif()) {
          this.changerStatut({ connected: true, hasSynced: true });
          break;
        }
      } catch {
        // Le SDK journalise et réessaie après retryDelayMs.
      }
      await attendre(RETRY_MS);
    }
    while (this.estActif() && this.enAttente() > 0) {
      try {
        await connecteur.uploadData(this);
      } catch {
        // Idem : la transaction reste en tête de file.
      }
      await attendre(RETRY_MS);
    }
  }
}

function jwt(exp: number): string {
  const charge = Buffer.from(JSON.stringify({ sub: 'u', exp: exp / 1000 })).toString('base64url');
  return `entete.${charge}.signature`;
}

function session(jetonAcces: string): SessionConnexion {
  return { utilisateurId: 'u', email: 'u@ferme.fr', jetonAcces, jetonRenouvellement: 'renouvellement' };
}

/** API simulée : statut de /auth/renouveler et de /sync/upload ; compte les appels par chemin. */
function apiSimulee(statuts: { readonly renouveler: number; readonly upload: number }) {
  const appels = { renouveler: 0, upload: 0 };
  const f: typeof fetch = (entree, init) => {
    const url = new Request(entree, init).url;
    if (url === `${URL_API}/auth/renouveler`) {
      appels.renouveler++;
      return Promise.resolve(new Response(JSON.stringify({ erreur: 'jeton_invalide' }), { status: statuts.renouveler }));
    }
    if (url === `${URL_API}/sync/upload`) {
      appels.upload++;
      const corps = statuts.upload === 200 ? { refus: [] } : { erreur: 'non_authentifie' };
      return Promise.resolve(new Response(JSON.stringify(corps), { status: statuts.upload }));
    }
    return Promise.reject(new TypeError(`URL inattendue : ${url}`));
  };
  return { fetch: f, appels };
}

function stockage() {
  return { setItem: () => undefined };
}

describe('T10 (relecture C4) : session expirée pendant la synchro', () => {
  let connecteur: ModuleConnecteur;

  beforeEach(async () => {
    connecteur = await chargerConnecteur();
    vi.useFakeTimers({ now: DEPART });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function brancher(jetonAcces: string, statuts: { renouveler: number; upload: number }) {
    const base = new PowerSyncSimule([[PUT_RECOLTE]]);
    const api = apiSimulee(statuts);
    const jetons = gererJetons(session(jetonAcces), { urlApi: URL_API, fetch: api.fetch, stockage: stockage(), maintenant: () => Date.now() });
    const synchro = connecteur.brancherSynchro(base, {
      urlApi: URL_API,
      urlPowerSync: URL_POWERSYNC,
      jetons,
      fetch: api.fetch,
      enLigne: () => true,
    });
    const etats: EtatSynchroAttendu[] = [];
    synchro.surveillerEtat((e) => etats.push(e));
    return { base, api, synchro, etats };
  }

  it('renouvellement refusé à la connexion (fetchCredentials) : état session-expiree, base déconnectée, un seul appel en 10 s, saisie gardée', async () => {
    const { base, api, synchro, etats } = brancher(jwt(DEPART - 1), { renouveler: 401, upload: 200 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(api.appels.renouveler).toBe(1);
    expect(api.appels.upload).toBe(0);
    expect(synchro.etat()).toBe('session-expiree');
    expect(etats.at(-1)).toBe('session-expiree');
    expect(base.deconnexions).toBeGreaterThanOrEqual(1);
    expect(base.actif).toBe(false);
    expect(base.enAttente()).toBe(1);
    expect(base.terminees).toEqual([]);
  });

  it('401 sur l’envoi puis renouvellement refusé (uploadData) : état session-expiree, base déconnectée, pas de boucle, saisie gardée', async () => {
    // L'horloge du téléphone croit le jeton valide ; le serveur le refuse.
    const { base, api, synchro, etats } = brancher(jwt(DEPART + 10 * 60_000), { renouveler: 401, upload: 401 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(api.appels.upload).toBe(1);
    expect(api.appels.renouveler).toBe(1);
    expect(synchro.etat()).toBe('session-expiree');
    expect(etats.at(-1)).toBe('session-expiree');
    expect(base.deconnexions).toBeGreaterThanOrEqual(1);
    expect(base.actif).toBe(false);
    expect(base.enAttente()).toBe(1);
  });

  it('session valide : la file part et l’état est synchronise (jamais session-expiree)', async () => {
    const { base, api, synchro, etats } = brancher(jwt(DEPART + 10 * 60_000), { renouveler: 200, upload: 200 });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(base.connexions).toBe(1);
    expect(api.appels.upload).toBe(1);
    expect(base.terminees).toEqual([0]);
    expect(synchro.etat()).toBe('synchronise');
    expect(etats).not.toContain('session-expiree');
    expect(base.deconnexions).toBe(0);
  });
});

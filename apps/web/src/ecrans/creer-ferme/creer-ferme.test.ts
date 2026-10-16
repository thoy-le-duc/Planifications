/**
 * Tests d'acceptation T39 — créer sa ferme depuis l'appli (docs/backlog/T39-creer-sa-ferme.md) :
 * règles sans écran (nom, envoi à l'API, erreurs traduites, choix de l'écran).
 *
 * ── API attendue (apps/web/src/ecrans/creer-ferme/creer-ferme.ts) ───────────────────────────
 *
 * NOM_FERME_MAX = 200 ; FUSEAU_PAR_DEFAUT = 'Europe/Paris'
 *
 * validerNomFerme(nom: string): { ok: true; nom: string } | { ok: false; raison: 'vide' | 'trop_long' | 'caracteres' }
 *   Mêmes règles que l'API (apps/api/src/fermes.ts, nomValide) : caractères de contrôle ou de
 *   format (\p{Cc}, \p{Cf}) refusés, même en bord ; espaces de bord retirés ; vide → 'vide' ;
 *   plus de 200 caractères (après retrait des espaces) → 'trop_long'.
 *
 * type RaisonEchecCreation = 'hors_ligne' | 'session_expiree' | 'nom_refuse' | 'erreur'
 * type ResultatCreation = { ok: true; fermeId: string } | { ok: false; raison: RaisonEchecCreation }
 *
 * creerFerme(o: {
 *   urlApi: string; fetch: typeof fetch;
 *   jetons: Pick<GestionJetons, 'jetonValide' | 'invalider'>;   // src/donnees/jeton.ts
 *   id: string; nom: string;
 * }): Promise<ResultatCreation>
 *   Nom invalide (validerNomFerme) → nom_refuse, sans réseau. Sinon POST `${urlApi}/fermes`,
 *   en-têtes `authorization: Bearer <jetonValide()>` et `content-type: application/json`, corps
 *   { id, nom (nettoyé), fuseauHoraire: 'Europe/Paris' }.
 *   201 → ok (fermeId = id) ; 409 (ferme_existante : même id, un premier envoi dont la réponse
 *   s'est perdue) → ok ; 401 → invalider() puis UN nouvel essai avec un jeton neuf, 401 encore →
 *   session_expiree ; 400 → nom_refuse ; fetch qui lève → hors_ligne ; jetonValide() qui rejette
 *   par SessionExpiree (@planif/sync) → session_expiree, par autre chose (renouvellement sans
 *   réseau) → hors_ligne ; autre statut → erreur.
 *
 * messageCreation(raison: RaisonEchecCreation): string — en français, sans jargon.
 *
 * type EcranSansFerme = 'formulaire' | 'hors-ligne' | 'premiere-synchro'
 * choisirEcranSansFerme({ synchro: EtatSynchro; enLigne: boolean }): EcranSansFerme
 *   (base 'sans-ferme' : la coquille ne le demande que là)
 *   hors ligne (navigator.onLine faux) → 'hors-ligne' : on ne propose pas un bouton qui échouera ;
 *   en ligne, synchro 'connexion' (première synchro pas encore terminée : la ferme existe
 *   peut-être déjà, elle n'est juste pas arrivée) → 'premiere-synchro' ; sinon → 'formulaire'.
 */
import { describe, expect, it, vi } from 'vitest';
import { SessionExpiree } from '@planif/sync';
import {
  choisirEcranSansFerme,
  creerFerme,
  FUSEAU_PAR_DEFAUT,
  messageCreation,
  NOM_FERME_MAX,
  validerNomFerme,
  type RaisonEchecCreation,
} from './creer-ferme.ts';

const ID = '0192f0c1-13f1-7000-8000-0000000000f9';
const URL_API = 'https://api.exemple.fr';

function reponse(statut: number, corps: unknown = {}): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
}

function jetons(...valeurs: string[]) {
  let i = 0;
  return {
    jetonValide: vi.fn(() => Promise.resolve(valeurs[Math.min(i++, valeurs.length - 1)] ?? 'jeton')),
    invalider: vi.fn(),
  };
}

interface Appel {
  readonly url: string;
  readonly methode: string | undefined;
  readonly entetes: Headers;
  readonly corps: unknown;
}

function fetchSimule(...reponses: (Response | Error)[]) {
  const appels: Appel[] = [];
  let i = 0;
  const f = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    appels.push({
      url: String(url),
      methode: init?.method,
      entetes: new Headers(init?.headers),
      corps: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    const r = reponses[Math.min(i++, reponses.length - 1)];
    if (r === undefined) return Promise.reject(new TypeError('Failed to fetch'));
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
  return { fetch: f as unknown as typeof fetch, appels, espion: f };
}

describe('T39 — validerNomFerme : mêmes règles que l’API', () => {
  it('nom ordinaire : accepté, espaces de bord retirés', () => {
    expect(validerNomFerme('  Ferme de Benoît  ')).toEqual({ ok: true, nom: 'Ferme de Benoît' });
  });

  it('nom vide ou fait d’espaces : refusé', () => {
    expect(validerNomFerme('')).toEqual({ ok: false, raison: 'vide' });
    expect(validerNomFerme('    ')).toEqual({ ok: false, raison: 'vide' });
  });

  it('200 caractères au plus (après retrait des espaces)', () => {
    expect(NOM_FERME_MAX).toBe(200);
    expect(validerNomFerme('a'.repeat(200))).toEqual({ ok: true, nom: 'a'.repeat(200) });
    expect(validerNomFerme(` ${'a'.repeat(200)} `)).toEqual({ ok: true, nom: 'a'.repeat(200) });
    expect(validerNomFerme('a'.repeat(201))).toEqual({ ok: false, raison: 'trop_long' });
  });

  it('caractères de contrôle ou de format refusés, même en bord', () => {
    expect(validerNomFerme('Ferme\nBcc: x')).toEqual({ ok: false, raison: 'caracteres' });
    expect(validerNomFerme('Ferme‮')).toEqual({ ok: false, raison: 'caracteres' });
    expect(validerNomFerme('\tFerme')).toEqual({ ok: false, raison: 'caracteres' });
  });
});

describe('T39 — creerFerme : POST /fermes avec le jeton de la session', () => {
  it('201 : envoie id, nom nettoyé et fuseau Europe/Paris avec le jeton d’accès', async () => {
    const { fetch, appels } = fetchSimule(reponse(201, { id: ID, nom: 'Les Prés', fuseauHoraire: 'Europe/Paris', role: 'gerant' }));
    const r = await creerFerme({ urlApi: URL_API, fetch, jetons: jetons('jeton-1'), id: ID, nom: '  Les Prés ' });
    expect(r).toEqual({ ok: true, fermeId: ID });
    expect(appels).toHaveLength(1);
    const [appel] = appels;
    expect(appel?.url).toBe(`${URL_API}/fermes`);
    expect(appel?.methode).toBe('POST');
    expect(appel?.entetes.get('authorization')).toBe('Bearer jeton-1');
    expect(appel?.entetes.get('content-type')).toBe('application/json');
    expect(appel?.corps).toEqual({ id: ID, nom: 'Les Prés', fuseauHoraire: 'Europe/Paris' });
    expect(FUSEAU_PAR_DEFAUT).toBe('Europe/Paris');
  });

  it('409 (même id déjà créé, réponse précédente perdue) : réussite', async () => {
    const { fetch } = fetchSimule(reponse(409, { erreur: 'ferme_existante' }));
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: jetons(), id: ID, nom: 'Les Prés' })).toEqual({ ok: true, fermeId: ID });
  });

  it('nom invalide : nom_refuse sans rien envoyer', async () => {
    const { fetch, espion } = fetchSimule(reponse(201));
    const j = jetons();
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: j, id: ID, nom: '   ' })).toEqual({ ok: false, raison: 'nom_refuse' });
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: j, id: ID, nom: 'x'.repeat(201) })).toEqual({ ok: false, raison: 'nom_refuse' });
    expect(espion).not.toHaveBeenCalled();
  });

  it('401 puis 201 : jeton invalidé, un seul nouvel essai avec le jeton neuf', async () => {
    const { fetch, appels } = fetchSimule(reponse(401, { erreur: 'non_authentifie' }), reponse(201));
    const j = jetons('ancien', 'neuf');
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: j, id: ID, nom: 'Les Prés' })).toEqual({ ok: true, fermeId: ID });
    expect(j.invalider).toHaveBeenCalledTimes(1);
    expect(appels.map((a) => a.entetes.get('authorization'))).toEqual(['Bearer ancien', 'Bearer neuf']);
    expect(appels[1]?.corps).toEqual(appels[0]?.corps);
  });

  it('401 deux fois : session_expiree, sans troisième essai', async () => {
    const { fetch, appels } = fetchSimule(reponse(401), reponse(401), reponse(201));
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: jetons('a', 'b', 'c'), id: ID, nom: 'Les Prés' })).toEqual({
      ok: false,
      raison: 'session_expiree',
    });
    expect(appels).toHaveLength(2);
  });

  it('renouvellement refusé (SessionExpiree) : session_expiree, rien n’est envoyé', async () => {
    const { fetch, espion } = fetchSimule(reponse(201));
    const j = { jetonValide: vi.fn(() => Promise.reject(new SessionExpiree())), invalider: vi.fn() };
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: j, id: ID, nom: 'Les Prés' })).toEqual({ ok: false, raison: 'session_expiree' });
    expect(espion).not.toHaveBeenCalled();
  });

  it('renouvellement impossible (pas de réseau) : hors_ligne', async () => {
    const { fetch } = fetchSimule(reponse(201));
    const j = { jetonValide: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))), invalider: vi.fn() };
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: j, id: ID, nom: 'Les Prés' })).toEqual({ ok: false, raison: 'hors_ligne' });
  });

  it('fetch qui lève (pas de réseau) : hors_ligne', async () => {
    const { fetch } = fetchSimule(new TypeError('Failed to fetch'));
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: jetons(), id: ID, nom: 'Les Prés' })).toEqual({ ok: false, raison: 'hors_ligne' });
  });

  it('400 (nom refusé par le serveur) : nom_refuse', async () => {
    const { fetch } = fetchSimule(reponse(400, { erreur: 'requete_invalide' }));
    expect(await creerFerme({ urlApi: URL_API, fetch, jetons: jetons(), id: ID, nom: 'Les Prés' })).toEqual({ ok: false, raison: 'nom_refuse' });
  });

  it('500 ou autre : erreur', async () => {
    for (const statut of [500, 503, 404, 429]) {
      const { fetch } = fetchSimule(reponse(statut));
      expect(await creerFerme({ urlApi: URL_API, fetch, jetons: jetons(), id: ID, nom: 'Les Prés' })).toEqual({ ok: false, raison: 'erreur' });
    }
  });
});

describe('T39 — messages d’échec : en français, sans jargon', () => {
  const RAISONS: readonly RaisonEchecCreation[] = ['hors_ligne', 'session_expiree', 'nom_refuse', 'erreur'];
  const JARGON = /\b(40\d|50\d|http|fetch|jeton|token|api|uuid|json|serveur a répondu)\b/i;

  it.each(RAISONS)('%s : une phrase claire, sans code ni terme technique', (raison) => {
    const m = messageCreation(raison);
    expect(m.length).toBeGreaterThan(10);
    expect(m).not.toMatch(JARGON);
  });

  it('chaque cas dit ce qui se passe', () => {
    expect(messageCreation('hors_ligne')).toMatch(/réseau/i);
    expect(messageCreation('session_expiree')).toMatch(/reconnect/i);
    expect(messageCreation('nom_refuse')).toMatch(/nom/i);
    expect(messageCreation('erreur')).toMatch(/réessayez/i);
    expect(new Set(RAISONS.map(messageCreation)).size).toBe(RAISONS.length);
  });
});

describe('T39 — choisirEcranSansFerme : selon le réseau et la synchro', () => {
  it('hors ligne : jamais le formulaire, quel que soit l’état de la synchro', () => {
    for (const synchro of ['connexion', 'synchronise', 'hors-ligne', 'session-expiree'] as const) {
      expect(choisirEcranSansFerme({ synchro, enLigne: false })).toBe('hors-ligne');
    }
  });

  it('en ligne, première synchro pas terminée : on attend (la ferme existe peut-être déjà)', () => {
    expect(choisirEcranSansFerme({ synchro: 'connexion', enLigne: true })).toBe('premiere-synchro');
  });

  it('en ligne, synchro faite (ou appli sans service de synchro) : formulaire', () => {
    expect(choisirEcranSansFerme({ synchro: 'synchronise', enLigne: true })).toBe('formulaire');
    expect(choisirEcranSansFerme({ synchro: 'hors-ligne', enLigne: true })).toBe('formulaire');
    expect(choisirEcranSansFerme({ synchro: 'session-expiree', enLigne: true })).toBe('formulaire');
  });
});

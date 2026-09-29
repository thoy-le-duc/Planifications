/**
 * Jeton d'accès de la synchro (T10) : renouvelé par /auth/renouveler avant qu'il n'expire.
 *
 * Relecture T10 (C3) : `GestionJetons.invalider(): void` oublie le jeton en cours ; le prochain
 * `jetonValide()` le renouvelle par /auth/renouveler même si l'horloge locale le croit encore
 * valide (téléphone en retard de plus d'une heure : le serveur répond 401 à un jeton que le
 * téléphone croit bon). Un seul renouvellement pour des demandes simultanées, comme avant.
 * `SessionExpiree` de ce module est celle de @planif/sync (réexportée, même constructeur).
 */
import { describe, expect, it } from 'vitest';
import type { SessionConnexion } from '../connexion/session.ts';
import { expirationJeton, gererJetons as gererJetonsActuel, SessionExpiree, type GestionJetons, type OptionsJetons } from './jeton.ts';

/** Contrat de la relecture (C3) : `invalider()` s'ajoute à GestionJetons. */
type GestionJetonsInvalidable = GestionJetons & { invalider(): void };
const gererJetons = (depart: SessionConnexion, options: OptionsJetons) => gererJetonsActuel(depart, options) as GestionJetonsInvalidable;

const MAINTENANT = Date.parse('2026-10-01T06:00:00Z');

function jwt(exp: number): string {
  const charge = Buffer.from(JSON.stringify({ sub: 'u', exp: exp / 1000 })).toString('base64url');
  return `entete.${charge}.signature`;
}

function session(jetonAcces: string): SessionConnexion {
  return { utilisateurId: 'u', email: 'u@ferme.fr', jetonAcces, jetonRenouvellement: 'renouvellement' };
}

function fetchSimule(statut: number, corps: unknown) {
  const appels: { url: string; corps: unknown }[] = [];
  const f: typeof fetch = async (entree, init) => {
    const requete = new Request(entree, init);
    appels.push({ url: requete.url, corps: JSON.parse(await requete.text()) as unknown });
    return new Response(JSON.stringify(corps), { status: statut });
  };
  return { fetch: f, appels };
}

function stockage() {
  const valeurs = new Map<string, string>();
  return { valeurs, setItem: (c: string, v: string) => void valeurs.set(c, v) };
}

describe('expirationJeton', () => {
  it('lit exp (secondes) en millisecondes', () => {
    expect(expirationJeton(jwt(MAINTENANT))).toBe(MAINTENANT);
  });

  it.each(['', 'pas-un-jeton', 'a.!!!.c', `a.${Buffer.from('{"exp":"x"}').toString('base64url')}.c`])('illisible « %s » : null', (j) => {
    expect(expirationJeton(j)).toBeNull();
  });
});

describe('gererJetons', () => {
  it('garde le jeton tant qu’il vaut encore plus d’une minute, sans appel réseau', async () => {
    const jeton = jwt(MAINTENANT + 10 * 60_000);
    const { fetch, appels } = fetchSimule(200, {});
    const g = gererJetons(session(jeton), { urlApi: 'https://api', fetch, stockage: stockage(), maintenant: () => MAINTENANT });
    expect(await g.jetonValide()).toBe(jeton);
    expect(appels).toHaveLength(0);
  });

  it('renouvelle un jeton qui expire, une seule fois pour des demandes simultanées, et range la session', async () => {
    const nouveau = jwt(MAINTENANT + 3_600_000);
    const { fetch, appels } = fetchSimule(200, { jetonAcces: nouveau, jetonRenouvellement: 'renouvellement' });
    const s = stockage();
    const g = gererJetons(session(jwt(MAINTENANT + 30_000)), { urlApi: 'https://api', fetch, stockage: s, maintenant: () => MAINTENANT });
    expect(await Promise.all([g.jetonValide(), g.jetonValide()])).toEqual([nouveau, nouveau]);
    expect(appels).toEqual([{ url: 'https://api/auth/renouveler', corps: { jetonRenouvellement: 'renouvellement' } }]);
    expect(g.session().jetonAcces).toBe(nouveau);
    expect(JSON.parse(s.valeurs.get('planif.session') ?? '{}')).toMatchObject({ jetonAcces: nouveau, email: 'u@ferme.fr' });
  });

  it('jeton de renouvellement refusé : SessionExpiree', async () => {
    const { fetch } = fetchSimule(401, { erreur: 'jeton_invalide' });
    const g = gererJetons(session(jwt(MAINTENANT - 1)), { urlApi: 'https://api', fetch, stockage: stockage(), maintenant: () => MAINTENANT });
    await expect(g.jetonValide()).rejects.toBeInstanceOf(SessionExpiree);
  });
});

describe('invalider (relecture T10, C3)', () => {
  it('force le renouvellement d’un jeton que l’horloge locale croit valide, une seule fois, puis garde le neuf', async () => {
    // Téléphone en retard : pour lui, le jeton vaut encore 10 min ; le serveur l'a déjà refusé (401).
    const ancien = jwt(MAINTENANT + 10 * 60_000);
    const nouveau = jwt(MAINTENANT + 3_600_000);
    const { fetch, appels } = fetchSimule(200, { jetonAcces: nouveau, jetonRenouvellement: 'renouvellement' });
    const g = gererJetons(session(ancien), { urlApi: 'https://api', fetch, stockage: stockage(), maintenant: () => MAINTENANT });
    expect(await g.jetonValide()).toBe(ancien);
    expect(appels).toHaveLength(0);

    g.invalider();
    expect(await Promise.all([g.jetonValide(), g.jetonValide()])).toEqual([nouveau, nouveau]);
    expect(appels).toEqual([{ url: 'https://api/auth/renouveler', corps: { jetonRenouvellement: 'renouvellement' } }]);

    // Le jeton neuf sert ensuite sans nouvel appel.
    expect(await g.jetonValide()).toBe(nouveau);
    expect(appels).toHaveLength(1);
  });

  it('invalider puis renouvellement refusé : SessionExpiree', async () => {
    const { fetch } = fetchSimule(401, { erreur: 'jeton_invalide' });
    const g = gererJetons(session(jwt(MAINTENANT + 10 * 60_000)), {
      urlApi: 'https://api',
      fetch,
      stockage: stockage(),
      maintenant: () => MAINTENANT,
    });
    g.invalider();
    await expect(g.jetonValide()).rejects.toBeInstanceOf(SessionExpiree);
  });

  it('SessionExpiree est celle de @planif/sync (un seul instanceof pour l’envoi et le renouvellement)', async () => {
    const sync: Readonly<Record<string, unknown>> = await import('@planif/sync');
    expect(sync.SessionExpiree).toBe(SessionExpiree);
  });
});

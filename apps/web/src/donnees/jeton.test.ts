/** Jeton d'accès de la synchro (T10) : renouvelé par /auth/renouveler avant qu'il n'expire. */
import { describe, expect, it } from 'vitest';
import type { SessionConnexion } from '../connexion/session.ts';
import { expirationJeton, gererJetons, SessionExpiree } from './jeton.ts';

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

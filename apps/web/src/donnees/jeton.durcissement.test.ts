/**
 * Tests d'acceptation T09b — jetons sur le téléphone : rotation du jeton de renouvellement et
 * écart d'horloge.
 *
 * ── Contrat (en plus de jeton.test.ts) ──────────────────────────────────────────────────────
 *
 * OptionsJetons.stockage devient Pick<Storage, 'getItem' | 'setItem'>.
 *
 * Rotation (l'API rend un jeton de renouvellement NEUF à chaque renouvellement ; l'ancien ne
 * vaut plus que 2 minutes, et son rejeu plus tard révoque toute la session) :
 *   - le jeton de renouvellement reçu remplace l'ancien, en mémoire et dans le stockage ;
 *     le renouvellement suivant présente le neuf ;
 *   - avant chaque renouvellement, gererJetons relit la session du stockage (`planif.session`) :
 *     si elle est du même utilisateur et porte un autre jeton de renouvellement (une autre page
 *     ou un autre onglet l'a fait tourner), c'est celui-là qui est présenté. Stockage vide,
 *     illisible ou d'un autre utilisateur : on garde celui en mémoire ;
 *   - un renouvellement qui échoue sur le réseau (réponse perdue) garde l'ancien jeton : le
 *     suivant le représente (le serveur l'accepte encore pendant le délai de grâce).
 *
 * Écart d'horloge (téléphone à la mauvaise heure) :
 *   - gererJetons estime l'heure du serveur : écart = iat (du jeton d'accès, en ms) −
 *     maintenant(), mesuré à chaque jeton reçu de /auth/renouveler. Au départ, déduit du jeton
 *     de la session : max(0, iat − maintenant()) (un iat dans le futur prouve que le téléphone
 *     retarde ; un iat passé ne prouve rien, le jeton a pu être rangé hier) ;
 *   - la décision de renouveler compare exp à maintenant() + écart : on renouvelle quand
 *     exp − (maintenant() + écart) ≤ MARGE_RENOUVELLEMENT_MS (1 minute) ;
 *   - conséquences : un téléphone en retard de 2 h renouvelle avant l'expiration côté serveur ;
 *     un téléphone en avance de 2 h ne renouvelle pas à chaque appel.
 * Un jeton sans iat lisible : écart inchangé (0 par défaut), comportement de T10.
 *
 * Aucun appel réseau pour mesurer l'écart : seul l'iat des jetons reçus sert.
 */
import { describe, expect, it } from 'vitest';
import { CLE_SESSION, type SessionConnexion } from '../connexion/session.ts';
import { gererJetons, SessionExpiree } from './jeton.ts';

const S = Date.parse('2026-10-01T06:00:00Z'); // heure du serveur au départ
const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

/** JWT factice (signature non vérifiée par le téléphone) ; iat et exp en ms, écrits en secondes. */
function jwt(iat: number, exp: number): string {
  const charge = Buffer.from(JSON.stringify({ sub: 'u', iat: Math.floor(iat / 1000), exp: Math.floor(exp / 1000) })).toString('base64url');
  return `entete.${charge}.signature`;
}

function session(jetonAcces: string, jetonRenouvellement = 'r0'): SessionConnexion {
  return { utilisateurId: 'u', email: 'u@ferme.fr', jetonAcces, jetonRenouvellement };
}

type Reponse = { readonly statut: number; readonly corps: unknown } | 'hors_ligne';

/** fetch qui rend les réponses dans l'ordre (la dernière se répète). */
function fetchSimule(...reponses: readonly Reponse[]) {
  const appels: { url: string; corps: Record<string, unknown> }[] = [];
  const f: typeof fetch = async (entree, init) => {
    const requete = new Request(entree, init);
    appels.push({ url: requete.url, corps: JSON.parse(await requete.text()) as Record<string, unknown> });
    const r = reponses[Math.min(appels.length - 1, reponses.length - 1)] ?? 'hors_ligne';
    if (r === 'hors_ligne') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.corps), { status: r.statut });
  };
  return { fetch: f, appels };
}

function stockage(initial?: SessionConnexion) {
  const valeurs = new Map<string, string>();
  if (initial !== undefined) valeurs.set(CLE_SESSION, JSON.stringify(initial));
  return {
    valeurs,
    getItem: (c: string) => valeurs.get(c) ?? null,
    setItem: (c: string, v: string) => void valeurs.set(c, v),
  };
}

function horloge(depart: number) {
  let t = depart;
  return {
    maintenant: () => t,
    regler: (v: number) => {
      t = v;
    },
  };
}

describe('rotation du jeton de renouvellement (T09b)', () => {
  it('le jeton de renouvellement reçu remplace l’ancien, en mémoire et dans le stockage, et sert au renouvellement suivant', async () => {
    const h = horloge(S);
    const { fetch, appels } = fetchSimule(
      { statut: 200, corps: { jetonAcces: jwt(S, S + HEURE), jetonRenouvellement: 'r1' } },
      { statut: 200, corps: { jetonAcces: jwt(S + HEURE, S + 2 * HEURE), jetonRenouvellement: 'r2' } },
    );
    const s = stockage();
    const g = gererJetons(session(jwt(S - HEURE, S - MINUTE)), { urlApi: 'https://api', fetch, stockage: s, maintenant: h.maintenant });

    await g.jetonValide();
    expect(g.session().jetonRenouvellement).toBe('r1');
    expect(JSON.parse(s.valeurs.get(CLE_SESSION) ?? '{}')).toMatchObject({ jetonRenouvellement: 'r1' });

    h.regler(S + HEURE);
    await g.jetonValide();
    expect(appels.map((a) => a.corps.jetonRenouvellement)).toEqual(['r0', 'r1']);
    expect(JSON.parse(s.valeurs.get(CLE_SESSION) ?? '{}')).toMatchObject({ jetonRenouvellement: 'r2' });
  });

  it('une autre page a fait tourner le jeton : on présente celui du stockage, pas l’ancien en mémoire', async () => {
    const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: jwt(S, S + HEURE), jetonRenouvellement: 'r-suivant' } });
    const s = stockage(session(jwt(S - 10 * MINUTE, S + 50 * MINUTE), 'r-autre-onglet'));
    const g = gererJetons(session(jwt(S - HEURE, S - MINUTE), 'r0'), { urlApi: 'https://api', fetch, stockage: s, maintenant: () => S });
    await g.jetonValide();
    expect(appels.map((a) => a.corps.jetonRenouvellement)).toEqual(['r-autre-onglet']);
  });

  it('stockage d’un autre utilisateur ou illisible : on garde le jeton en mémoire', async () => {
    for (const brut of [JSON.stringify({ ...session('a.b.c', 'r-autre'), utilisateurId: 'v' }), '{pas du json']) {
      const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: jwt(S, S + HEURE), jetonRenouvellement: 'r1' } });
      const s = stockage();
      s.valeurs.set(CLE_SESSION, brut);
      const g = gererJetons(session(jwt(S - HEURE, S - MINUTE), 'r0'), { urlApi: 'https://api', fetch, stockage: s, maintenant: () => S });
      await g.jetonValide();
      expect(appels.map((a) => a.corps.jetonRenouvellement)).toEqual(['r0']);
    }
  });

  it('réponse perdue (réseau coupé) : l’ancien jeton est gardé et représenté', async () => {
    const { fetch, appels } = fetchSimule('hors_ligne', { statut: 200, corps: { jetonAcces: jwt(S, S + HEURE), jetonRenouvellement: 'r1' } });
    const g = gererJetons(session(jwt(S - HEURE, S - MINUTE), 'r0'), { urlApi: 'https://api', fetch, stockage: stockage(), maintenant: () => S });
    await expect(g.jetonValide()).rejects.not.toBeInstanceOf(SessionExpiree);
    expect(g.session().jetonRenouvellement).toBe('r0');
    await g.jetonValide();
    expect(appels.map((a) => a.corps.jetonRenouvellement)).toEqual(['r0', 'r0']);
    expect(g.session().jetonRenouvellement).toBe('r1');
  });
});

describe('écart d’horloge (T09b)', () => {
  it('téléphone en retard de 2 h, jeton reçu d’un renouvellement : renouvelle avant l’expiration côté serveur', async () => {
    const local = S - 2 * HEURE; // l'horloge du téléphone
    const h = horloge(local);
    const neuf = jwt(S, S + HEURE);
    const suivant = jwt(S + HEURE, S + 2 * HEURE);
    const { fetch, appels } = fetchSimule(
      { statut: 200, corps: { jetonAcces: neuf, jetonRenouvellement: 'r1' } },
      { statut: 200, corps: { jetonAcces: suivant, jetonRenouvellement: 'r2' } },
    );
    // Jeton de départ périmé (rangé la veille) : renouvelé tout de suite.
    const g = gererJetons(session(jwt(local - 26 * HEURE, local - 25 * HEURE)), {
      urlApi: 'https://api',
      fetch,
      stockage: stockage(),
      maintenant: h.maintenant,
    });
    expect(await g.jetonValide()).toBe(neuf);
    expect(appels).toHaveLength(1);

    // 50 min plus tard (serveur : S + 50 min) : encore 10 min, on garde.
    h.regler(local + 50 * MINUTE);
    expect(await g.jetonValide()).toBe(neuf);
    expect(appels).toHaveLength(1);

    // 59 min 30 s plus tard (serveur : 30 s avant exp) : on renouvelle, alors que l'horloge
    // locale croit le jeton valable encore 2 h 30.
    h.regler(local + 59 * MINUTE + 30_000);
    expect(await g.jetonValide()).toBe(suivant);
    expect(appels).toHaveLength(2);
  });

  it('téléphone en retard de 2 h, juste après la connexion : l’iat du jeton de la session suffit', async () => {
    const local = S - 2 * HEURE;
    const h = horloge(local);
    const depart = jwt(S, S + HEURE); // émis par /auth/verifier à l'instant (heure du serveur)
    const suivant = jwt(S + HEURE, S + 2 * HEURE);
    const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: suivant, jetonRenouvellement: 'r1' } });
    const g = gererJetons(session(depart), { urlApi: 'https://api', fetch, stockage: stockage(), maintenant: h.maintenant });

    h.regler(local + 50 * MINUTE);
    expect(await g.jetonValide()).toBe(depart);
    expect(appels).toHaveLength(0);

    h.regler(local + 59 * MINUTE + 30_000);
    expect(await g.jetonValide()).toBe(suivant);
    expect(appels).toHaveLength(1);
  });

  it('téléphone en avance de 2 h : ne renouvelle pas à chaque appel', async () => {
    const local = S + 2 * HEURE;
    const h = horloge(local);
    const neuf = jwt(S, S + HEURE);
    const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: neuf, jetonRenouvellement: 'r1' } });
    const g = gererJetons(session(jwt(S - 2 * HEURE, S - HEURE)), { urlApi: 'https://api', fetch, stockage: stockage(), maintenant: h.maintenant });
    expect(await g.jetonValide()).toBe(neuf);
    expect(appels).toHaveLength(1);

    for (const apres of [MINUTE, 10 * MINUTE, 50 * MINUTE]) {
      h.regler(local + apres);
      expect(await g.jetonValide()).toBe(neuf);
    }
    expect(appels).toHaveLength(1);

    h.regler(local + 59 * MINUTE + 30_000);
    await g.jetonValide();
    expect(appels).toHaveLength(2);
  });

  it('téléphone à l’heure, jeton de départ ancien (iat passé) : aucun écart inventé', async () => {
    const h = horloge(S);
    const depart = jwt(S - 30 * MINUTE, S + 30 * MINUTE);
    const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: jwt(S, S + HEURE), jetonRenouvellement: 'r1' } });
    const g = gererJetons(session(depart), { urlApi: 'https://api', fetch, stockage: stockage(), maintenant: h.maintenant });
    h.regler(S + 25 * MINUTE);
    expect(await g.jetonValide()).toBe(depart);
    h.regler(S + 29 * MINUTE + 30_000);
    await g.jetonValide();
    expect(appels).toHaveLength(1);
  });
});

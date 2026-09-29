/**
 * Tests d'acceptation T09b — jetons sur le téléphone : rotation du jeton de renouvellement et
 * écart d'horloge.
 *
 * ── Contrat (en plus de jeton.test.ts) ──────────────────────────────────────────────────────
 *
 * OptionsJetons.stockage devient Pick<Storage, 'getItem' | 'setItem'>.
 *
 * Rotation (l'API rend un jeton de renouvellement NEUF à chaque renouvellement ; l'ancien reste
 * acceptable tant que ce successeur n'a pas servi, 7 jours au plus ; présenté après, il révoque
 * toute la session) :
 *   - le jeton de renouvellement reçu remplace l'ancien, en mémoire et dans le stockage ;
 *     le renouvellement suivant présente le neuf ;
 *   - avant chaque renouvellement, gererJetons relit la session du stockage (`planif.session`) :
 *     si elle est du même utilisateur et porte un autre jeton de renouvellement (une autre page
 *     ou un autre onglet l'a fait tourner), c'est celui-là qui est présenté. Stockage vide,
 *     illisible ou d'un autre utilisateur : on garde celui en mémoire ;
 *   - un renouvellement qui échoue sur le réseau (réponse perdue) garde l'ancien jeton : le
 *     suivant le représente (le serveur l'accepte tant que le successeur perdu n'a pas servi).
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
 * Écart persistant (relecture sécurité) : l'écart est RANGÉ AVEC LA SESSION et relu au
 * démarrage, sinon un téléphone en retard de 2 h, appli relancée, rendrait un jeton périmé pour
 * le serveur (l'iat du jeton rangé ne prouve alors plus tout le retard).
 *   - SessionConnexion gagne `readonly ecartHorlogeMs?: number` (heure du serveur − heure du
 *     téléphone, en ms, mesuré au dernier jeton reçu ; négatif si le téléphone avance) ;
 *   - enregistrerSession le range avec le reste (clé `planif.session`), lireSession et
 *     sessionValide le rendent s'il est un nombre fini, l'omettent sinon (session toujours
 *     valide : une valeur illisible ne déconnecte pas) ;
 *   - gererJetons : la session rangée après chaque renouvellement porte l'écart mesuré ; au
 *     départ, l'écart vaut `depart.ecartHorlogeMs` s'il est présent (même négatif), sinon
 *     max(0, iat − maintenant()) comme avant.
 *
 * Aucun appel réseau pour mesurer l'écart : seul l'iat des jetons reçus sert.
 *
 * ── 2e relecture sécurité ───────────────────────────────────────────────────────────────────
 *
 * B1 — un seul renouvellement à la fois ENTRE ONGLETS : l'API révoque toute la session quand on
 * lui présente un jeton déjà remplacé (deux détenteurs). Deux onglets (ou la page et la page de
 * diagnostic) qui renouvellent en même temps avec le même jeton la feraient tomber.
 *   - si `navigator.locks` existe, gererJetons fait « relire la session rangée, renouveler si
 *     nécessaire, ranger la session neuve » sous `navigator.locks.request('planif-renouvellement',
 *     rappel)` (verrou exclusif, par défaut). Sous le verrou, la session relue du stockage (même
 *     utilisateur) remplace celle en mémoire ; si son jeton d'accès est encore valable (même
 *     règle de marge et d'écart), il est rendu sans appel réseau ;
 *   - conséquence vérifiée ici : deux GestionJetons partageant le même stockage, qui renouvellent
 *     en même temps, ne présentent JAMAIS deux fois le même jeton de renouvellement ;
 *   - sans `navigator.locks` (navigateur ancien, `navigator` absent) : comportement d'avant
 *     (un seul renouvellement à la fois dans la page, relecture du stockage avant de renouveler).
 *
 * Mineur — écart d'horloge relu du stockage : lireSession et sessionValide OMETTENT un
 * `ecartHorlogeMs` dont la valeur absolue dépasse 48 h (172 800 000 ms ; ±48 h pile restent
 * acceptés) : une valeur aberrante (stockage modifié) ne doit pas faire renouveler à chaque
 * appel ni garder un jeton périmé. La session reste valide, l'écart est alors estimé comme sans
 * valeur rangée.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLE_SESSION, lireSession, sessionValide, type SessionConnexion } from '../connexion/session.ts';
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

/** SessionConnexion avec l'écart rangé (champ ajouté par la relecture sécurité). */
type SessionAvecEcart = SessionConnexion & { readonly ecartHorlogeMs?: number };

/** Champ `ecartHorlogeMs` d'une session lue, s'il y est (sans supposer le type à jour). */
function ecartDe(lue: object | null): unknown {
  return lue !== null && 'ecartHorlogeMs' in lue ? lue.ecartHorlogeMs : undefined;
}

function ecartRange(s: { readonly valeurs: Map<string, string> }): unknown {
  return (JSON.parse(s.valeurs.get(CLE_SESSION) ?? '{}') as Record<string, unknown>).ecartHorlogeMs;
}

describe('écart d’horloge rangé avec la session (relecture sécurité)', () => {
  it('lireSession et sessionValide gardent un écart numérique, omettent un écart illisible', () => {
    const base = session('a.b.c');
    const avec = (ecart: unknown) => ({ getItem: () => JSON.stringify({ ...base, ecartHorlogeMs: ecart }) });
    expect(ecartDe(lireSession(avec(7_200_000)))).toBe(7_200_000);
    expect(ecartDe(lireSession(avec(-7_200_000)))).toBe(-7_200_000);
    expect(ecartDe(sessionValide({ ...base, ecartHorlogeMs: 0 }))).toBe(0);
    for (const illisible of ['2h', null, Number.NaN, {}]) {
      const lue = lireSession(avec(illisible));
      expect(lue, JSON.stringify(illisible)).not.toBeNull();
      expect(ecartDe(lue), JSON.stringify(illisible)).toBeUndefined();
    }
  });

  it('téléphone en retard de 2 h, appli relancée : l’écart relu fait renouveler avant de rendre un jeton périmé pour le serveur', async () => {
    const local = S - 2 * HEURE;
    const h = horloge(local);
    const neuf = jwt(S, S + HEURE);
    const suivant = jwt(S + HEURE, S + 2 * HEURE);
    const { fetch, appels } = fetchSimule(
      { statut: 200, corps: { jetonAcces: neuf, jetonRenouvellement: 'r1' } },
      { statut: 200, corps: { jetonAcces: suivant, jetonRenouvellement: 'r2' } },
    );
    const s = stockage();
    const premiere = gererJetons(session(jwt(local - 26 * HEURE, local - 25 * HEURE)), {
      urlApi: 'https://api',
      fetch,
      stockage: s,
      maintenant: h.maintenant,
    });
    expect(await premiere.jetonValide()).toBe(neuf);
    expect(ecartRange(s)).toBe(2 * HEURE);

    // Appli fermée, rouverte 59 min 30 s plus tard (serveur : 30 s avant exp).
    h.regler(local + 59 * MINUTE + 30_000);
    const rangee = lireSession(s);
    expect(rangee).not.toBeNull();
    const relancee = gererJetons(rangee ?? session('x'), { urlApi: 'https://api', fetch, stockage: s, maintenant: h.maintenant });
    expect(await relancee.jetonValide()).toBe(suivant);
    expect(appels).toHaveLength(2);
    expect(ecartRange(s)).toBe(2 * HEURE - (59 * MINUTE + 30_000) + HEURE);
  });

  it('téléphone en avance de 2 h, appli relancée : l’écart négatif relu évite de renouveler à chaque appel', async () => {
    const local = S + 2 * HEURE;
    const h = horloge(local + 10 * MINUTE);
    const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: jwt(S + HEURE, S + 2 * HEURE), jetonRenouvellement: 'r1' } });
    const rangee: SessionAvecEcart = { ...session(jwt(S, S + HEURE)), ecartHorlogeMs: -2 * HEURE };
    const g = gererJetons(rangee, { urlApi: 'https://api', fetch, stockage: stockage(rangee), maintenant: h.maintenant });
    expect(await g.jetonValide()).toBe(rangee.jetonAcces);
    h.regler(local + 50 * MINUTE);
    expect(await g.jetonValide()).toBe(rangee.jetonAcces);
    expect(appels).toHaveLength(0);
  });

  it('l’écart rangé prime sur l’estimation par l’iat du jeton rangé', async () => {
    // Retard mesuré de 2 h ; le jeton rangé, émis il y a 1 h 50 (heure du serveur), ne
    // prouverait plus qu'un retard de 10 min.
    const h = horloge(S - 2 * HEURE + 50 * MINUTE);
    const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: jwt(S + 50 * MINUTE, S + 110 * MINUTE), jetonRenouvellement: 'r1' } });
    const rangee: SessionAvecEcart = { ...session(jwt(S - HEURE, S)), ecartHorlogeMs: 2 * HEURE };
    const g = gererJetons(rangee, { urlApi: 'https://api', fetch, stockage: stockage(rangee), maintenant: h.maintenant });
    await g.jetonValide();
    expect(appels).toHaveLength(1);
  });
});

const ECART_MAX_MS = 48 * HEURE;

describe('écart d’horloge relu : ignoré au-delà de ±48 h (2e relecture sécurité)', () => {
  const lueAvec = (ecart: number) =>
    lireSession({ getItem: () => JSON.stringify({ ...session('a.b.c'), ecartHorlogeMs: ecart }) });

  it('±48 h pile : gardé ; au-delà : omis, la session reste valide', () => {
    expect(ecartDe(lueAvec(ECART_MAX_MS))).toBe(ECART_MAX_MS);
    expect(ecartDe(lueAvec(-ECART_MAX_MS))).toBe(-ECART_MAX_MS);
    for (const ecart of [ECART_MAX_MS + 1, -ECART_MAX_MS - 1, 72 * HEURE, -30 * 24 * HEURE, Number.MAX_SAFE_INTEGER]) {
      const lue = lueAvec(ecart);
      expect(lue, String(ecart)).not.toBeNull();
      expect(ecartDe(lue), String(ecart)).toBeUndefined();
      expect(ecartDe(sessionValide({ ...session('a.b.c'), ecartHorlogeMs: ecart })), String(ecart)).toBeUndefined();
    }
  });

  it('écart rangé de +72 h (aberrant), téléphone à l’heure : pas de renouvellement à chaque appel', async () => {
    const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: jwt(S, S + HEURE), jetonRenouvellement: 'r1' } });
    const rangee: SessionAvecEcart = { ...session(jwt(S - 10 * MINUTE, S + 50 * MINUTE)), ecartHorlogeMs: 72 * HEURE };
    const s = stockage(rangee);
    const relue = lireSession(s);
    expect(relue).not.toBeNull();
    const g = gererJetons(relue ?? session('x'), { urlApi: 'https://api', fetch, stockage: s, maintenant: () => S });
    expect(await g.jetonValide()).toBe(rangee.jetonAcces);
    expect(appels).toHaveLength(0);
  });
});

/** Double de navigator.locks : verrou exclusif par nom, file d'attente dans l'ordre des demandes. */
function verrousSimules() {
  const demandes: string[] = [];
  const files = new Map<string, Promise<unknown>>();
  function request(nom: string, ...args: readonly unknown[]): Promise<unknown> {
    const rappel = args.at(-1);
    if (typeof rappel !== 'function') throw new TypeError('rappel manquant');
    demandes.push(nom);
    const precedente = files.get(nom) ?? Promise.resolve();
    const resultat = precedente.then(() => (rappel as (verrou: unknown) => unknown)({ name: nom, mode: 'exclusive' }));
    files.set(
      nom,
      resultat.then(
        () => undefined,
        () => undefined,
      ),
    );
    return resultat;
  }
  return { demandes, locks: { request } };
}

/**
 * Serveur simulé : chaque jeton de renouvellement rend un jeton neuf (r1, r2…) et un jeton
 * d'accès valable 1 h ; répond après quelques millisecondes (les deux onglets se chevauchent).
 */
function serveurSimule(maintenant: () => number) {
  const presentes: string[] = [];
  const acces: string[] = [];
  let n = 0;
  const f: typeof fetch = async (entree, init) => {
    const requete = new Request(entree, init);
    const corps = JSON.parse(await requete.text()) as { jetonRenouvellement: string };
    presentes.push(corps.jetonRenouvellement);
    await new Promise((fin) => setTimeout(fin, 5));
    n += 1;
    const jetonAcces = jwt(maintenant(), maintenant() + HEURE).replace('signature', `signature${String(n)}`);
    acces.push(jetonAcces);
    return new Response(JSON.stringify({ jetonAcces, jetonRenouvellement: `r${String(n)}` }), { status: 200 });
  };
  return { fetch: f, presentes, acces };
}

describe('B1 : renouvellement sérialisé entre onglets par navigator.locks (2e relecture sécurité)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deux onglets (deux GestionJetons, même stockage) renouvellent en même temps : jamais deux fois le même jeton présenté', async () => {
    const v = verrousSimules();
    vi.stubGlobal('navigator', { locks: v.locks });
    const serveur = serveurSimule(() => S);
    const perime = session(jwt(S - HEURE, S - MINUTE), 'r0');
    const s = stockage(perime);
    const options = { urlApi: 'https://api', fetch: serveur.fetch, stockage: s, maintenant: () => S };
    const ongletA = gererJetons(perime, options);
    const ongletB = gererJetons(perime, options);

    const [a, b] = await Promise.all([ongletA.jetonValide(), ongletB.jetonValide()]);

    expect(serveur.presentes.length).toBeGreaterThanOrEqual(1);
    expect(new Set(serveur.presentes).size, `présentés : ${serveur.presentes.join(', ')}`).toBe(serveur.presentes.length);
    expect(v.demandes).toContain('planif-renouvellement');
    // Chaque onglet a un jeton d'accès émis par le serveur, et le stockage porte le dernier jeton rendu.
    expect(serveur.acces).toContain(a);
    expect(serveur.acces).toContain(b);
    expect(lireSession(s)?.jetonRenouvellement).toBe(`r${String(serveur.presentes.length)}`);
  });

  it('trois onglets, deux vagues de renouvellement : toujours aucun jeton présenté deux fois', async () => {
    const v = verrousSimules();
    vi.stubGlobal('navigator', { locks: v.locks });
    const h = horloge(S);
    const serveur = serveurSimule(h.maintenant);
    const perime = session(jwt(S - HEURE, S - MINUTE), 'r0');
    const s = stockage(perime);
    const options = { urlApi: 'https://api', fetch: serveur.fetch, stockage: s, maintenant: h.maintenant };
    const onglets = [gererJetons(perime, options), gererJetons(perime, options), gererJetons(perime, options)];

    await Promise.all(onglets.map((g) => g.jetonValide()));
    h.regler(S + HEURE); // tous les jetons d'accès arrivent à expiration
    await Promise.all(onglets.map((g) => g.jetonValide()));

    expect(new Set(serveur.presentes).size, `présentés : ${serveur.presentes.join(', ')}`).toBe(serveur.presentes.length);
  });

  it('sans navigator.locks (ou sans navigator) : le renouvellement marche comme avant', async () => {
    for (const nav of [{}, undefined]) {
      vi.stubGlobal('navigator', nav);
      const { fetch, appels } = fetchSimule({ statut: 200, corps: { jetonAcces: jwt(S, S + HEURE), jetonRenouvellement: 'r1' } });
      const s = stockage();
      const g = gererJetons(session(jwt(S - HEURE, S - MINUTE), 'r0'), { urlApi: 'https://api', fetch, stockage: s, maintenant: () => S });
      const [x, y] = await Promise.all([g.jetonValide(), g.jetonValide()]);
      expect(x).toBe(y);
      expect(appels.map((a) => a.corps.jetonRenouvellement)).toEqual(['r0']);
      expect(JSON.parse(s.valeurs.get(CLE_SESSION) ?? '{}')).toMatchObject({ jetonRenouvellement: 'r1' });
      vi.unstubAllGlobals();
    }
  });
});

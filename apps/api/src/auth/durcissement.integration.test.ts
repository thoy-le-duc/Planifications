/**
 * Tests d'acceptation T09b — durcissement de la connexion, contre un vrai Postgres.
 *
 * Exécution : comme les autres tests d'intégration (DATABASE_URL, base jetable `t09b_…`
 * migrée puis supprimée ; échec en CI sans DATABASE_URL, saut signalé en local).
 * Les routes de T09 et leur contrat restent ceux de auth.integration.test.ts ; ce fichier
 * n'ajoute que T09b. Horloge : `maintenant` injecté, comme en T09.
 *
 * ── 1. Déconnexion ──────────────────────────────────────────────────────────────────────────
 *
 *   POST /auth/deconnexion  { jetonRenouvellement }
 *     204, corps vide. Ne demande PAS de jeton d'accès (on se déconnecte aussi avec un jeton
 *     d'accès expiré). Révoque (revoque_le = maintenant) le jeton présenté ET toute sa famille
 *     (tous les jetons issus de la même connexion, voir 2) : un ancien jeton encore dans son
 *     délai de grâce ne rouvre pas la session. Les autres sessions du même compte (autre
 *     téléphone, autre connexion) ne sont pas touchées.
 *     Jeton inconnu, déjà révoqué ou expiré : 204 aussi, rien ne change (on ne révèle rien, et
 *     l'appli rejoue sans risque une déconnexion dont la réponse s'est perdue).
 *     Corps sans chaîne `jetonRenouvellement` : 400 { erreur: 'requete_invalide' }.
 *   Limite connue : un jeton d'accès déjà émis reste valable jusqu'à son exp (1 h au plus).
 *
 * ── 2. Rotation du jeton de renouvellement ──────────────────────────────────────────────────
 *
 *   POST /auth/renouveler  { jetonRenouvellement }  →  200 { jetonAcces, jetonRenouvellement }
 *     - le jeton rendu est NEUF (différent de celui présenté), stocké haché, de la même famille
 *       (même connexion : le plafond de 365 jours après la connexion vaut pour toute la
 *       famille) ;
 *     - l'ancien reste accepté pendant DELAI_GRACE = 2 minutes après son PREMIER usage (réponse
 *       perdue au champ) : il rend alors un jeton valable (neuf ou le même successeur, au choix
 *       de l'implémentation) ;
 *     - présenté après ce délai (rejeu), il est refusé (401 { erreur: 'jeton_invalide' }) et
 *       TOUTE la famille est révoquée : le dernier jeton rendu aussi. Les autres sessions du
 *       compte ne sont pas touchées ;
 *     - deux renouvellements simultanés avec le même jeton (dans le délai de grâce) réussissent
 *       tous les deux, et chaque jeton rendu renouvelle à son tour.
 *   Le contrat de T09 « le même jeton reste valable après usage » est remplacé par ces règles
 *   (tests de auth.integration.test.ts adaptés, voir leurs commentaires).
 *
 * ── 3. Limite par adresse IP sur /auth/code et /auth/verifier ───────────────────────────────
 *
 *   Seuils (fenêtre glissante d'une heure, mesurée par `maintenant`, comptée en base : partagée
 *   entre plusieurs processus d'API, sans perte au redémarrage) :
 *     CODES_PAR_IP_PAR_HEURE          = 30   demandes POST /auth/code (réussies ou non)
 *     VERIFICATIONS_PAR_IP_PAR_HEURE  = 60   POST /auth/verifier (réussies ou non)
 *   Au-delà : 429 { erreur: 'trop_de_demandes' } + Retry-After (secondes, ≥ 1), la même
 *   réponse que les limites par adresse e-mail, sans rien créer, envoyer, ni consommer (pas de
 *   tentative comptée sur le code visé). Les limites par adresse e-mail de T09 restent.
 *   Pourquoi ces seuils : un bureau ou un magasin derrière une même IP (NAT) garde de la marge
 *   (30 personnes qui demandent un code dans l'heure), alors qu'un robot est freiné à
 *   60 vérifications/h par IP, en plus des 10 échecs par adresse sur 24 h.
 *
 *   Adresse du client :
 *     - par défaut, celle de la socket, lue comme @hono/node-server la fournit :
 *       `c.env.incoming.socket.remoteAddress` (getConnInfo de '@hono/node-server/conninfo').
 *       Les en-têtes (X-Forwarded-For, X-Real-IP, Forwarded…) sont IGNORÉS ;
 *     - si DependancesApp.proxyDeConfiance === true (config : PROXY_DE_CONFIANCE=1, voir
 *       config.test.ts) : la DERNIÈRE valeur de X-Forwarded-For (celle ajoutée par notre
 *       proxy ; les précédentes viennent du client et se falsifient), espaces retirés ; en-tête
 *       absent ou vide → adresse de la socket ;
 *     - adresse inconnue (pas de socket : app.request() sans env, comme dans les tests de T09)
 *       → pas de limite par IP, et surtout pas d'exception.
 *
 *   DependancesApp gagne `readonly proxyDeConfiance?: boolean` (false par défaut) ; index.ts
 *   le passe depuis lireConfig. Dans ces tests, l'adresse de socket est fournie par le 3e
 *   argument de app.request (env { incoming: { socket: { remoteAddress } } }), et un test
 *   passe par un vrai serveur @hono/node-server sur 127.0.0.1.
 *
 * ── 4. Garde : utilisateur supprimé ou inconnu ──────────────────────────────────────────────
 *
 *   La garde relit `utilisateur` à chaque requête : si le `sub` d'un jeton d'accès par ailleurs
 *   valable désigne un utilisateur supprimé (supprime_le non nul) ou inexistant, toute route
 *   protégée répond 401 { erreur: 'non_authentifie' } et n'écrit rien (GET /moi, POST /fermes,
 *   /fermes/:id…, POST /sync/upload). Remplace le 404 ferme_introuvable attendu par T09 dans ce
 *   cas (test adapté dans auth.integration.test.ts).
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerApp, type DependancesApp } from '../app.ts';
import { creerBaseJetable, decrireAvecBase, type BaseJetable } from '../sync/test/base-jetable.ts';
import { genererCleSignature, type CleSignature, type ExpediteurCourriel, type MessageCourriel } from './index.ts';

const decrire = decrireAvecBase('T09b');

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const DEBUT = new Date('2026-10-01T06:00:00Z');
const SECONDE = 1000;
const MINUTE = 60 * SECONDE;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

const DELAI_GRACE_MS = 2 * MINUTE;
const CODES_PAR_IP_PAR_HEURE = 30;
const VERIFICATIONS_PAR_IP_PAR_HEURE = 60;

/** DependancesApp de T09b : `proxyDeConfiance` s'ajoute (objet non littéral : pas d'excès de propriété). */
type DependancesT09b = DependancesApp & { readonly proxyDeConfiance?: boolean };

interface Connexion {
  readonly utilisateurId: string;
  readonly jetonAcces: string;
  readonly jetonRenouvellement: string;
}

interface Renouvellement {
  readonly jetonAcces: string;
  readonly jetonRenouvellement: string;
}

class FauxExpediteur implements ExpediteurCourriel {
  readonly messages: MessageCourriel[] = [];

  envoyer(message: MessageCourriel): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }

  pour(email: string): MessageCourriel[] {
    return this.messages.filter((m) => m.a === email);
  }

  dernierCode(email: string): string {
    const code = /\b(\d{6})\b/.exec(this.pour(email).at(-1)?.texte ?? '')?.[1];
    if (code === undefined) throw new Error(`aucun code envoyé à ${email}`);
    return code;
  }
}

interface OptionsRequete {
  readonly jeton?: string;
  /** Adresse de la socket, telle que @hono/node-server la fournit. */
  readonly ip?: string;
  readonly entetes?: Readonly<Record<string, string>>;
}

function emailNeuf(): string {
  return `t09b-${randomUUID()}@ferme.fr`;
}

/** Adresse IPv4 de documentation neuve (198.18.0.0/15, réservée aux tests), une par test. */
function ipNeuve(): string {
  const octets = new Uint8Array(3);
  crypto.getRandomValues(octets);
  return `198.${String(18 + (octets[0] ?? 0) % 2)}.${String(octets[1] ?? 0)}.${String(octets[2] ?? 1)}`;
}

async function lire<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

decrire('T09b : durcissement de la connexion (API)', { timeout: 60_000 }, () => {
  let base: BaseJetable;
  let cle: CleSignature;
  let instant = DEBUT;
  const maintenant = (): Date => instant;
  const avancer = (ms: number): void => {
    instant = new Date(instant.getTime() + ms);
  };

  beforeAll(async () => {
    base = await creerBaseJetable('t09b_api');
    cle = await genererCleSignature('cle-t09b');
  }, 120_000);

  afterAll(async () => {
    await base.supprimer();
  });

  beforeEach(() => {
    instant = DEBUT;
  });

  function creer(o: { readonly proxyDeConfiance?: boolean; readonly expediteur?: FauxExpediteur } = {}) {
    const expediteur = o.expediteur ?? new FauxExpediteur();
    const deps: DependancesT09b = {
      db: drizzle(base.pool),
      expediteur,
      cles: { active: cle, precedentes: [] },
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant,
      ...(o.proxyDeConfiance === undefined ? {} : { proxyDeConfiance: o.proxyDeConfiance }),
    };
    return { app: creerApp(deps), expediteur };
  }
  type Api = ReturnType<typeof creer>;

  function requete(api: Api, methode: string, chemin: string, corps?: unknown, o: OptionsRequete = {}): Promise<Response> {
    const entetes: Record<string, string> = { ...o.entetes };
    if (corps !== undefined) entetes['content-type'] = 'application/json';
    if (o.jeton !== undefined) entetes.authorization = `Bearer ${o.jeton}`;
    const env = o.ip === undefined ? undefined : { incoming: { socket: { remoteAddress: o.ip, remotePort: 50_000, remoteFamily: 'IPv4' } } };
    return Promise.resolve(
      api.app.request(
        chemin,
        { method: methode, headers: entetes, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) },
        env,
      ),
    );
  }

  const demanderCode = (api: Api, email: string, o?: OptionsRequete) => requete(api, 'POST', '/auth/code', { email }, o);
  const verifier = (api: Api, email: string, code: string, o?: OptionsRequete) =>
    requete(api, 'POST', '/auth/verifier', { email, code }, o);
  const renouveler = (api: Api, jetonRenouvellement: string) => requete(api, 'POST', '/auth/renouveler', { jetonRenouvellement });
  const deconnecter = (api: Api, jetonRenouvellement: string) => requete(api, 'POST', '/auth/deconnexion', { jetonRenouvellement });

  async function connecter(api: Api, email = emailNeuf()): Promise<Connexion> {
    expect((await demanderCode(api, email)).status).toBe(202);
    const res = await verifier(api, email, api.expediteur.dernierCode(email));
    expect(res.status).toBe(200);
    return lire<Connexion>(res);
  }

  async function renouvele(api: Api, jeton: string): Promise<Renouvellement> {
    const res = await renouveler(api, jeton);
    expect(res.status, 'renouvellement').toBe(200);
    return lire<Renouvellement>(res);
  }

  async function refuse(res: Response, attendu = 'jeton_invalide'): Promise<void> {
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ erreur: attendu });
  }

  // --- 1. Déconnexion -------------------------------------------------------------------------

  describe('POST /auth/deconnexion', () => {
    it('révoque la session présentée : 204, puis le renouvellement est refusé', async () => {
      const api = creer();
      const { utilisateurId, jetonRenouvellement } = await connecter(api);
      const res = await deconnecter(api, jetonRenouvellement);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      await refuse(await renouveler(api, jetonRenouvellement));
      const { rows } = await base.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM jeton_renouvellement WHERE utilisateur_id = $1 AND revoque_le IS NULL`,
        [utilisateurId],
      );
      expect(rows[0]?.n).toBe(0);
    });

    it('ne demande pas de jeton d’accès : se déconnecter marche après son expiration', async () => {
      const api = creer();
      const { jetonRenouvellement } = await connecter(api);
      avancer(3 * HEURE);
      expect((await deconnecter(api, jetonRenouvellement)).status).toBe(204);
      await refuse(await renouveler(api, jetonRenouvellement));
    });

    it('ne touche pas les autres sessions du même compte (autre téléphone)', async () => {
      const api = creer();
      const email = emailNeuf();
      const telephoneA = await connecter(api, email);
      avancer(61 * SECONDE);
      const telephoneB = await connecter(api, email);
      expect(telephoneB.utilisateurId).toBe(telephoneA.utilisateurId);

      expect((await deconnecter(api, telephoneA.jetonRenouvellement)).status).toBe(204);
      await refuse(await renouveler(api, telephoneA.jetonRenouvellement));
      expect((await renouveler(api, telephoneB.jetonRenouvellement)).status).toBe(200);
    });

    it('révoque toute la famille : un ancien jeton encore dans son délai de grâce ne rouvre pas la session', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      avancer(10 * SECONDE);
      expect((await deconnecter(api, t1)).status).toBe(204);
      await refuse(await renouveler(api, t0));
      await refuse(await renouveler(api, t1));
    });

    it('présenter l’ancien jeton (délai de grâce) déconnecte aussi le successeur', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      expect((await deconnecter(api, t0)).status).toBe(204);
      await refuse(await renouveler(api, t1));
    });

    it('jeton inconnu ou déjà révoqué : 204, rien ne change ; corps invalide : 400', async () => {
      const api = creer();
      const autre = await connecter(api);
      expect((await deconnecter(api, 'x'.repeat(43))).status).toBe(204);
      expect((await deconnecter(api, autre.jetonRenouvellement)).status).toBe(204);
      expect((await deconnecter(api, autre.jetonRenouvellement)).status).toBe(204);

      for (const corps of [{}, { jetonRenouvellement: 42 }, { jetonRenouvellement: '' }]) {
        const res = await requete(api, 'POST', '/auth/deconnexion', corps);
        expect(res.status, JSON.stringify(corps)).toBe(400);
        expect(await res.json()).toEqual({ erreur: 'requete_invalide' });
      }
      const sansCorps = await requete(api, 'POST', '/auth/deconnexion');
      expect(sansCorps.status).toBe(400);
    });
  });

  // --- 2. Rotation -----------------------------------------------------------------------------

  describe('rotation du jeton de renouvellement', () => {
    it('chaque renouvellement rend un jeton neuf, stocké haché, qui renouvelle à son tour', async () => {
      const api = creer();
      const { utilisateurId, jetonRenouvellement: t0 } = await connecter(api);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      expect(t1).not.toBe(t0);
      expect(t1).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      avancer(HEURE);
      const { jetonRenouvellement: t2 } = await renouvele(api, t1);
      expect(t2).not.toBe(t1);
      expect(t2).not.toBe(t0);

      const { rows } = await base.pool.query<{ brut: string }>(
        `SELECT row_to_json(j)::text AS brut FROM jeton_renouvellement j WHERE utilisateur_id = $1`,
        [utilisateurId],
      );
      for (const r of rows) for (const jeton of [t0, t1, t2]) expect(r.brut).not.toContain(jeton);
    });

    it('réponse perdue au champ : l’ancien jeton reste accepté 2 minutes, et ce qu’il rend est valable', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      await renouvele(api, t0); // réponse perdue : le téléphone garde t0
      avancer(DELAI_GRACE_MS - SECONDE);
      const { jetonRenouvellement: t1bis } = await renouvele(api, t0);
      avancer(HEURE);
      expect((await renouveler(api, t1bis)).status).toBe(200);
    });

    it('rejeu après le délai de grâce : refusé, et toute la famille est révoquée', async () => {
      const api = creer();
      const email = emailNeuf();
      const { jetonRenouvellement: t0 } = await connecter(api, email);
      avancer(61 * SECONDE);
      const autreSession = await connecter(api, email);

      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      avancer(10 * SECONDE);
      const { jetonRenouvellement: t2 } = await renouvele(api, t1);
      avancer(DELAI_GRACE_MS); // t0 a servi il y a 2 min 10 s

      await refuse(await renouveler(api, t0));
      // Le voleur ou le téléphone légitime : on ne sait pas lequel, toute la famille tombe.
      await refuse(await renouveler(api, t2));
      await refuse(await renouveler(api, t1));
      // L'autre session du même compte n'est pas touchée.
      expect((await renouveler(api, autreSession.jetonRenouvellement)).status).toBe(200);
    });

    it('rejeu juste après le délai de grâce (2 min + 1 s) : refusé', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      avancer(DELAI_GRACE_MS + SECONDE);
      await refuse(await renouveler(api, t0));
      await refuse(await renouveler(api, t1));
    });

    it('deux renouvellements simultanés avec le même jeton : les deux réussissent, chaque jeton rendu renouvelle', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const reponses = await Promise.all([renouveler(api, t0), renouveler(api, t0)]);
      expect(reponses.map((r) => r.status)).toEqual([200, 200]);
      const rendus = await Promise.all(reponses.map((r) => lire<Renouvellement>(r)));
      for (const r of rendus) expect(r.jetonRenouvellement).not.toBe(t0);
      avancer(30 * SECONDE);
      for (const r of rendus) expect((await renouveler(api, r.jetonRenouvellement)).status).toBe(200);
    });

    it('cinq renouvellements simultanés avec le même jeton : tous réussissent (synchro et envoi en même temps)', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const reponses = await Promise.all(Array.from({ length: 5 }, () => renouveler(api, t0)));
      expect(reponses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    });

    it('le plafond de 365 jours après la connexion vaut pour toute la famille', async () => {
      const api = creer();
      let { jetonRenouvellement: jeton } = await connecter(api);
      for (let jour = 60; jour <= 360; jour += 60) {
        instant = new Date(DEBUT.getTime() + jour * JOUR);
        jeton = (await renouvele(api, jeton)).jetonRenouvellement;
      }
      instant = new Date(DEBUT.getTime() + 366 * JOUR);
      await refuse(await renouveler(api, jeton));
    });

    it('un jeton d’une famille révoquée ne sert plus, même le plus récent', async () => {
      const api = creer();
      const { utilisateurId, jetonRenouvellement: t0 } = await connecter(api);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      await base.pool.query(`UPDATE jeton_renouvellement SET revoque_le = $2 WHERE utilisateur_id = $1`, [utilisateurId, instant]);
      await refuse(await renouveler(api, t1));
    });
  });

  // --- 3. Limite par IP --------------------------------------------------------------------------

  describe('limite par adresse IP', () => {
    async function epuiserCodes(api: Api, o: (i: number) => OptionsRequete): Promise<void> {
      for (let i = 0; i < CODES_PAR_IP_PAR_HEURE; i++) {
        expect((await demanderCode(api, emailNeuf(), o(i))).status, `demande ${String(i + 1)}`).toBe(202);
      }
    }

    async function trop(res: Response): Promise<void> {
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ erreur: 'trop_de_demandes' });
      const apres = Number(res.headers.get('retry-after'));
      expect(apres).toBeGreaterThanOrEqual(1);
      expect(apres).toBeLessThanOrEqual(3600);
    }

    it('POST /auth/code : 30 demandes par IP et par heure glissante ; la 31e reçoit le 429 habituel, sans rien créer ni envoyer', async () => {
      const api = creer();
      const ip = ipNeuve();
      await epuiserCodes(api, () => ({ ip }));

      const email = emailNeuf();
      await trop(await demanderCode(api, email, { ip }));
      expect(api.expediteur.pour(email)).toHaveLength(0);
      expect((await base.pool.query(`SELECT 1 FROM code_connexion WHERE email = $1`, [email])).rowCount).toBe(0);

      // Une autre adresse IP n'est pas concernée.
      expect((await demanderCode(api, emailNeuf(), { ip: ipNeuve() })).status).toBe(202);
      // Une heure après, la fenêtre libère de la place.
      avancer(HEURE + SECONDE);
      expect((await demanderCode(api, email, { ip })).status).toBe(202);
    });

    it('POST /auth/verifier : 60 vérifications par IP et par heure ; la 61e reçoit 429 même avec le bon code, sans le consommer', async () => {
      const api = creer();
      const ip = ipNeuve();
      const email = emailNeuf();
      expect((await demanderCode(api, email, { ip: ipNeuve() })).status).toBe(202);
      const code = api.expediteur.dernierCode(email);

      for (let i = 0; i < VERIFICATIONS_PAR_IP_PAR_HEURE; i++) {
        expect((await verifier(api, emailNeuf(), '000000', { ip })).status, `vérification ${String(i + 1)}`).toBe(401);
      }
      await trop(await verifier(api, email, code, { ip }));
      const { rows } = await base.pool.query<{ tentatives: number; utilise_le: Date | null }>(
        `SELECT tentatives, utilise_le FROM code_connexion WHERE email = $1`,
        [email],
      );
      expect(rows).toEqual([{ tentatives: 0, utilise_le: null }]);

      // Depuis une autre adresse, le même code passe.
      expect((await verifier(api, email, code, { ip: ipNeuve() })).status).toBe(200);
    });

    it('les vérifications réussies comptent aussi', async () => {
      const api = creer();
      const ip = ipNeuve();
      const emails: string[] = [];
      for (let i = 0; i < 3; i++) {
        const email = emailNeuf();
        emails.push(email);
        await demanderCode(api, email, { ip: ipNeuve() });
      }
      for (let i = 0; i < VERIFICATIONS_PAR_IP_PAR_HEURE - 2; i++) {
        await verifier(api, emailNeuf(), '000000', { ip });
      }
      const [e1 = '', e2 = '', e3 = ''] = emails;
      expect((await verifier(api, e1, api.expediteur.dernierCode(e1), { ip })).status).toBe(200);
      expect((await verifier(api, e2, api.expediteur.dernierCode(e2), { ip })).status).toBe(200);
      await trop(await verifier(api, e3, api.expediteur.dernierCode(e3), { ip }));
    });

    it('sans proxy de confiance, X-Forwarded-For est ignoré : l’adresse de la socket compte', async () => {
      const api = creer({ proxyDeConfiance: false });
      const socket = ipNeuve();
      await epuiserCodes(api, () => ({ ip: socket, entetes: { 'x-forwarded-for': ipNeuve(), 'x-real-ip': ipNeuve() } }));
      await trop(await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': ipNeuve() } }));
    });

    it('par défaut (proxyDeConfiance absent), X-Forwarded-For est ignoré aussi', async () => {
      const api = creer();
      const socket = ipNeuve();
      await epuiserCodes(api, () => ({ ip: socket, entetes: { 'x-forwarded-for': ipNeuve() } }));
      await trop(await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': ipNeuve() } }));
    });

    it('avec proxy de confiance : la DERNIÈRE valeur de X-Forwarded-For compte, les précédentes (falsifiables) non', async () => {
      const api = creer({ proxyDeConfiance: true });
      const socket = ipNeuve(); // le proxy : la même pour tout le monde
      const client = ipNeuve();
      await epuiserCodes(api, () => ({ ip: socket, entetes: { 'x-forwarded-for': `${ipNeuve()}, ${client}` } }));
      // Le client change la valeur qu'il envoie lui-même : rien n'y fait.
      await trop(await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': `${ipNeuve()},${client}` } }));
      await trop(await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': ` ${client} ` } }));
      // Un autre client derrière le même proxy passe, même s'il prétend être le premier.
      expect((await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': `${client}, ${ipNeuve()}` } })).status).toBe(202);
    });

    it('avec proxy de confiance mais sans en-tête : adresse de la socket', async () => {
      const api = creer({ proxyDeConfiance: true });
      const socket = ipNeuve();
      await epuiserCodes(api, () => ({ ip: socket }));
      await trop(await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': '' } }));
      expect((await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': ipNeuve() } })).status).toBe(202);
    });

    it('relue en base : partagée entre deux processus d’API', async () => {
      const a = creer();
      const b = creer({ expediteur: a.expediteur });
      const ip = ipNeuve();
      for (let i = 0; i < CODES_PAR_IP_PAR_HEURE; i++) {
        expect((await demanderCode(i % 2 === 0 ? a : b, emailNeuf(), { ip })).status).toBe(202);
      }
      await trop(await demanderCode(a, emailNeuf(), { ip }));
      await trop(await demanderCode(b, emailNeuf(), { ip }));
    });

    it('fenêtre glissante : les demandes sortent de la fenêtre une à une', async () => {
      const api = creer();
      const ip = ipNeuve();
      await epuiserCodes(api, () => {
        avancer(MINUTE);
        return { ip };
      });
      // Première demande à DEBUT + 1 min : libre à DEBUT + 61 min.
      instant = new Date(DEBUT.getTime() + 61 * MINUTE - SECONDE);
      await trop(await demanderCode(api, emailNeuf(), { ip }));
      instant = new Date(DEBUT.getTime() + 61 * MINUTE + SECONDE);
      expect((await demanderCode(api, emailNeuf(), { ip })).status).toBe(202);
      await trop(await demanderCode(api, emailNeuf(), { ip }));
    });

    it('vrai serveur HTTP (@hono/node-server) : l’adresse de la socket est lue, X-Forwarded-For ignoré', async () => {
      const api = creer();
      // Instant à part : 127.0.0.1 n'est utilisée que par ce test.
      instant = new Date(DEBUT.getTime() + 500 * JOUR);
      const serveur = serve({ fetch: api.app.fetch, port: 0, hostname: '127.0.0.1' });
      await new Promise<void>((pret) => {
        if (serveur.listening) pret();
        else serveur.once('listening', pret);
      });
      const { port } = serveur.address() as AddressInfo;
      try {
        const demander = (xff: string) =>
          fetch(`http://127.0.0.1:${String(port)}/auth/code`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
            body: JSON.stringify({ email: emailNeuf() }),
          });
        for (let i = 0; i < CODES_PAR_IP_PAR_HEURE; i++) {
          const res = await demander(ipNeuve());
          expect(res.status, `demande ${String(i + 1)}`).toBe(202);
        }
        await trop(await demander(ipNeuve()));
      } finally {
        await new Promise<void>((fin) => {
          serveur.close(() => {
            fin();
          });
        });
      }
    });

    it('sans adresse connue (app.request sans socket) : pas de limite par IP, pas d’erreur', async () => {
      const api = creer();
      for (let i = 0; i < CODES_PAR_IP_PAR_HEURE + 1; i++) {
        expect((await demanderCode(api, emailNeuf())).status, `demande ${String(i + 1)}`).toBe(202);
      }
    });
  });

  // --- 4. Garde : utilisateur supprimé ----------------------------------------------------------

  describe('garde : utilisateur supprimé ou inconnu', () => {
    it('supprime_le non nul : 401 non_authentifie sur toute route protégée, même avec un jeton d’accès valable, et rien n’est écrit', async () => {
      const api = creer();
      const gerant = await connecter(api);
      const fermeRes = await requete(api, 'POST', '/fermes', { id: randomUUID(), nom: 'Jardins de Garonne' }, { jeton: gerant.jetonAcces });
      expect(fermeRes.status).toBe(201);
      const ferme = await lire<{ id: string }>(fermeRes);
      expect((await requete(api, 'GET', '/moi', undefined, { jeton: gerant.jetonAcces })).status).toBe(200);

      await base.pool.query(`UPDATE utilisateur SET supprime_le = $2 WHERE id = $1`, [gerant.utilisateurId, instant]);
      avancer(MINUTE); // le jeton d'accès vaut encore 59 minutes

      const nouvelleFerme = randomUUID();
      const cible = emailNeuf();
      for (const [methode, chemin, corps] of [
        ['GET', '/moi', undefined],
        ['POST', '/fermes', { id: nouvelleFerme, nom: 'Autre ferme' }],
        ['GET', `/fermes/${ferme.id}`, undefined],
        ['PATCH', `/fermes/${ferme.id}`, { nom: 'Renommée' }],
        ['POST', `/fermes/${ferme.id}/membres`, { email: cible }],
        ['POST', '/sync/upload', { ecritures: [] }],
      ] as const) {
        const res = await requete(api, methode, chemin, corps, { jeton: gerant.jetonAcces });
        expect(res.status, `${methode} ${chemin}`).toBe(401);
        expect(await res.json()).toEqual({ erreur: 'non_authentifie' });
      }
      expect((await base.pool.query(`SELECT 1 FROM ferme WHERE id = $1`, [nouvelleFerme])).rowCount).toBe(0);
      expect((await base.pool.query(`SELECT nom FROM ferme WHERE id = $1`, [ferme.id])).rows).toEqual([{ nom: 'Jardins de Garonne' }]);
      expect(api.expediteur.pour(cible)).toHaveLength(0);
    });

    it('jeton d’accès bien signé dont le sub n’existe pas : 401', async () => {
      const api = creer();
      const iat = Math.floor(instant.getTime() / 1000);
      const jeton = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: cle.kid })
        .setSubject(randomUUID())
        .setIssuer(EMETTEUR)
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + 600)
        .sign(cle.privee);
      const res = await requete(api, 'GET', '/moi', undefined, { jeton });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ erreur: 'non_authentifie' });
    });
  });
});

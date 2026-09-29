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
 *       famille). Le jeton présenté devient « utilisé » (premier usage noté).
 *
 *   Règle « successeur jamais utilisé » (relecture sécurité, REMPLACE le délai de grâce fixe de
 *   2 minutes) : un jeton déjà utilisé T reste acceptable jusqu'à REJEU_MAX = 7 jours après son
 *   premier usage TANT QU'AUCUN DE SES SUCCESSEURS (jetons émis en le présentant) N'A SERVI.
 *   Présenté dans ce cas (réponse perdue au champ), il rend 200 et un jeton neuf, et ses
 *   successeurs inutilisés sont remplacés : ils ne valent plus rien (401), sans que la famille
 *   soit révoquée pour autant (les présenter ne coupe pas la session de celui qui a le dernier).
 *     - dès qu'un successeur de T a servi, présenter T est un rejeu (vol, copie) : 401
 *       { erreur: 'jeton_invalide' } et TOUTE la famille est révoquée, le dernier jeton rendu
 *       aussi ; les autres sessions du compte ne sont pas touchées ;
 *     - au-delà de 7 jours après son premier usage, présenter T est un rejeu : même chose
 *       (401, famille révoquée), successeur utilisé ou non ;
 *     - renouvellements simultanés avec le même jeton : tous répondent 200 ; au moins un des
 *       jetons rendus renouvelle ensuite, et présenter un jeton remplacé ne révoque pas la
 *       famille ;
 *     - famille révoquée (rejeu, déconnexion) : aucun de ses jetons n'est plus accepté, Y COMPRIS
 *       un jeton émis par un renouvellement lancé en même temps que le rejeu (course : la
 *       vérification et l'émission se font sous un verrou de famille, ou équivalent). Un jeton
 *       révoqué est refusé (401). Le remplacement d'un successeur inutilisé n'est pas une
 *       révocation de la famille.
 *   Purge : à chaque renouvellement, les lignes de jeton_renouvellement expirées (expire_le) ou
 *   révoquées (revoque_le) depuis plus de 90 jours sont effacées (tous comptes confondus) ; les
 *   plus récentes restent.
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
 *       → pas de limite par IP, et surtout pas d'exception ;
 *     - relecture sécurité : derrière le proxy de confiance, une dernière valeur de
 *       X-Forwarded-For qui n'est pas une adresse IP valide (« inconnu », « 999.0.0.1 »,
 *       « 2001:db8::zz »…) est IGNORÉE : c'est l'adresse de la socket qui compte (jamais la
 *       valeur précédente de l'en-tête, falsifiable) ;
 *     - IPv6 : toutes les adresses d'un même préfixe /64 comptent ensemble (un client en a des
 *       milliards), quelle que soit leur écriture (majuscules, zéros, forme compressée).
 *       ::ffff:a.b.c.d compte comme a.b.c.d. Même règle pour la valeur de X-Forwarded-For.
 *   Conservation : les demandes de plus de 24 heures sont effacées à chaque demande, qu'elle
 *   soit enregistrée ou refusée (429).
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
 *
 * ── 5. Adresses e-mail (relecture sécurité) ────────────────────────────────────────────────
 *
 *   Une adresse qui contient l'un de  , ; : < > ( ) [ ] " \  ou un caractère de contrôle
 *   (\p{Cc} : U+0000–U+001F, U+007F–U+009F), où que ce soit, est refusée avant tout envoi, toute
 *   écriture et toute tentative comptée :
 *     POST /auth/code             400 { erreur: 'email_invalide' }  (le corps de T09 pour une
 *                                 adresse invalide, inchangé)
 *     POST /auth/verifier         400 { erreur: 'requete_invalide' }
 *     POST /fermes/:id/membres    400 { erreur: 'email_invalide' }  (idem T09)
 *   Ces caractères séparent ou décorent des adresses pour un analyseur d'en-têtes (« a@x.fr,
 *   pirate@y.fr », « Nom <pirate@y.fr> ») : une seule adresse doit partir, celle saisie.
 *   Les adresses ordinaires restent acceptées (apostrophe, +, tiret, point, sous-domaines).
 *   L'expéditeur SMTP, lui, passe l'adresse sans l'analyser (courriel-smtp.test.ts).
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

/** Règle « successeur jamais utilisé » : un jeton utilisé reste acceptable 7 jours au plus. */
const REJEU_MAX_MS = 7 * JOUR;
const PURGE_JETONS_MS = 90 * JOUR;
const CONSERVATION_IP_MS = 24 * HEURE;
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
/** Préfixe IPv6 /64 de documentation neuf (2001:db8::/32), quatre groupes : « 2001:db8:x:y ». */
function prefixe64Neuf(): string {
  const g = new Uint16Array(2);
  crypto.getRandomValues(g);
  return `2001:db8:${(g[0] ?? 0).toString(16)}:${(g[1] ?? 0).toString(16)}`;
}

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
    const famille = o.ip?.includes(':') === true ? 'IPv6' : 'IPv4';
    const env = o.ip === undefined ? undefined : { incoming: { socket: { remoteAddress: o.ip, remotePort: 50_000, remoteFamily: famille } } };
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

    it('révoque toute la famille : un ancien jeton encore acceptable (successeur jamais utilisé) ne rouvre pas la session', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      avancer(10 * SECONDE);
      expect((await deconnecter(api, t1)).status).toBe(204);
      await refuse(await renouveler(api, t0));
      await refuse(await renouveler(api, t1));
    });

    it('présenter l’ancien jeton (encore acceptable) déconnecte aussi le successeur', async () => {
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

    it('réponse perdue (T1 jamais utilisé) : T0 rejoué 3 minutes puis 3 jours après → 200, et ce qu’il rend est valable', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0); // réponse perdue : le téléphone garde t0
      avancer(3 * MINUTE);
      const { jetonRenouvellement: t1bis } = await renouvele(api, t0); // perdue encore
      avancer(3 * JOUR);
      const { jetonRenouvellement: t1ter } = await renouvele(api, t0);
      expect(new Set([t0, t1, t1bis, t1ter]).size).toBe(4);

      // Les successeurs remplacés ne valent plus rien, mais les présenter ne coupe pas la session.
      await refuse(await renouveler(api, t1));
      await refuse(await renouveler(api, t1bis));
      avancer(HEURE);
      const { jetonRenouvellement: t2 } = await renouvele(api, t1ter);
      expect((await renouveler(api, t2)).status).toBe(200);
    });

    it('réponse perdue : T0 encore accepté 7 jours − 1 s après son premier usage', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      await renouvele(api, t0);
      avancer(REJEU_MAX_MS - SECONDE);
      const { jetonRenouvellement: t1bis } = await renouvele(api, t0);
      expect((await renouveler(api, t1bis)).status).toBe(200);
    });

    it('au-delà de 7 jours (7 j + 1 s) : rejeu, 401, et toute la famille est révoquée, successeur inutilisé compris', async () => {
      const api = creer();
      const email = emailNeuf();
      const { jetonRenouvellement: t0 } = await connecter(api, email);
      avancer(61 * SECONDE);
      const autreSession = await connecter(api, email);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      avancer(REJEU_MAX_MS + SECONDE);
      await refuse(await renouveler(api, t0));
      await refuse(await renouveler(api, t1));
      expect((await renouveler(api, autreSession.jetonRenouvellement)).status).toBe(200);
    });

    // Remplace « rejeu après le délai de grâce » (2 min) : c'est l'usage du successeur qui trahit
    // le rejeu, plus le temps écoulé.
    it('vol : T1 a servi, puis T0 est rejoué (10 s plus tard) → 401, et toute la famille est révoquée', async () => {
      const api = creer();
      const email = emailNeuf();
      const { jetonRenouvellement: t0 } = await connecter(api, email);
      avancer(61 * SECONDE);
      const autreSession = await connecter(api, email);

      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      avancer(5 * SECONDE);
      const { jetonRenouvellement: t2 } = await renouvele(api, t1);
      avancer(5 * SECONDE);

      await refuse(await renouveler(api, t0));
      // Le voleur ou le téléphone légitime : on ne sait pas lequel, toute la famille tombe.
      await refuse(await renouveler(api, t2));
      await refuse(await renouveler(api, t1));
      // L'autre session du même compte n'est pas touchée.
      expect((await renouveler(api, autreSession.jetonRenouvellement)).status).toBe(200);
    });

    it('vol plus ancien : T2 a servi (petit-fils de T0), T0 rejoué → 401 et famille révoquée', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const { jetonRenouvellement: t1 } = await renouvele(api, t0);
      const { jetonRenouvellement: t2 } = await renouvele(api, t1);
      const { jetonRenouvellement: t3 } = await renouvele(api, t2);
      await refuse(await renouveler(api, t0));
      await refuse(await renouveler(api, t3));
    });

    // Adapté : avec la règle « successeur jamais utilisé », un renouvellement simultané remplace le
    // successeur rendu à l'autre ; T09b attendait que chaque jeton rendu renouvelle.
    it('deux renouvellements simultanés avec le même jeton : les deux réussissent, la session continue', async () => {
      const api = creer();
      const { jetonRenouvellement: t0 } = await connecter(api);
      const reponses = await Promise.all([renouveler(api, t0), renouveler(api, t0)]);
      expect(reponses.map((r) => r.status)).toEqual([200, 200]);
      const rendus = await Promise.all(reponses.map((r) => lire<Renouvellement>(r)));
      for (const r of rendus) expect(r.jetonRenouvellement).not.toBe(t0);
      avancer(30 * SECONDE);
      const suivants: string[] = [];
      for (const r of rendus) {
        const res = await renouveler(api, r.jetonRenouvellement);
        if (res.status === 200) suivants.push((await lire<Renouvellement>(res)).jetonRenouvellement);
        else expect(res.status).toBe(401);
      }
      expect(suivants.length).toBeGreaterThanOrEqual(1);
      // Présenter le jeton remplacé n'a pas révoqué la famille.
      for (const j of suivants) expect((await renouveler(api, j)).status).toBe(200);
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

    /** Tous les jetons connus sont refusés (aucun n'est utilisable, ni n'en rend un autre). */
    async function toutRefuse(api: Api, jetons: readonly string[], essai: number): Promise<void> {
      for (const [i, jeton] of jetons.entries()) {
        const res = await renouveler(api, jeton);
        expect(res.status, `essai ${String(essai + 1)}, jeton ${String(i)} encore utilisable`).toBe(401);
      }
    }

    it('course : rejeu hors délai (7 j + 1 s) et renouvellement du successeur lancés ensemble, 20 fois : aucun jeton de la famille ne reste utilisable', async () => {
      const api = creer();
      for (let essai = 0; essai < 20; essai++) {
        const { jetonRenouvellement: t0 } = await connecter(api);
        const { jetonRenouvellement: t1 } = await renouvele(api, t0);
        avancer(REJEU_MAX_MS + SECONDE);
        const [rejeu, suivant] = await Promise.all([renouveler(api, t0), renouveler(api, t1)]);
        expect(rejeu.status, `essai ${String(essai + 1)} : rejeu`).toBe(401);
        const connus = [t0, t1];
        if (suivant.status === 200) connus.push((await lire<Renouvellement>(suivant)).jetonRenouvellement);
        else expect(suivant.status).toBe(401);
        await toutRefuse(api, connus, essai);
      }
    });

    it('course : rejeu après usage du successeur et renouvellement du dernier jeton lancés ensemble, 20 fois : aucun jeton de la famille ne reste utilisable', async () => {
      const api = creer();
      for (let essai = 0; essai < 20; essai++) {
        const { jetonRenouvellement: t0 } = await connecter(api);
        const { jetonRenouvellement: t1 } = await renouvele(api, t0);
        const { jetonRenouvellement: t2 } = await renouvele(api, t1);
        avancer(3 * MINUTE);
        const [rejeu, suivant] = await Promise.all([renouveler(api, t0), renouveler(api, t2)]);
        expect(rejeu.status, `essai ${String(essai + 1)} : rejeu`).toBe(401);
        const connus = [t0, t1, t2];
        if (suivant.status === 200) connus.push((await lire<Renouvellement>(suivant)).jetonRenouvellement);
        else expect(suivant.status).toBe(401);
        await toutRefuse(api, connus, essai);
      }
    });

    it('purge à chaque renouvellement : jetons expirés ou révoqués depuis plus de 90 jours effacés, les plus récents gardés', async () => {
      const api = creer();
      const [vieuxExpire, vieuxRevoque, recentExpire, recentRevoque] = [
        await connecter(api),
        await connecter(api),
        await connecter(api),
        await connecter(api),
      ];
      const ilYa = (ms: number) => new Date(instant.getTime() - ms);
      const maj = (colonne: 'expire_le' | 'revoque_le', c: Connexion, quand: Date) =>
        base.pool.query(`UPDATE jeton_renouvellement SET ${colonne} = $2 WHERE utilisateur_id = $1`, [c.utilisateurId, quand]);
      await maj('expire_le', vieuxExpire, ilYa(PURGE_JETONS_MS + JOUR));
      await maj('revoque_le', vieuxRevoque, ilYa(PURGE_JETONS_MS + JOUR));
      await maj('expire_le', recentExpire, ilYa(PURGE_JETONS_MS - JOUR));
      await maj('revoque_le', recentRevoque, ilYa(PURGE_JETONS_MS - JOUR));

      const actif = await connecter(api);
      await renouvele(api, actif.jetonRenouvellement);

      const nombre = async (c: Connexion) =>
        (
          await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM jeton_renouvellement WHERE utilisateur_id = $1`, [
            c.utilisateurId,
          ])
        ).rows[0]?.n;
      expect(await nombre(vieuxExpire), 'expiré depuis 91 jours').toBe(0);
      expect(await nombre(vieuxRevoque), 'révoqué depuis 91 jours').toBe(0);
      expect(await nombre(recentExpire), 'expiré depuis 89 jours').toBe(1);
      expect(await nombre(recentRevoque), 'révoqué depuis 89 jours').toBe(1);
      expect(await nombre(actif)).toBe(2);
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

    it('proxy de confiance : une valeur de X-Forwarded-For qui n’est pas une IP est ignorée, l’adresse de la socket compte', async () => {
      const api = creer({ proxyDeConfiance: true });
      const socket = ipNeuve();
      const invalides = (i: number): string =>
        [
          `inconnu-${String(i)}`,
          `999.0.0.${String(i)}`,
          `198.18.0.${String(i)}.7`,
          `2001:db8::zz${String(i)}`,
          `${ipNeuve()}, pas-une-ip-${String(i)}`,
          `unknown${String(i)}`,
        ][i % 6] ?? '';
      await epuiserCodes(api, (i) => ({ ip: socket, entetes: { 'x-forwarded-for': invalides(i) } }));
      await trop(await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': 'encore-autre-chose' } }));
      await trop(await demanderCode(api, emailNeuf(), { ip: socket }));
      // Une vraie adresse derrière le même proxy : un autre client, qui passe.
      expect((await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': ipNeuve() } })).status).toBe(202);
    });

    it('IPv6 : les adresses d’un même /64 comptent ensemble, quelle que soit leur écriture', async () => {
      const api = creer();
      const p = prefixe64Neuf();
      await epuiserCodes(api, (i) => ({ ip: `${p}:${(i + 1).toString(16)}:0:0:${(i * 7 + 3).toString(16)}` }));
      await trop(await demanderCode(api, emailNeuf(), { ip: `${p}::1` }));
      await trop(await demanderCode(api, emailNeuf(), { ip: `${p.toUpperCase()}:FFFF:FFFF:FFFF:FFFF` }));
      const [a = '', b = '', c = '', d = ''] = p.split(':');
      const developpe = [a, b, c, d].map((g) => g.padStart(4, '0')).join(':');
      await trop(await demanderCode(api, emailNeuf(), { ip: `${developpe}:0000:0000:0000:0042` }));
      // Le /64 voisin et un autre préfixe : pas concernés.
      const voisin = `${a}:${b}:${c}:${((Number.parseInt(d, 16) + 1) % 0x10000).toString(16)}`;
      expect((await demanderCode(api, emailNeuf(), { ip: `${voisin}::1` })).status).toBe(202);
      expect((await demanderCode(api, emailNeuf(), { ip: `${prefixe64Neuf()}::1` })).status).toBe(202);
    });

    it('IPv6 derrière le proxy de confiance : même règle pour la valeur de X-Forwarded-For', async () => {
      const api = creer({ proxyDeConfiance: true });
      const socket = ipNeuve();
      const p = prefixe64Neuf();
      await epuiserCodes(api, (i) => ({ ip: socket, entetes: { 'x-forwarded-for': `${p}::${(i + 1).toString(16)}` } }));
      await trop(await demanderCode(api, emailNeuf(), { ip: socket, entetes: { 'x-forwarded-for': `${ipNeuve()}, ${p}:1:2:3:4` } }));
    });

    it('IPv4 vue par une socket IPv6 (::ffff:a.b.c.d) compte comme a.b.c.d', async () => {
      const api = creer();
      const ip = ipNeuve();
      await epuiserCodes(api, (i) => ({ ip: i % 2 === 0 ? ip : `::ffff:${ip}` }));
      await trop(await demanderCode(api, emailNeuf(), { ip }));
      await trop(await demanderCode(api, emailNeuf(), { ip: `::FFFF:${ip}` }));
    });

    it('conservation : une demande refusée (429) efface aussi les adresses de plus de 24 heures', async () => {
      const api = creer();
      const ancienne = ipNeuve();
      expect((await demanderCode(api, emailNeuf(), { ip: ancienne })).status).toBe(202);

      // 23 h 30 plus tard, une autre adresse atteint sa limite (ses 30 demandes n'effacent que
      // ce qui a plus de 24 h à cet instant : l'ancienne reste).
      avancer(23 * HEURE + 30 * MINUTE);
      const ip = ipNeuve();
      await epuiserCodes(api, () => ({ ip }));
      const nombreAnciennes = async () =>
        (
          await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM securite.demande_ip WHERE cree_le < $1`, [
            new Date(instant.getTime() - CONSERVATION_IP_MS),
          ])
        ).rows[0]?.n;

      // 40 min plus tard : l'ancienne a plus de 24 h ; la seule demande reçue est refusée.
      avancer(40 * MINUTE);
      expect(await nombreAnciennes(), 'témoin : une adresse de plus de 24 h est en base').toBeGreaterThan(0);
      await trop(await demanderCode(api, emailNeuf(), { ip }));
      expect(await nombreAnciennes()).toBe(0);
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

  // --- 5. Adresses e-mail -----------------------------------------------------------------------

  describe('adresses e-mail : séparateurs et caractères de contrôle refusés', () => {
    const INTERDITS = [',', ';', ':', '<', '>', '(', ')', '[', ']', '"', '\\', '\u0000', '\u0007', '\u001b', '\u007f', '\u0085'];

    /** Adresses piégées : le caractère dans la partie locale, dans le domaine, et en forme d'attaque. */
    /** Formes normalisées, sans U+0000 (qu'un texte Postgres ne peut pas contenir) : pour relire la base. */
    function enBase(emails: readonly string[]): string[] {
      return emails.filter((e) => !e.includes('\u0000')).map((e) => e.trim().toLowerCase());
    }

    function piegees(): string[] {
      const jeton = randomUUID().slice(0, 8);
      return [
        ...INTERDITS.flatMap((c) => [`vic${c}time-${jeton}@ferme.fr`, `victime-${jeton}@fer${c}me.fr`]),
        `victime-${jeton}@ferme.fr,pirate@ailleurs.fr`,
        `victime-${jeton}@ferme.fr;pirate@ailleurs.fr`,
        `Pirate <pirate-${jeton}@ailleurs.fr>`,
        `"victime-${jeton}"@ferme.fr`,
        `victime-${jeton}@[127.0.0.1]`,
        `victime-${jeton}(commentaire)@ferme.fr`,
      ];
    }

    it('POST /auth/code : 400 email_invalide, rien d’envoyé ni d’écrit', async () => {
      const api = creer();
      const emails = piegees();
      for (const email of emails) {
        const res = await demanderCode(api, email);
        expect(res.status, JSON.stringify(email)).toBe(400);
        expect(await res.json()).toEqual({ erreur: 'email_invalide' });
      }
      expect(api.expediteur.messages).toHaveLength(0);
      const { rows } = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM code_connexion WHERE email = ANY($1)`, [
        enBase(emails),
      ]);
      expect(rows[0]?.n).toBe(0);
    });

    it('POST /auth/verifier : 400 requete_invalide, aucun compte créé', async () => {
      const api = creer();
      const emails = piegees();
      for (const email of emails) {
        const res = await verifier(api, email, '123456');
        expect(res.status, JSON.stringify(email)).toBe(400);
        expect(await res.json()).toEqual({ erreur: 'requete_invalide' });
      }
      const { rows } = await base.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM utilisateur WHERE email = ANY($1)`, [
        enBase(emails),
      ]);
      expect(rows[0]?.n).toBe(0);
    });

    it('POST /fermes/:id/membres : 400 email_invalide, rien d’envoyé ni d’écrit', async () => {
      const api = creer();
      const gerant = await connecter(api);
      const fermeRes = await requete(api, 'POST', '/fermes', { id: randomUUID(), nom: 'Ferme des Aulnes' }, { jeton: gerant.jetonAcces });
      expect(fermeRes.status).toBe(201);
      const ferme = await lire<{ id: string }>(fermeRes);
      const avant = api.expediteur.messages.length;
      for (const email of piegees()) {
        const res = await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email }, { jeton: gerant.jetonAcces });
        expect(res.status, JSON.stringify(email)).toBe(400);
        expect(await res.json()).toEqual({ erreur: 'email_invalide' });
      }
      expect(api.expediteur.messages).toHaveLength(avant);
      const { rows } = await base.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM membre WHERE ferme_id = $1 AND utilisateur_id <> $2`,
        [ferme.id, gerant.utilisateurId],
      );
      expect(rows[0]?.n).toBe(0);
    });

    it('les adresses ordinaires restent acceptées (apostrophe, +, tiret, points, sous-domaine)', async () => {
      const api = creer();
      const jeton = randomUUID().slice(0, 8);
      for (const email of [`o'neil+recolte-${jeton}@ferme.fr`, `prenom.nom-${jeton}@mail.sous-domaine.ferme.fr`, `  Theo-${jeton}@Ferme.FR  `]) {
        expect((await demanderCode(api, email)).status, email).toBe(202);
        const normalisee = email.trim().toLowerCase();
        expect((await verifier(api, email, api.expediteur.dernierCode(normalisee))).status, email).toBe(200);
      }
    });
  });
});

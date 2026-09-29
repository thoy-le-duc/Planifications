/**
 * Tests d'acceptation T09 — comptes, fermes et jetons, contre un vrai Postgres.
 *
 * ── Exécution ───────────────────────────────────────────────────────────────────────────────
 *
 * Comme les tests d'intégration de @planif/db : DATABASE_URL désigne un Postgres où l'on peut
 * créer des bases. Le test crée une base jetable `t09_api_…`, y applique les migrations, puis la
 * supprime. Sans DATABASE_URL : échec clair en CI, saut signalé en local.
 *
 * ── Méthode (Q9, validée le 2026-09-29) ──────────────────────────────────────────────────────
 *
 * Code à 6 chiffres reçu par e-mail, pas de mot de passe. La clé d'accès (WebAuthn) est
 * REPORTÉE à un ticket séparé : aucune route /auth/cle-acces/* dans T09.
 *
 * ── API attendue ────────────────────────────────────────────────────────────────────────────
 *
 * apps/api/src/app.ts
 *   creerApp(deps: DependancesApp): Hono      (garde aussi GET /sante)
 *   interface DependancesApp {
 *     readonly db: NodePgDatabase;             // drizzle(pool) de drizzle-orm/node-postgres
 *     readonly expediteur: ExpediteurCourriel; // envoi d'e-mail injecté : faux en test
 *     readonly cles: TrousseauCles;            // voir cles.test.ts
 *     readonly emetteur: string;               // claim iss (env JWT_EMETTEUR)
 *     readonly audience: string;               // claim aud (env JWT_AUDIENCE, celle de PowerSync)
 *     readonly maintenant?: () => Date;        // horloge ; par défaut () => new Date()
 *   }
 *   Toute comparaison de temps (expiration des codes, limite d'envoi, jetons) passe par
 *   `maintenant`, jamais par now() SQL ni Date.now() directement.
 *
 * apps/api/src/auth/index.ts (en plus de cles.test.ts)
 *   interface MessageCourriel { readonly a: string; readonly sujet: string; readonly texte: string }
 *   interface ExpediteurCourriel { envoyer(message: MessageCourriel): Promise<void> }
 *
 * Variables d'environnement lues par src/index.ts (pas par creerApp) : DATABASE_URL,
 * JWT_CLES_PRIVEES (JWKS privé, la première clé signe), JWT_EMETTEUR, JWT_AUDIENCE, PORT.
 *
 * Adresses : toujours normalisées (espaces retirés, minuscules) avant usage et stockage.
 *
 * Routes (corps JSON ; erreurs au format { erreur: string }) :
 *
 *   POST /auth/code        { email }
 *     202 { ok: true } — que le compte existe ou non (rien n'est révélé) ; un code à 6 chiffres
 *     est envoyé dans le texte du message. Le code est stocké haché (code_connexion), expire
 *     10 minutes après `maintenant`, 5 tentatives au plus.
 *     400 { erreur: 'email_invalide' }.
 *     429 { erreur: 'trop_de_demandes' } + en-tête Retry-After (secondes) : au plus un envoi par
 *     minute, cinq par heure et dix par 24 h glissantes pour une même adresse (même réponse pour
 *     toute adresse). Un nouveau code invalide le précédent.
 *
 *   POST /auth/verifier    { email, code }
 *     200 { utilisateurId, jetonAcces, jetonRenouvellement }. Crée le compte à la première
 *     connexion. Le code est alors consommé.
 *     401 { erreur: 'code_invalide' } : code faux, expiré, déjà utilisé, ou tentatives épuisées
 *     (même réponse dans tous les cas). Chaque échec compte une tentative.
 *     Force brute par adresse : les échecs sont comptés par adresse sur 24 h glissantes, tous
 *     codes confondus. À partir de 10 échecs dans les 24 h, même le bon code d'un code neuf reçoit
 *     cette même 401 (même statut, même corps), jusqu'à ce que les échecs sortent de la fenêtre.
 *     Pas de limite par IP dans T09 (reportée) ; T09b l'ajoute : durcissement.integration.test.ts.
 *
 *   POST /auth/renouveler  { jetonRenouvellement }
 *     200 { jetonAcces, jetonRenouvellement }. Ne demande PAS de jeton d'accès valide : c'est ce
 *     qui permet aux écritures faites hors ligne de partir au retour du réseau. Le jeton de
 *     renouvellement vit au moins 30 jours (session hors ligne) et moins de 400 jours. Il reste
 *     valable après usage (pas de rotation stricte : une réponse perdue sur un réseau faible ne
 *     doit pas déconnecter) ; la réponse peut en fournir un nouveau.
 *     T09b REMPLACE cette règle par une rotation avec délai de grâce de 2 minutes (contrat :
 *     durcissement.integration.test.ts) ; les tests ci-dessous qui réutilisaient le même jeton
 *     sont adaptés (commentaire « T09b » sur chacun).
 *     401 { erreur: 'jeton_invalide' }.
 *
 *   GET /.well-known/jwks.json   { keys: [...] } (jwksPublic du trousseau).
 *
 *   Routes protégées : en-tête Authorization: Bearer <jetonAcces>, sinon 401.
 *   Jeton d'accès : JWT RS256, en-tête kid = clé active ; claims sub (utilisateurId), iss, aud,
 *   iat, exp (et facultativement jti, nbf) — rien d'autre, et surtout pas la liste des fermes,
 *   qui est relue en base à chaque requête (fermesDeLUtilisateur de @planif/db). Durée de vie
 *   au plus 1 heure.
 *
 *   GET  /moi                     200 { id, email, fermes: [{ id, nom, role }] }
 *   POST /fermes  { id?, nom, fuseauHoraire? }
 *     201 { id, nom, fuseauHoraire, role: 'gerant' } ; le créateur devient gérant. id : UUID
 *     fourni par le client (UUID v7 en pratique), sinon généré. fuseauHoraire par défaut
 *     'Europe/Paris'. 400 { erreur: 'requete_invalide' } si nom vide, ou s'il contient un
 *     caractère de contrôle ou de format (/[\p{Cc}\p{Cf}]/u : \r, \n, \t, \u0000, U+202E…).
 *   GET   /fermes/:id             200 { id, nom, fuseauHoraire, role }
 *   PATCH /fermes/:id  { nom }    200 (même forme) ; gérant seulement, sinon 403 ; même règle
 *     de nom que POST /fermes (400 requete_invalide).
 *   POST  /fermes/:id/membres  { email }
 *     Invitation d'un équipier, gérant seulement (403 pour un équipier), et lui envoie un message
 *     qui nomme la ferme. 201 { email, role: 'equipier' } — SANS utilisateurId ni rien qui
 *     distingue un compte existant d'un compte neuf (même statut, même forme de corps) ; déjà
 *     membre : 200, même forme, rien de dupliqué. 400 { erreur: 'email_invalide' }.
 *     L'invité est d'abord « invité » : tant qu'il n'a pas réussi une vérification de code
 *     (POST /auth/verifier) APRÈS l'invitation, la ferme n'apparaît ni dans GET /moi, ni dans
 *     fermesDeLUtilisateur / roleDansLaFerme (@planif/db), et /fermes/:id lui répond 404. Sa
 *     prochaine connexion réussie vaut acceptation (pas d'écran d'acceptation dans T09) : la
 *     ferme apparaît alors avec le rôle prévu. Un compte déjà connecté ne la voit donc qu'après
 *     s'être reconnecté ; un membre retiré puis réinvité aussi.
 *     Limite : 20 invitations par gérant et par heure glissante, toutes fermes confondues ; la
 *     21e reçoit 429 { erreur: 'trop_de_demandes' } + Retry-After, sans rien créer ni envoyer.
 *   Isolement : pour une ferme dont l'utilisateur n'est pas membre actif — ou qui n'existe pas,
 *   ou dont l'id n'est pas un UUID — toutes les routes /fermes/:id… répondent 404 { erreur:
 *   'ferme_introuvable' } et n'écrivent rien. Un utilisateur supprimé (utilisateur.supprime_le
 *   non nul) n'est membre actif de rien : 404 partout, même avec un jeton d'accès encore valable.
 *   T09b : la garde relit l'utilisateur, un utilisateur supprimé reçoit désormais 401
 *   non_authentifie avant même la ferme (test adapté plus bas).
 *
 * Jeton de renouvellement : révoqué (revoque_le non nul) → 401 ; glissant sur 90 jours mais
 * plafonné à 365 jours après la connexion, même renouvelé régulièrement.
 */
import { randomUUID } from 'node:crypto';
import { fermesDeLUtilisateur, appliquerMigrations, roleDansLaFerme } from '@planif/db';
import type { Id } from '@planif/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  SignJWT,
  UnsecuredJWT,
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  generateKeyPair,
  jwtVerify,
  type CryptoKey,
  type JSONWebKeySet,
} from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { creerApp } from '../app.ts';
import {
  genererCleSignature,
  type CleSignature,
  type ExpediteurCourriel,
  type MessageCourriel,
  type TrousseauCles,
} from './index.ts';

const URL_BASE = process.env.DATABASE_URL ?? '';
const EN_CI = (process.env.CI ?? '') !== '' && process.env.CI !== 'false';

if (URL_BASE === '') {
  if (EN_CI) {
    describe('T09 : API et base PostgreSQL', () => {
      it('DATABASE_URL est définie en CI', () => {
        throw new Error('DATABASE_URL absente en CI : les tests d’intégration de T09 exigent le service Postgres.');
      });
    });
  } else {
    console.warn('[T09] DATABASE_URL absente : tests d’intégration de l’API sautés.');
  }
}

const decrireAvecBase = URL_BASE === '' ? describe.skip : describe;

const EMETTEUR = 'https://api.planif.test';
const AUDIENCE = 'powersync-planif';
const DEBUT = new Date('2026-10-01T06:00:00Z');
const SECONDE = 1000;
const MINUTE = 60 * SECONDE;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

/** Claims autorisés dans le jeton d'accès : rien qui décrive les fermes. */
const CLAIMS_AUTORISES = ['sub', 'iss', 'aud', 'iat', 'exp', 'jti', 'nbf'];

interface Connexion {
  readonly utilisateurId: string;
  readonly jetonAcces: string;
  readonly jetonRenouvellement: string;
}

interface Renouvellement {
  readonly jetonAcces: string;
  readonly jetonRenouvellement: string;
}

interface FermeVue {
  readonly id: string;
  readonly nom: string;
  readonly fuseauHoraire: string;
  readonly role: string;
}

interface Moi {
  readonly id: string;
  readonly email: string;
  readonly fermes: readonly { readonly id: string; readonly nom: string; readonly role: string }[];
}

interface Invitation {
  readonly email: string;
  readonly role: string;
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

  /** Le code à 6 chiffres du dernier message envoyé à cette adresse. */
  dernierCode(email: string): string {
    const texte = this.pour(email).at(-1)?.texte ?? '';
    const code = /\b(\d{6})\b/.exec(texte)?.[1];
    if (code === undefined) throw new Error(`aucun code envoyé à ${email}`);
    return code;
  }
}

async function lire<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function codeFaux(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, '0');
}

function emailNeuf(): string {
  return `t09-${randomUUID()}@ferme.fr`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

decrireAvecBase('T09 : comptes, fermes et jetons (API)', { timeout: 30_000 }, () => {
  const nomBase = `t09_api_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let admin: pg.Client;
  let pool: pg.Pool;
  let cleA: CleSignature;
  let cleB: CleSignature;
  let instant = DEBUT;
  const maintenant = (): Date => instant;
  const avancer = (ms: number): void => {
    instant = new Date(instant.getTime() + ms);
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_BASE });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nomBase}`);
    const url = new URL(URL_BASE);
    url.pathname = `/${nomBase}`;
    await appliquerMigrations(url.toString());
    pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
    cleA = await genererCleSignature('cle-a');
    cleB = await genererCleSignature('cle-b');
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    // pool.end() rend la main avant la fermeture effective des sockets : sans cette attente,
    // DROP … WITH (FORCE) coupe une connexion en cours de fermeture (erreur 57P01 non gérée).
    for (let i = 0; i < 50; i++) {
      const { rows } = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1`,
        [nomBase],
      );
      if (rows[0]?.n === 0) break;
      await new Promise((fin) => setTimeout(fin, 100));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${nomBase} WITH (FORCE)`);
    await admin.end();
  });

  beforeEach(() => {
    instant = DEBUT;
  });

  function creer(cles?: TrousseauCles) {
    const expediteur = new FauxExpediteur();
    const app = creerApp({
      db: drizzle(pool),
      expediteur,
      cles: cles ?? { active: cleA, precedentes: [] },
      emetteur: EMETTEUR,
      audience: AUDIENCE,
      maintenant,
    });
    return { app, expediteur };
  }
  type Api = ReturnType<typeof creer>;

  function requete(api: Api, methode: string, chemin: string, corps?: unknown, jeton?: string): Promise<Response> {
    const entetes: Record<string, string> = {};
    if (corps !== undefined) entetes['content-type'] = 'application/json';
    if (jeton !== undefined) entetes.authorization = `Bearer ${jeton}`;
    return Promise.resolve(
      api.app.request(chemin, {
        method: methode,
        headers: entetes,
        ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
      }),
    );
  }

  async function demanderCode(api: Api, email: string): Promise<Response> {
    return requete(api, 'POST', '/auth/code', { email });
  }

  async function verifier(api: Api, email: string, code: string): Promise<Response> {
    return requete(api, 'POST', '/auth/verifier', { email, code });
  }

  async function connecter(api: Api, email: string): Promise<Connexion> {
    expect((await demanderCode(api, email)).status).toBe(202);
    const res = await verifier(api, email, api.expediteur.dernierCode(email.trim().toLowerCase()));
    expect(res.status).toBe(200);
    return lire<Connexion>(res);
  }

  async function renouveler(api: Api, jetonRenouvellement: string): Promise<Response> {
    return requete(api, 'POST', '/auth/renouveler', { jetonRenouvellement });
  }

  async function jwks(api: Api): Promise<JSONWebKeySet> {
    const res = await requete(api, 'GET', '/.well-known/jwks.json');
    expect(res.status).toBe(200);
    return lire<JSONWebKeySet>(res);
  }

  async function creerFerme(api: Api, jeton: string, nom = 'Jardins de Garonne'): Promise<FermeVue> {
    const res = await requete(api, 'POST', '/fermes', { id: randomUUID(), nom, fuseauHoraire: 'Europe/Paris' }, jeton);
    expect(res.status).toBe(201);
    return lire<FermeVue>(res);
  }

  async function lignes(sql: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    const r = await pool.query<Record<string, unknown>>(sql, [...params]);
    return r.rows;
  }

  // --- POST /auth/code ------------------------------------------------------------------------

  describe('POST /auth/code', () => {
    it('envoie un code à 6 chiffres à l’adresse normalisée', async () => {
      const api = creer();
      const email = emailNeuf();
      const res = await demanderCode(api, `  ${email.toUpperCase()} `);
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });
      expect(api.expediteur.messages).toHaveLength(1);
      expect(api.expediteur.messages[0]?.a).toBe(email);
      expect(api.expediteur.dernierCode(email)).toMatch(/^\d{6}$/);
    });

    it('stocke le code haché, avec une expiration à 10 minutes', async () => {
      const api = creer();
      const email = emailNeuf();
      await demanderCode(api, email);
      const code = api.expediteur.dernierCode(email);
      const rangs = await lignes(`SELECT row_to_json(c)::text AS brut, expire_le FROM code_connexion c WHERE email = $1`, [
        email,
      ]);
      expect(rangs).toHaveLength(1);
      expect(String(rangs[0]?.brut)).not.toContain(code);
      expect((rangs[0]?.expire_le as Date).getTime()).toBe(DEBUT.getTime() + 10 * MINUTE);
    });

    it('répond pareil qu’un compte existe ou non, et envoie un code dans les deux cas', async () => {
      const api = creer();
      const connu = emailNeuf();
      await connecter(api, connu);
      avancer(2 * MINUTE);
      const inconnu = emailNeuf();

      const resConnu = await demanderCode(api, connu);
      const resInconnu = await demanderCode(api, inconnu);
      expect(resConnu.status).toBe(resInconnu.status);
      expect(await resConnu.text()).toBe(await resInconnu.text());
      expect(api.expediteur.pour(connu)).toHaveLength(2);
      expect(api.expediteur.pour(inconnu)).toHaveLength(1);
    });

    it('refuse une adresse invalide, sans rien envoyer', async () => {
      const api = creer();
      for (const corps of [{ email: '' }, { email: 'pas-une-adresse' }, { email: 42 }, {}]) {
        const res = await requete(api, 'POST', '/auth/code', corps);
        expect(res.status, JSON.stringify(corps)).toBe(400);
        expect(await res.json()).toEqual({ erreur: 'email_invalide' });
      }
      expect(api.expediteur.messages).toHaveLength(0);
    });

    it('limite la fréquence : un envoi par minute', async () => {
      const api = creer();
      const email = emailNeuf();
      expect((await demanderCode(api, email)).status).toBe(202);
      avancer(30 * SECONDE);
      const trop = await demanderCode(api, email);
      expect(trop.status).toBe(429);
      expect(await trop.json()).toEqual({ erreur: 'trop_de_demandes' });
      expect(Number(trop.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(api.expediteur.pour(email)).toHaveLength(1);

      avancer(31 * SECONDE);
      expect((await demanderCode(api, email)).status).toBe(202);
      expect(api.expediteur.pour(email)).toHaveLength(2);
    });

    it('limite la fréquence : cinq envois par heure', async () => {
      const api = creer();
      const email = emailNeuf();
      for (let i = 0; i < 5; i++) {
        expect((await demanderCode(api, email)).status, `envoi ${String(i + 1)}`).toBe(202);
        avancer(61 * SECONDE);
      }
      expect((await demanderCode(api, email)).status).toBe(429);
      expect(api.expediteur.pour(email)).toHaveLength(5);
      // Une heure après le premier envoi, la fenêtre libère une place.
      instant = new Date(DEBUT.getTime() + HEURE + SECONDE);
      expect((await demanderCode(api, email)).status).toBe(202);
    });

    it('les codes sont tirés au hasard', async () => {
      const api = creer();
      const codes = new Set<string>();
      for (let i = 0; i < 12; i++) {
        const email = emailNeuf();
        await demanderCode(api, email);
        codes.add(api.expediteur.dernierCode(email));
      }
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  // --- POST /auth/verifier ---------------------------------------------------------------------

  describe('POST /auth/verifier', () => {
    it('échange le bon code contre les jetons et crée le compte à la première connexion', async () => {
      const api = creer();
      const email = emailNeuf();
      const connexion = await connecter(api, email);
      expect(connexion.utilisateurId).toMatch(UUID);
      expect(connexion.jetonAcces.split('.')).toHaveLength(3);
      expect(connexion.jetonRenouvellement.length).toBeGreaterThanOrEqual(32);

      const comptes = await lignes(`SELECT id::text AS id FROM utilisateur WHERE email = $1`, [email]);
      expect(comptes).toEqual([{ id: connexion.utilisateurId }]);

      const moi = await requete(api, 'GET', '/moi', undefined, connexion.jetonAcces);
      expect(moi.status).toBe(200);
      expect(await lire<Moi>(moi)).toEqual({ id: connexion.utilisateurId, email, fermes: [] });
    });

    it('une seconde connexion retrouve le même compte, quelle que soit la casse', async () => {
      const api = creer();
      const email = emailNeuf();
      const premiere = await connecter(api, email);
      avancer(2 * MINUTE);
      const seconde = await connecter(api, email.toUpperCase());
      expect(seconde.utilisateurId).toBe(premiere.utilisateurId);
      expect(await lignes(`SELECT 1 FROM utilisateur WHERE email = $1`, [email])).toHaveLength(1);
    });

    it('refuse un code faux, puis accepte le bon', async () => {
      const api = creer();
      const email = emailNeuf();
      await demanderCode(api, email);
      const code = api.expediteur.dernierCode(email);
      const faux = await verifier(api, email, codeFaux(code));
      expect(faux.status).toBe(401);
      expect(await faux.json()).toEqual({ erreur: 'code_invalide' });
      expect((await verifier(api, email, code)).status).toBe(200);
    });

    it('après 5 tentatives fausses, même le bon code est refusé', async () => {
      const api = creer();
      const email = emailNeuf();
      await demanderCode(api, email);
      const code = api.expediteur.dernierCode(email);
      for (let i = 0; i < 5; i++) {
        expect((await verifier(api, email, codeFaux(code))).status).toBe(401);
      }
      const res = await verifier(api, email, code);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ erreur: 'code_invalide' });
    });

    it('le code vaut 10 minutes', async () => {
      const api = creer();
      const avant = emailNeuf();
      const apres = emailNeuf();
      await demanderCode(api, avant);
      await demanderCode(api, apres);

      avancer(10 * MINUTE - SECONDE);
      expect((await verifier(api, avant, api.expediteur.dernierCode(avant))).status).toBe(200);

      avancer(2 * SECONDE);
      const expire = await verifier(api, apres, api.expediteur.dernierCode(apres));
      expect(expire.status).toBe(401);
      expect(await expire.json()).toEqual({ erreur: 'code_invalide' });
    });

    it('un code ne sert qu’une fois', async () => {
      const api = creer();
      const email = emailNeuf();
      await demanderCode(api, email);
      const code = api.expediteur.dernierCode(email);
      expect((await verifier(api, email, code)).status).toBe(200);
      expect((await verifier(api, email, code)).status).toBe(401);
    });

    it('le code d’une autre adresse est refusé ; une adresse sans code aussi', async () => {
      const api = creer();
      const theo = emailNeuf();
      await demanderCode(api, theo);
      const code = api.expediteur.dernierCode(theo);
      expect((await verifier(api, emailNeuf(), code)).status).toBe(401);
      // Le code de Théophane reste bon : l'échec ci-dessus ne l'a pas touché.
      expect((await verifier(api, theo, code)).status).toBe(200);
    });
  });

  // --- Jetons -----------------------------------------------------------------------------------

  describe('jetons', () => {
    it('jeton d’accès : RS256, kid de la clé active, sub = utilisateur, court, sans liste de fermes', async () => {
      const api = creer();
      const email = emailNeuf();
      const { utilisateurId, jetonAcces: premier } = await connecter(api, email);
      const ferme = await creerFerme(api, premier);
      // Nouveau jeton, émis alors que l'utilisateur est gérant d'une ferme.
      avancer(2 * MINUTE);
      const { jetonAcces: apresFerme } = await connecter(api, email);

      expect(decodeProtectedHeader(apresFerme)).toMatchObject({ alg: 'RS256', kid: 'cle-a' });
      const { payload } = await jwtVerify(apresFerme, createLocalJWKSet(await jwks(api)), {
        issuer: EMETTEUR,
        audience: AUDIENCE,
        currentDate: instant,
      });
      expect(payload.sub).toBe(utilisateurId);
      for (const claim of Object.keys(payload)) {
        expect(CLAIMS_AUTORISES, `claim inattendu : ${claim}`).toContain(claim);
      }
      expect(JSON.stringify(payload)).not.toContain(ferme.id);
      const duree = (payload.exp ?? 0) - (payload.iat ?? 0);
      expect(duree).toBeGreaterThan(0);
      expect(duree).toBeLessThanOrEqual(3600);
      expect(payload.iat).toBe(Math.floor(instant.getTime() / 1000));
    });

    it('jeton d’accès expiré : 401, puis le renouvellement redonne l’accès (écritures hors ligne)', async () => {
      const api = creer();
      const { jetonAcces, jetonRenouvellement } = await connecter(api, emailNeuf());
      expect((await requete(api, 'GET', '/moi', undefined, jetonAcces)).status).toBe(200);

      const { exp } = decodeJwt(jetonAcces);
      instant = new Date((exp ?? 0) * 1000 + MINUTE);
      expect((await requete(api, 'GET', '/moi', undefined, jetonAcces)).status).toBe(401);

      const res = await renouveler(api, jetonRenouvellement);
      expect(res.status).toBe(200);
      const neuf = await lire<Renouvellement>(res);
      expect(typeof neuf.jetonRenouvellement).toBe('string');
      expect((await requete(api, 'GET', '/moi', undefined, neuf.jetonAcces)).status).toBe(200);
    });

    it('la session tient 30 jours hors ligne : renouvellement accepté après 30 jours sans réseau', async () => {
      const api = creer();
      const { utilisateurId, jetonRenouvellement } = await connecter(api, emailNeuf());
      avancer(30 * JOUR - MINUTE);
      const res = await renouveler(api, jetonRenouvellement);
      expect(res.status).toBe(200);
      const { jetonAcces } = await lire<Renouvellement>(res);
      expect(decodeJwt(jetonAcces).sub).toBe(utilisateurId);
      expect((await requete(api, 'GET', '/moi', undefined, jetonAcces)).status).toBe(200);
    });

    // T09b : rotation. L'ancien jeton ne reste valable que 2 minutes après usage (délai de grâce) ;
    // avant T09b ce test attendait encore une heure plus tard.
    it('le jeton de renouvellement reste valable juste après usage (réponse perdue sur réseau faible)', async () => {
      const api = creer();
      const { jetonRenouvellement } = await connecter(api, emailNeuf());
      expect((await renouveler(api, jetonRenouvellement)).status).toBe(200);
      avancer(MINUTE);
      expect((await renouveler(api, jetonRenouvellement)).status).toBe(200);
    });

    it('jeton de renouvellement stocké haché, inconnu ou trop vieux refusé', async () => {
      const api = creer();
      const { utilisateurId, jetonRenouvellement } = await connecter(api, emailNeuf());
      const rangs = await lignes(
        `SELECT row_to_json(j)::text AS brut FROM jeton_renouvellement j WHERE utilisateur_id = $1`,
        [utilisateurId],
      );
      expect(rangs.length).toBeGreaterThan(0);
      for (const r of rangs) expect(String(r.brut)).not.toContain(jetonRenouvellement);

      const inconnu = await renouveler(api, 'x'.repeat(43));
      expect(inconnu.status).toBe(401);
      expect(await inconnu.json()).toEqual({ erreur: 'jeton_invalide' });
      expect((await requete(api, 'POST', '/auth/renouveler', {})).status).toBe(401);

      avancer(400 * JOUR);
      expect((await renouveler(api, jetonRenouvellement)).status).toBe(401);
    });

    it('un jeton absent, falsifié, non signé ou d’une autre audience est refusé', async () => {
      const api = creer();
      const { utilisateurId } = await connecter(api, emailNeuf());
      const iat = Math.floor(instant.getTime() / 1000);
      const signe = (cle: CryptoKey, kid: string, audience = AUDIENCE) =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'RS256', kid })
          .setSubject(utilisateurId)
          .setIssuer(EMETTEUR)
          .setAudience(audience)
          .setIssuedAt(iat)
          .setExpirationTime(iat + 600)
          .sign(cle);
      const etrangere = await generateKeyPair('RS256');

      const refuses = [
        undefined,
        'n-importe-quoi',
        await signe(etrangere.privateKey, 'cle-a'),
        await signe(cleA.privee, 'cle-a', 'autre-audience'),
        new UnsecuredJWT({}).setSubject(utilisateurId).setIssuer(EMETTEUR).setAudience(AUDIENCE).setIssuedAt(iat).setExpirationTime(iat + 600).encode(),
      ];
      for (const jeton of refuses) {
        expect((await requete(api, 'GET', '/moi', undefined, jeton)).status, String(jeton)).toBe(401);
      }
      // Témoin : le même jeton, bien signé, passe.
      expect((await requete(api, 'GET', '/moi', undefined, await signe(cleA.privee, 'cle-a'))).status).toBe(200);
    });
  });

  // --- JWKS et rotation -------------------------------------------------------------------------

  describe('JWKS et rotation des clés', () => {
    it('GET /.well-known/jwks.json expose la clé publique, jamais la privée', async () => {
      const api = creer();
      const res = await requete(api, 'GET', '/.well-known/jwks.json');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      const { keys } = await lire<JSONWebKeySet>(res);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({ kid: 'cle-a', kty: 'RSA', alg: 'RS256', use: 'sig' });
      for (const m of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(keys[0]).not.toHaveProperty(m);
    });

    it('rotation : la nouvelle clé signe, l’ancienne vérifie pendant le recouvrement, puis plus', async () => {
      // Avant : seule la clé A.
      const avant = creer({ active: cleA, precedentes: [] });
      const emailA = emailNeuf();
      const sessionA = await connecter(avant, emailA);
      expect(decodeProtectedHeader(sessionA.jetonAcces).kid).toBe('cle-a');

      // Recouvrement : B signe, A vérifie encore.
      const pendant = creer({ active: cleB, precedentes: [cleA] });
      expect((await jwks(pendant)).keys.map((k) => k.kid)).toEqual(['cle-b', 'cle-a']);
      const sessionB = await connecter(pendant, emailNeuf());
      expect(decodeProtectedHeader(sessionB.jetonAcces).kid).toBe('cle-b');
      expect((await requete(pendant, 'GET', '/moi', undefined, sessionA.jetonAcces)).status).toBe(200);
      await expect(
        jwtVerify(sessionA.jetonAcces, createLocalJWKSet(await jwks(pendant)), {
          issuer: EMETTEUR,
          audience: AUDIENCE,
          currentDate: instant,
        }),
      ).resolves.toBeDefined();

      // Après : A retirée. Ses jetons d'accès sont refusés, mais la session ne tombe pas :
      // le jeton de renouvellement (opaque) redonne un jeton signé par B.
      const apres = creer({ active: cleB, precedentes: [] });
      expect((await jwks(apres)).keys.map((k) => k.kid)).toEqual(['cle-b']);
      expect((await requete(apres, 'GET', '/moi', undefined, sessionA.jetonAcces)).status).toBe(401);
      expect((await requete(apres, 'GET', '/moi', undefined, sessionB.jetonAcces)).status).toBe(200);
      const res = await renouveler(apres, sessionA.jetonRenouvellement);
      expect(res.status).toBe(200);
      const { jetonAcces } = await lire<Renouvellement>(res);
      expect(decodeProtectedHeader(jetonAcces).kid).toBe('cle-b');
      expect((await requete(apres, 'GET', '/moi', undefined, jetonAcces)).status).toBe(200);
    });
  });

  // --- Fermes ------------------------------------------------------------------------------------

  describe('création de ferme', () => {
    it('sans jeton : 401', async () => {
      const api = creer();
      expect((await requete(api, 'POST', '/fermes', { nom: 'Ferme' })).status).toBe(401);
    });

    it('le créateur devient gérant', async () => {
      const api = creer();
      const { utilisateurId, jetonAcces } = await connecter(api, emailNeuf());
      const id = randomUUID();
      const res = await requete(api, 'POST', '/fermes', { id, nom: 'Jardins de Garonne', fuseauHoraire: 'Europe/Paris' }, jetonAcces);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id, nom: 'Jardins de Garonne', fuseauHoraire: 'Europe/Paris', role: 'gerant' });

      expect(await lignes(`SELECT role FROM membre WHERE utilisateur_id = $1 AND ferme_id = $2`, [utilisateurId, id])).toEqual([
        { role: 'gerant' },
      ]);
      const moi = await lire<Moi>(await requete(api, 'GET', '/moi', undefined, jetonAcces));
      expect(moi.fermes).toEqual([{ id, nom: 'Jardins de Garonne', role: 'gerant' }]);
      const lue = await requete(api, 'GET', `/fermes/${id}`, undefined, jetonAcces);
      expect(lue.status).toBe(200);
      expect(await lue.json()).toEqual({ id, nom: 'Jardins de Garonne', fuseauHoraire: 'Europe/Paris', role: 'gerant' });
    });

    it('id généré et fuseau Europe/Paris par défaut ; nom vide refusé', async () => {
      const api = creer();
      const { jetonAcces } = await connecter(api, emailNeuf());
      const res = await requete(api, 'POST', '/fermes', { nom: 'Magasin' }, jetonAcces);
      expect(res.status).toBe(201);
      const ferme = await lire<FermeVue>(res);
      expect(ferme.id).toMatch(UUID);
      expect(ferme.fuseauHoraire).toBe('Europe/Paris');

      const vide = await requete(api, 'POST', '/fermes', { nom: '  ' }, jetonAcces);
      expect(vide.status).toBe(400);
      expect(await vide.json()).toEqual({ erreur: 'requete_invalide' });
    });
  });

  describe('invitation d’un équipier', () => {
    it('le gérant invite par e-mail ; l’équipier se connecte et voit la ferme', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces, 'Jardins de Garonne');
      const emailEquipier = emailNeuf();

      const res = await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email: emailEquipier.toUpperCase() }, gerant.jetonAcces);
      expect(res.status).toBe(201);
      const invitation = await lire<Invitation>(res);
      // Relecture sécurité : plus d'utilisateurId dans la réponse (il distinguait compte existant et neuf).
      expect(invitation).toEqual({ email: emailEquipier, role: 'equipier' });
      const messages = api.expediteur.pour(emailEquipier);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.texte).toContain('Jardins de Garonne');

      const equipier = await connecter(api, emailEquipier);
      expect(await lignes(`SELECT id::text AS id FROM utilisateur WHERE email = $1`, [emailEquipier])).toEqual([
        { id: equipier.utilisateurId },
      ]);
      const moi = await lire<Moi>(await requete(api, 'GET', '/moi', undefined, equipier.jetonAcces));
      expect(moi.fermes).toEqual([{ id: ferme.id, nom: 'Jardins de Garonne', role: 'equipier' }]);
      const lue = await requete(api, 'GET', `/fermes/${ferme.id}`, undefined, equipier.jetonAcces);
      expect(lue.status).toBe(200);
      expect((await lire<FermeVue>(lue)).role).toBe('equipier');
    });

    it('inviter deux fois ne duplique rien', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces);
      const email = emailNeuf();
      expect((await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email }, gerant.jetonAcces)).status).toBe(201);
      const encore = await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email }, gerant.jetonAcces);
      expect(encore.status).toBe(200);
      expect((await lire<Invitation>(encore)).role).toBe('equipier');
      expect(
        await lignes(
          `SELECT 1 FROM membre m JOIN utilisateur u ON u.id = m.utilisateur_id WHERE u.email = $1 AND m.ferme_id = $2`,
          [email, ferme.id],
        ),
      ).toHaveLength(1);
      expect(await lignes(`SELECT 1 FROM utilisateur WHERE email = $1`, [email])).toHaveLength(1);
    });

    it('réservée au gérant : un équipier reçoit 403, et rien n’est créé', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces);
      const emailEquipier = emailNeuf();
      await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email: emailEquipier }, gerant.jetonAcces);
      const equipier = await connecter(api, emailEquipier);

      const cible = emailNeuf();
      const res = await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email: cible }, equipier.jetonAcces);
      expect(res.status).toBe(403);
      expect(await lignes(`SELECT 1 FROM utilisateur WHERE email = $1`, [cible])).toHaveLength(0);
    });

    it('adresse invalide : 400', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces);
      const res = await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email: 'pas-une-adresse' }, gerant.jetonAcces);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ erreur: 'email_invalide' });
    });
  });

  // --- Isolement ----------------------------------------------------------------------------------

  describe('isolement entre fermes', () => {
    it('un non-membre ne lit pas la ferme d’un autre : 404, comme une ferme inexistante', async () => {
      const api = creer();
      const theo = await connecter(api, emailNeuf());
      const voisin = await connecter(api, emailNeuf());
      const jardins = await creerFerme(api, theo.jetonAcces, 'Jardins de Garonne');
      await creerFerme(api, voisin.jetonAcces, 'Ferme voisine');

      for (const chemin of [`/fermes/${jardins.id}`, `/fermes/${randomUUID()}`, '/fermes/pas-un-uuid']) {
        const res = await requete(api, 'GET', chemin, undefined, voisin.jetonAcces);
        expect(res.status, chemin).toBe(404);
        expect(await res.json()).toEqual({ erreur: 'ferme_introuvable' });
      }
      const moi = await lire<Moi>(await requete(api, 'GET', '/moi', undefined, voisin.jetonAcces));
      expect(moi.fermes.map((f) => f.nom)).toEqual(['Ferme voisine']);
    });

    it('un non-membre n’écrit pas dans la ferme d’un autre : ni renommage, ni invitation', async () => {
      const api = creer();
      const theo = await connecter(api, emailNeuf());
      const voisin = await connecter(api, emailNeuf());
      const jardins = await creerFerme(api, theo.jetonAcces, 'Jardins de Garonne');
      const fermeVoisine = await creerFerme(api, voisin.jetonAcces, 'Ferme voisine');

      const renommage = await requete(api, 'PATCH', `/fermes/${jardins.id}`, { nom: 'Piratée' }, voisin.jetonAcces);
      expect(renommage.status).toBe(404);
      const email = (await lire<Moi>(await requete(api, 'GET', '/moi', undefined, voisin.jetonAcces))).email;
      const intrusion = await requete(api, 'POST', `/fermes/${jardins.id}/membres`, { email }, voisin.jetonAcces);
      expect(intrusion.status).toBe(404);

      expect(await lignes(`SELECT nom FROM ferme WHERE id = $1`, [jardins.id])).toEqual([{ nom: 'Jardins de Garonne' }]);
      // Règle de synchro : le voisin ne reçoit toujours que sa ferme.
      expect(await fermesDeLUtilisateur(drizzle(pool), voisin.utilisateurId as Id<'Utilisateur'>)).toEqual([fermeVoisine.id]);
    });

    it('renommer : le gérant oui, l’équipier non (403)', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces, 'Jardins');
      const emailEquipier = emailNeuf();
      await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email: emailEquipier }, gerant.jetonAcces);
      const equipier = await connecter(api, emailEquipier);

      expect((await requete(api, 'PATCH', `/fermes/${ferme.id}`, { nom: 'Autre' }, equipier.jetonAcces)).status).toBe(403);
      const res = await requete(api, 'PATCH', `/fermes/${ferme.id}`, { nom: 'Jardins de Garonne' }, gerant.jetonAcces);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: ferme.id, nom: 'Jardins de Garonne', fuseauHoraire: 'Europe/Paris', role: 'gerant' });
    });

    it('les droits sont relus en base à chaque requête : un membre retiré perd l’accès, même avec un jeton valide', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces);
      const emailEquipier = emailNeuf();
      await requete(api, 'POST', `/fermes/${ferme.id}/membres`, { email: emailEquipier }, gerant.jetonAcces);
      const equipier = await connecter(api, emailEquipier);
      expect((await requete(api, 'GET', `/fermes/${ferme.id}`, undefined, equipier.jetonAcces)).status).toBe(200);

      await pool.query(`UPDATE membre SET supprime_le = now() WHERE utilisateur_id = $1 AND ferme_id = $2`, [
        equipier.utilisateurId,
        ferme.id,
      ]);
      expect((await requete(api, 'GET', `/fermes/${ferme.id}`, undefined, equipier.jetonAcces)).status).toBe(404);
    });
  });

  // --- Relecture sécurité de T09 -----------------------------------------------------------------

  /** Id du compte de cette adresse, s'il existe (l'invitation peut ou non créer le compte). */
  async function idsDuCompte(email: string): Promise<Id<'Utilisateur'>[]> {
    const rangs = await lignes(`SELECT id::text AS id FROM utilisateur WHERE email = $1`, [email]);
    return rangs.map((r) => String(r.id) as Id<'Utilisateur'>);
  }

  async function inviter(api: Api, fermeId: string, email: string, jeton: string): Promise<Response> {
    return requete(api, 'POST', `/fermes/${fermeId}/membres`, { email }, jeton);
  }

  /** `n` vérifications avec un code faux (celui du dernier code reçu, décalé de 1). */
  async function echouer(api: Api, email: string, n: number): Promise<void> {
    const code = api.expediteur.dernierCode(email);
    for (let i = 0; i < n; i++) {
      expect((await verifier(api, email, codeFaux(code))).status, `échec ${String(i + 1)}`).toBe(401);
    }
  }

  describe('relecture sécurité : force brute par adresse', () => {
    it('après 10 échecs en 24 h, même le bon code d’un code neuf reçoit la 401 habituelle, jusqu’à la fin de la fenêtre', async () => {
      const api = creer();
      const email = emailNeuf();

      // Échec « normal », pour comparer la réponse.
      expect((await demanderCode(api, email)).status).toBe(202);
      const normal = await verifier(api, email, codeFaux(api.expediteur.dernierCode(email)));
      expect(normal.status).toBe(401);
      const corpsNormal = await normal.text();
      const typeNormal = normal.headers.get('content-type');
      await echouer(api, email, 4); // 5 échecs sur le premier code

      avancer(61 * SECONDE);
      expect((await demanderCode(api, email)).status).toBe(202);
      await echouer(api, email, 5); // 10 échecs sur 24 h, deux codes confondus

      avancer(61 * SECONDE);
      expect((await demanderCode(api, email)).status).toBe(202);
      const bloque = await verifier(api, email, api.expediteur.dernierCode(email));
      expect(bloque.status).toBe(401);
      expect(await bloque.text()).toBe(corpsNormal);
      expect(bloque.headers.get('content-type')).toBe(typeNormal);
      expect(bloque.headers.get('retry-after')).toBeNull();

      // Toujours bloqué juste avant que les premiers échecs aient 24 h.
      instant = new Date(DEBUT.getTime() + JOUR - MINUTE);
      expect((await demanderCode(api, email)).status).toBe(202);
      const encore = await verifier(api, email, api.expediteur.dernierCode(email));
      expect(encore.status).toBe(401);
      expect(await encore.text()).toBe(corpsNormal);

      // Les dix échecs sont sortis de la fenêtre : le bon code passe à nouveau.
      instant = new Date(DEBUT.getTime() + JOUR + 5 * MINUTE);
      expect((await demanderCode(api, email)).status).toBe(202);
      expect((await verifier(api, email, api.expediteur.dernierCode(email))).status).toBe(200);
    });

    it('9 échecs en 24 h ne bloquent pas', async () => {
      const api = creer();
      const email = emailNeuf();
      await demanderCode(api, email);
      await echouer(api, email, 5);
      avancer(61 * SECONDE);
      await demanderCode(api, email);
      await echouer(api, email, 4);
      expect((await verifier(api, email, api.expediteur.dernierCode(email))).status).toBe(200);
    });

    it('les échecs d’une adresse ne bloquent pas une autre adresse', async () => {
      const api = creer();
      const attaquee = emailNeuf();
      await demanderCode(api, attaquee);
      await echouer(api, attaquee, 5);
      avancer(61 * SECONDE);
      await demanderCode(api, attaquee);
      await echouer(api, attaquee, 5);

      const autre = emailNeuf();
      await connecter(api, autre);
    });

    it('au plus 10 envois de code par adresse sur 24 h glissantes : le 11e reçoit le 429 habituel', async () => {
      const api = creer();
      const email = emailNeuf();
      // Un envoi toutes les 2 h : ni la limite par minute, ni celle par heure ne jouent.
      for (let i = 0; i < 10; i++) {
        instant = new Date(DEBUT.getTime() + i * 2 * HEURE);
        expect((await demanderCode(api, email)).status, `envoi ${String(i + 1)}`).toBe(202);
      }
      instant = new Date(DEBUT.getTime() + 20 * HEURE);
      const trop = await demanderCode(api, email);
      expect(trop.status).toBe(429);
      expect(await trop.json()).toEqual({ erreur: 'trop_de_demandes' });
      expect(Number(trop.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(api.expediteur.pour(email)).toHaveLength(10);

      // 24 h après le premier envoi, une place se libère.
      instant = new Date(DEBUT.getTime() + JOUR + MINUTE);
      expect((await demanderCode(api, email)).status).toBe(202);
      expect(api.expediteur.pour(email)).toHaveLength(11);
    });
  });

  describe('relecture sécurité : nom de ferme sans caractère de contrôle ni de format', () => {
    const NOMS_REFUSES = [
      'Jardins\r\nBcc: pirate@exemple.fr',
      'Jardins\nde Garonne',
      'Jardins\u0000',
      'Jardins‮de Garonne', // inversion de sens (RLO)
      'Jardins​de Garonne', // espace sans chasse
      'Jardins\tde Garonne',
    ];

    it('POST /fermes refuse en 400, sans rien créer', async () => {
      const api = creer();
      const { jetonAcces } = await connecter(api, emailNeuf());
      for (const nom of NOMS_REFUSES) {
        const id = randomUUID();
        const res = await requete(api, 'POST', '/fermes', { id, nom }, jetonAcces);
        expect(res.status, JSON.stringify(nom)).toBe(400);
        expect(await res.json()).toEqual({ erreur: 'requete_invalide' });
        expect(await lignes(`SELECT 1 FROM ferme WHERE id = $1`, [id])).toHaveLength(0);
      }
      // Témoin : accents, apostrophe, tiret et emoji restent permis.
      const res = await requete(api, 'POST', '/fermes', { nom: 'Les Jardins d’Élodie – Bio 🍓' }, jetonAcces);
      expect(res.status).toBe(201);
    });

    it('PATCH /fermes/:id refuse en 400, sans renommer', async () => {
      const api = creer();
      const { jetonAcces } = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, jetonAcces, 'Jardins de Garonne');
      for (const nom of NOMS_REFUSES) {
        const res = await requete(api, 'PATCH', `/fermes/${ferme.id}`, { nom }, jetonAcces);
        expect(res.status, JSON.stringify(nom)).toBe(400);
        expect(await res.json()).toEqual({ erreur: 'requete_invalide' });
      }
      expect(await lignes(`SELECT nom FROM ferme WHERE id = $1`, [ferme.id])).toEqual([{ nom: 'Jardins de Garonne' }]);
    });
  });

  describe('relecture sécurité : invitation', () => {
    it('la réponse ne dit pas si le compte existait : même statut, même forme, aucun identifiant', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces);
      const existant = emailNeuf();
      await connecter(api, existant);
      const neuf = emailNeuf();

      const resExistant = await inviter(api, ferme.id, existant, gerant.jetonAcces);
      const resNeuf = await inviter(api, ferme.id, neuf, gerant.jetonAcces);
      expect(resExistant.status).toBe(201);
      expect(resNeuf.status).toBe(201);
      expect(await resExistant.json()).toEqual({ email: existant, role: 'equipier' });
      expect(await resNeuf.json()).toEqual({ email: neuf, role: 'equipier' });

      const encore = await inviter(api, ferme.id, neuf, gerant.jetonAcces);
      expect(encore.status).toBe(200);
      expect(await encore.json()).toEqual({ email: neuf, role: 'equipier' });
    });

    it('un compte déjà connecté et invité ne voit la ferme qu’après s’être reconnecté', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces, 'Jardins de Garonne');
      const emailInvite = emailNeuf();
      const invite = await connecter(api, emailInvite);
      expect((await inviter(api, ferme.id, emailInvite, gerant.jetonAcces)).status).toBe(201);

      // Invité, pas encore membre : rien, avec le jeton d'avant l'invitation.
      const moi = await lire<Moi>(await requete(api, 'GET', '/moi', undefined, invite.jetonAcces));
      expect(moi.fermes).toEqual([]);
      for (const [methode, corps] of [
        ['GET', undefined],
        ['PATCH', { nom: 'Autre' }],
      ] as const) {
        const res = await requete(api, methode, `/fermes/${ferme.id}`, corps, invite.jetonAcces);
        expect(res.status, methode).toBe(404);
        expect(await res.json()).toEqual({ erreur: 'ferme_introuvable' });
      }
      expect(await fermesDeLUtilisateur(drizzle(pool), invite.utilisateurId as Id<'Utilisateur'>)).toEqual([]);
      expect(
        await roleDansLaFerme(drizzle(pool), invite.utilisateurId as Id<'Utilisateur'>, ferme.id as Id<'Ferme'>),
      ).toBeNull();

      // Sa prochaine connexion réussie vaut acceptation.
      avancer(2 * MINUTE);
      const apres = await connecter(api, emailInvite);
      const moiApres = await lire<Moi>(await requete(api, 'GET', '/moi', undefined, apres.jetonAcces));
      expect(moiApres.fermes).toEqual([{ id: ferme.id, nom: 'Jardins de Garonne', role: 'equipier' }]);
      const lue = await requete(api, 'GET', `/fermes/${ferme.id}`, undefined, apres.jetonAcces);
      expect(lue.status).toBe(200);
      expect((await lire<FermeVue>(lue)).role).toBe('equipier');
    });

    it('un compte neuf invité n’est membre qu’après une vérification réussie (ni la demande de code, ni un échec)', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces);
      const email = emailNeuf();
      expect((await inviter(api, ferme.id, email, gerant.jetonAcces)).status).toBe(201);

      const aucuneFerme = async (): Promise<void> => {
        for (const id of await idsDuCompte(email)) {
          expect(await fermesDeLUtilisateur(drizzle(pool), id)).toEqual([]);
          expect(await roleDansLaFerme(drizzle(pool), id, ferme.id as Id<'Ferme'>)).toBeNull();
        }
      };
      await aucuneFerme();
      expect((await demanderCode(api, email)).status).toBe(202);
      await aucuneFerme();
      await echouer(api, email, 1);
      await aucuneFerme();

      const res = await verifier(api, email, api.expediteur.dernierCode(email));
      expect(res.status).toBe(200);
      const { utilisateurId } = await lire<Connexion>(res);
      expect(await fermesDeLUtilisateur(drizzle(pool), utilisateurId as Id<'Utilisateur'>)).toEqual([ferme.id]);
      expect(await roleDansLaFerme(drizzle(pool), utilisateurId as Id<'Utilisateur'>, ferme.id as Id<'Ferme'>)).toBe(
        'equipier',
      );
    });

    it('un membre retiré puis réinvité redevient « invité » jusqu’à sa prochaine connexion', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces);
      const emailEquipier = emailNeuf();
      await inviter(api, ferme.id, emailEquipier, gerant.jetonAcces);
      const equipier = await connecter(api, emailEquipier);
      expect((await requete(api, 'GET', `/fermes/${ferme.id}`, undefined, equipier.jetonAcces)).status).toBe(200);

      await pool.query(`UPDATE membre SET supprime_le = $3 WHERE utilisateur_id = $1 AND ferme_id = $2`, [
        equipier.utilisateurId,
        ferme.id,
        instant,
      ]);
      avancer(MINUTE);
      expect((await inviter(api, ferme.id, emailEquipier, gerant.jetonAcces)).status).toBe(201);
      expect((await requete(api, 'GET', `/fermes/${ferme.id}`, undefined, equipier.jetonAcces)).status).toBe(404);

      avancer(2 * MINUTE);
      const reconnecte = await connecter(api, emailEquipier);
      expect((await requete(api, 'GET', `/fermes/${ferme.id}`, undefined, reconnecte.jetonAcces)).status).toBe(200);
    });

    it('au plus 20 invitations par gérant et par heure, toutes fermes confondues : la 21e reçoit 429, sans rien créer ni envoyer', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const fermeA = await creerFerme(api, gerant.jetonAcces, 'A');
      const fermeB = await creerFerme(api, gerant.jetonAcces, 'B');
      for (let i = 0; i < 12; i++) {
        expect((await inviter(api, fermeA.id, emailNeuf(), gerant.jetonAcces)).status, `A ${String(i + 1)}`).toBe(201);
      }
      for (let i = 0; i < 8; i++) {
        expect((await inviter(api, fermeB.id, emailNeuf(), gerant.jetonAcces)).status, `B ${String(i + 1)}`).toBe(201);
      }

      const cible = emailNeuf();
      const trop = await inviter(api, fermeB.id, cible, gerant.jetonAcces);
      expect(trop.status).toBe(429);
      expect(await trop.json()).toEqual({ erreur: 'trop_de_demandes' });
      expect(Number(trop.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(await lignes(`SELECT 1 FROM utilisateur WHERE email = $1`, [cible])).toHaveLength(0);
      expect(api.expediteur.pour(cible)).toHaveLength(0);

      // Un autre gérant n'est pas concerné.
      const autre = await connecter(api, emailNeuf());
      const fermeC = await creerFerme(api, autre.jetonAcces, 'C');
      expect((await inviter(api, fermeC.id, emailNeuf(), autre.jetonAcces)).status).toBe(201);

      // Une heure plus tard, la fenêtre est libre.
      // Le jeton d'accès (1 h) a expiré entre-temps : on le renouvelle, comme l'appli.
      avancer(HEURE + SECONDE);
      const { jetonAcces } = await lire<{ jetonAcces: string }>(await renouveler(api, gerant.jetonRenouvellement));
      expect((await inviter(api, fermeB.id, cible, jetonAcces)).status).toBe(201);
    });
  });

  describe('relecture sécurité : utilisateur supprimé', () => {
    // T09b : la garde relit utilisateur.supprime_le ; 401 non_authentifie remplace le 404 ferme_introuvable.
    it('perd immédiatement l’accès à ses fermes, même avec un jeton d’accès encore valable', async () => {
      const api = creer();
      const gerant = await connecter(api, emailNeuf());
      const ferme = await creerFerme(api, gerant.jetonAcces, 'Jardins de Garonne');
      expect((await requete(api, 'GET', `/fermes/${ferme.id}`, undefined, gerant.jetonAcces)).status).toBe(200);

      await pool.query(`UPDATE utilisateur SET supprime_le = $2 WHERE id = $1`, [gerant.utilisateurId, instant]);

      const cible = emailNeuf();
      for (const [methode, chemin, corps] of [
        ['GET', `/fermes/${ferme.id}`, undefined],
        ['PATCH', `/fermes/${ferme.id}`, { nom: 'Renommée' }],
        ['POST', `/fermes/${ferme.id}/membres`, { email: cible }],
      ] as const) {
        const res = await requete(api, methode, chemin, corps, gerant.jetonAcces);
        expect(res.status, `${methode} ${chemin}`).toBe(401);
        expect(await res.json()).toEqual({ erreur: 'non_authentifie' });
      }
      expect(await lignes(`SELECT nom FROM ferme WHERE id = $1`, [ferme.id])).toEqual([{ nom: 'Jardins de Garonne' }]);
      expect(await lignes(`SELECT 1 FROM utilisateur WHERE email = $1`, [cible])).toHaveLength(0);
      expect(api.expediteur.pour(cible)).toHaveLength(0);

      const id = gerant.utilisateurId as Id<'Utilisateur'>;
      expect(await fermesDeLUtilisateur(drizzle(pool), id)).toEqual([]);
      expect(await roleDansLaFerme(drizzle(pool), id, ferme.id as Id<'Ferme'>)).toBeNull();
    });
  });

  describe('relecture sécurité : cas déjà couverts par le code, désormais testés', () => {
    // T09b : rotation. Chaque renouvellement rend le jeton suivant, que le téléphone garde ;
    // avant T09b ce test représentait le même jeton tous les 60 jours.
    it('renouvelé tous les 60 jours, le jeton tient jusqu’à 360 jours, jamais au-delà de 365', async () => {
      const api = creer();
      let { jetonRenouvellement } = await connecter(api, emailNeuf());
      for (let jour = 60; jour <= 360; jour += 60) {
        instant = new Date(DEBUT.getTime() + jour * JOUR);
        const r = await renouveler(api, jetonRenouvellement);
        expect(r.status, `jour ${String(jour)}`).toBe(200);
        jetonRenouvellement = (await lire<Renouvellement>(r)).jetonRenouvellement;
      }
      instant = new Date(DEBUT.getTime() + 420 * JOUR);
      const res = await renouveler(api, jetonRenouvellement);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ erreur: 'jeton_invalide' });
    });

    it('un jeton de renouvellement révoqué est refusé', async () => {
      const api = creer();
      const { utilisateurId, jetonRenouvellement } = await connecter(api, emailNeuf());
      expect((await renouveler(api, jetonRenouvellement)).status).toBe(200);
      await pool.query(`UPDATE jeton_renouvellement SET revoque_le = $2 WHERE utilisateur_id = $1`, [
        utilisateurId,
        instant,
      ]);
      const res = await renouveler(api, jetonRenouvellement);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ erreur: 'jeton_invalide' });
    });

    it('demander un nouveau code invalide l’ancien', async () => {
      const api = creer();
      const email = emailNeuf();
      await demanderCode(api, email);
      const ancien = api.expediteur.dernierCode(email);
      avancer(61 * SECONDE);
      await demanderCode(api, email);
      const nouveau = api.expediteur.dernierCode(email);
      expect(nouveau).not.toBe(ancien); // une chance sur un million d'échouer par hasard
      expect((await verifier(api, email, ancien)).status).toBe(401);
      expect((await verifier(api, email, nouveau)).status).toBe(200);
    });

    it('10 demandes de code simultanées pour une adresse : un seul envoi', async () => {
      const api = creer();
      const email = emailNeuf();
      const reponses = await Promise.all(Array.from({ length: 10 }, () => demanderCode(api, email)));
      const statuts = reponses.map((r) => r.status);
      expect(statuts.filter((s) => s === 202)).toHaveLength(1);
      expect(statuts.filter((s) => s === 429)).toHaveLength(9);
      expect(api.expediteur.pour(email)).toHaveLength(1);
      expect(await lignes(`SELECT 1 FROM code_connexion WHERE email = $1`, [email])).toHaveLength(1);
    });

    it('10 vérifications simultanées du bon code : une seule session', async () => {
      const api = creer();
      const email = emailNeuf();
      await demanderCode(api, email);
      const code = api.expediteur.dernierCode(email);
      const reponses = await Promise.all(Array.from({ length: 10 }, () => verifier(api, email, code)));
      const statuts = reponses.map((r) => r.status);
      expect(statuts.filter((s) => s === 200)).toHaveLength(1);
      expect(statuts.filter((s) => s === 401)).toHaveLength(9);
      expect(
        await lignes(
          `SELECT 1 FROM jeton_renouvellement j JOIN utilisateur u ON u.id = j.utilisateur_id WHERE u.email = $1`,
          [email],
        ),
      ).toHaveLength(1);
    });
  });
});

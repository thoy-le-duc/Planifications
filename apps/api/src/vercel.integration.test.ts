/**
 * Tests d'acceptation T38a — l'API en fonctions Vercel, contre un vrai Postgres.
 *
 * ── Exécution ───────────────────────────────────────────────────────────────────────────────
 *
 * Comme auth.integration.test.ts : DATABASE_URL désigne un Postgres où l'on peut créer des bases.
 * Base jetable `t38a_…`, migrations appliquées, supprimée à la fin. Sans DATABASE_URL : échec
 * clair en CI, saut signalé en local. Les e-mails partent vers le relais SMTP factice local
 * (auth/test/smtp-factice.ts), configuré par les MÊMES variables d'environnement qu'en
 * production : rien n'est injecté à côté de `env`.
 *
 * ── Ce qui est vérifié ──────────────────────────────────────────────────────────────────────
 *
 * Chaque « fonction froide » est une instance neuve : `vi.resetModules()` puis import neuf de
 * vercel.ts (aucun état de module partagé), puis `creerGestionnaire(env)` (API : vercel.test.ts).
 * Deux instances ne partagent que la base. Donc :
 *   1. la limite d'envoi de codes par adresse (1 par minute) tient d'une instance à l'autre ;
 *   2. les tentatives d'un code (5 au plus) se comptent d'une instance à l'autre ;
 *   3. un code envoyé par une instance se vérifie dans une autre ; la session (jetons) vaut
 *      dans toutes ;
 *   4. la limite par adresse IP (30 codes par heure, PROXY_DE_CONFIANCE=1 : Vercel pose
 *      X-Forwarded-For) tient d'une instance à l'autre ;
 *   5. la limite de débit de la synchro (ENVOIS_MAX_PAR_MINUTE envois par utilisateur et par
 *      minute) tient d'une instance à l'autre. AUJOURD'HUI ELLE EST EN MÉMOIRE
 *      (`creerLimiteMemoire` dans sync/upload.ts) : ce test échoue tant qu'elle n'est pas
 *      comptée en base (ou que le ticket ne tranche pas autrement, justifié dans la PR) ;
 *   6. une requête ne garde pas de connexion Postgres ouverte au-delà de sa fin : au plus
 *      DELAI_LIBERATION_MS après la réponse, la base jetable n'a plus aucune connexion.
 */
import { randomUUID } from "node:crypto";
import { appliquerMigrations } from "@planif/db";
import { exportJWK, generateKeyPair } from "jose";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ENVOIS_MAX_PAR_MINUTE } from "./sync/upload.ts";
import { CODES_PAR_IP_PAR_HEURE } from "./auth/limite-ip.ts";
import { TENTATIVES_MAX } from "./auth/routes.ts";
import {
  demarrerSmtpFactice,
  lireTexte,
  type ServeurSmtpFactice,
} from "./auth/test/smtp-factice.ts";

type Environnement = Readonly<Record<string, string | undefined>>;
type Gestionnaire = (requete: Request) => Promise<Response>;

interface ModuleVercel {
  readonly creerGestionnaire: (
    env: Environnement,
    options?: { readonly journal?: (ligne: string) => void },
  ) => Gestionnaire;
}

/** Chemin dynamique : ce fichier se type avant que vercel.ts n'existe. */
const CHEMIN_VERCEL = "./vercel.ts";

const URL_BASE = process.env.DATABASE_URL ?? "";
const EN_CI = (process.env.CI ?? "") !== "" && process.env.CI !== "false";

if (URL_BASE === "") {
  if (EN_CI) {
    describe("T38a : API Vercel et base PostgreSQL", () => {
      it("DATABASE_URL est définie en CI", () => {
        throw new Error(
          "DATABASE_URL absente en CI : les tests d’intégration de T38a exigent le service Postgres.",
        );
      });
    });
  } else {
    console.warn(
      "[T38a] DATABASE_URL absente : tests d’intégration de l’API Vercel sautés.",
    );
  }
}

const decrireAvecBase = URL_BASE === "" ? describe.skip : describe;

/** Délai laissé au pool pour fermer ses connexions après la réponse (connexions courtes). */
const DELAI_LIBERATION_MS = 2_000;

interface Connexion {
  readonly utilisateurId: string;
  readonly jetonAcces: string;
  readonly jetonRenouvellement: string;
}

function emailNeuf(): string {
  return `t38a-${randomUUID()}@ferme.fr`;
}

function codeFaux(code: string): string {
  return String((Number(code) + 1) % 1_000_000).padStart(6, "0");
}

decrireAvecBase(
  "T38a : fonctions Vercel froides, état partagé par la seule base",
  { timeout: 120_000 },
  () => {
    const nomBase = `t38a_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    let admin: pg.Client;
    let smtp: ServeurSmtpFactice;
    let env: Environnement = {};
    const journal: string[] = [];

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: URL_BASE });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${nomBase}`);
      const url = new URL(URL_BASE);
      url.pathname = `/${nomBase}`;
      await appliquerMigrations(url.toString());
      smtp = await demarrerSmtpFactice();
      const { privateKey } = await generateKeyPair("RS256", {
        extractable: true,
      });
      const jwks = JSON.stringify({
        keys: [
          {
            ...(await exportJWK(privateKey)),
            kid: "cle-t38a",
            alg: "RS256",
            use: "sig",
          },
        ],
      });
      env = {
        DATABASE_URL: url.toString(),
        JWT_CLES_PRIVEES: jwks,
        JWT_EMETTEUR: "https://planif.test/api",
        JWT_AUDIENCE: "powersync-planif",
        // Relais factice local, en clair : permis seulement en développement (config.ts).
        NODE_ENV: "development",
        SMTP_HOTE: "127.0.0.1",
        SMTP_PORT: String(smtp.port),
        SMTP_SECURITE: "aucune",
        SMTP_EXPEDITEUR: "connexion@planif.test",
        PROXY_DE_CONFIANCE: "1",
      };
    }, 120_000);

    afterAll(async () => {
      await smtp.fermer();
      await admin.query(`DROP DATABASE IF EXISTS ${nomBase} WITH (FORCE)`);
      await admin.end();
    });

    /** Une fonction froide : modules rechargés, aucune mémoire commune avec les précédentes. */
    async function froide(): Promise<Gestionnaire> {
      vi.resetModules();
      const m = (await import(CHEMIN_VERCEL)) as ModuleVercel;
      return m.creerGestionnaire(env, { journal: (l) => journal.push(l) });
    }

    let ipSuivante = 0;
    /** Adresse IP de test (TEST-NET-3) propre à chaque appel, pour ne pas toucher la limite par IP. */
    function ipNeuve(): string {
      ipSuivante += 1;
      return `203.0.113.${String(ipSuivante % 250)}`;
    }

    function post(
      chemin: string,
      corps: unknown,
      enTetes: Record<string, string> = {},
    ): Request {
      return new Request(`https://planif.test${chemin}`, {
        method: "POST",
        body: JSON.stringify(corps),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ipNeuve(),
          ...enTetes,
        },
      });
    }

    function get(
      chemin: string,
      enTetes: Record<string, string> = {},
    ): Request {
      return new Request(`https://planif.test${chemin}`, {
        headers: { "x-forwarded-for": ipNeuve(), ...enTetes },
      });
    }

    /** Le code à 6 chiffres du dernier message reçu par le relais factice pour cette adresse. */
    function dernierCode(email: string): string {
      const message = smtp.messages
        .filter((m) => m.rcptTo.includes(email))
        .at(-1);
      const code = /\b(\d{6})\b/.exec(
        message === undefined ? "" : lireTexte(message.donnees),
      )?.[1];
      if (code === undefined) throw new Error(`aucun code reçu pour ${email}`);
      return code;
    }

    async function connecter(email: string): Promise<Connexion> {
      expect(
        (await (await froide())(post("/api/auth/code", { email }))).status,
      ).toBe(202);
      const res = await (
        await froide()
      )(post("/api/auth/verifier", { email, code: dernierCode(email) }));
      expect(res.status).toBe(200);
      return (await res.json()) as Connexion;
    }

    it("1. limite d’envoi de codes : une seconde fonction froide refuse le deuxième code de la minute", async () => {
      const email = emailNeuf();
      const a = await froide();
      expect((await a(post("/api/auth/code", { email }))).status).toBe(202);

      const b = await froide();
      const res = await b(post("/api/auth/code", { email }));
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ erreur: "trop_de_demandes" });
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(
        smtp.messages.filter((m) => m.rcptTo.includes(email)),
      ).toHaveLength(1);
    });

    it("2. tentatives : cinq échecs répartis sur cinq fonctions froides épuisent le code", async () => {
      const email = emailNeuf();
      expect(
        (await (await froide())(post("/api/auth/code", { email }))).status,
      ).toBe(202);
      const code = dernierCode(email);

      for (let i = 0; i < TENTATIVES_MAX; i++) {
        const res = await (
          await froide()
        )(post("/api/auth/verifier", { email, code: codeFaux(code) }));
        expect(res.status).toBe(401);
      }
      const res = await (
        await froide()
      )(post("/api/auth/verifier", { email, code }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ erreur: "code_invalide" });
    });

    it("3. un code envoyé par une fonction se vérifie dans une autre ; la session vaut partout", async () => {
      const email = emailNeuf();
      const connexion = await connecter(email);

      const moi = await (
        await froide()
      )(get("/api/moi", { authorization: `Bearer ${connexion.jetonAcces}` }));
      expect(moi.status).toBe(200);
      expect(((await moi.json()) as { email: string }).email).toBe(email);

      const renouv = await (
        await froide()
      )(
        post("/api/auth/renouveler", {
          jetonRenouvellement: connexion.jetonRenouvellement,
        }),
      );
      expect(renouv.status).toBe(200);

      // Le code consommé ne resert pas, même dans une instance neuve.
      const rejeu = await (
        await froide()
      )(post("/api/auth/verifier", { email, code: dernierCode(email) }));
      expect(rejeu.status).toBe(401);
    });

    it("4. limite par adresse IP (X-Forwarded-For de Vercel) : tient d’une fonction froide à l’autre", async () => {
      const ip = "198.51.100.38";
      let instance = await froide();
      for (let i = 0; i < CODES_PAR_IP_PAR_HEURE; i++) {
        // Une instance neuve toutes les cinq demandes.
        if (i % 5 === 0) instance = await froide();
        const res = await instance(
          post(
            "/api/auth/code",
            { email: emailNeuf() },
            { "x-forwarded-for": ip },
          ),
        );
        expect(res.status).toBe(202);
      }
      const res = await (
        await froide()
      )(
        post(
          "/api/auth/code",
          { email: emailNeuf() },
          { "x-forwarded-for": ip },
        ),
      );
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ erreur: "trop_de_demandes" });
    });

    it("5. débit de la synchro (envois par utilisateur et par minute) : tient d’une fonction froide à l’autre", async () => {
      const { jetonAcces } = await connecter(emailNeuf());
      const autorisation = { authorization: `Bearer ${jetonAcces}` };

      const a = await froide();
      for (let i = 0; i < ENVOIS_MAX_PAR_MINUTE; i++) {
        const res = await a(
          post("/api/sync/upload", { ecritures: [] }, autorisation),
        );
        expect(res.status).toBe(200);
      }
      // Dans la même minute, une autre instance ne remet pas le compteur à zéro.
      const b = await froide();
      const res = await b(
        post("/api/sync/upload", { ecritures: [] }, autorisation),
      );
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ erreur: "trop_de_requetes" });
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    });

    it("6. une requête ne garde aucune connexion Postgres ouverte après sa fin", async () => {
      const compter = async (): Promise<number> =>
        Number(
          (
            await admin.query<{ n: string }>(
              "SELECT count(*) AS n FROM pg_stat_activity WHERE datname = $1",
              [nomBase],
            )
          ).rows[0]?.n ?? "0",
        );

      const gerer = await froide();
      expect(
        (await gerer(post("/api/auth/code", { email: emailNeuf() }))).status,
      ).toBe(202);
      expect((await gerer(get("/api/sante"))).status).toBe(200);

      const limite = Date.now() + DELAI_LIBERATION_MS;
      let n = await compter();
      while (n > 0 && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 100));
        n = await compter();
      }
      expect(n).toBe(0);
    });

    it("aucune valeur secrète de la configuration dans le journal", () => {
      const tout = journal.join("\n");
      const jwk =
        (JSON.parse(env.JWT_CLES_PRIVEES ?? "{}") as { keys: { d?: string }[] })
          .keys[0]?.d ?? "";
      expect(jwk).not.toBe("");
      expect(tout).not.toContain(jwk);
    });
  },
);

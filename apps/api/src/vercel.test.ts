/**
 * Tests d'acceptation T38a — l'API en fonction Vercel (point d'entrée), sans base de données.
 * Le test d'intégration Postgres (fonctions froides, limites, connexions) est dans
 * vercel.integration.test.ts.
 *
 * ── API attendue ────────────────────────────────────────────────────────────────────────────
 *
 * apps/api/src/vercel.ts
 *   type Gestionnaire = (requete: Request) => Promise<Response>;
 *   creerGestionnaire(
 *     env: Readonly<Record<string, string | undefined>>,
 *     options?: { readonly journal?: (ligne: string) => void },
 *   ): Gestionnaire;
 *
 *   - Sert la MÊME application que Node : `creerApp` (app.ts), sans route dupliquée, montée sous
 *     le préfixe `/api` (l'appli appelle `/api` en même origine, VITE_API_URL vide) :
 *     GET /api/sante répond comme GET /sante de app.ts ; GET /api/.well-known/jwks.json sert les
 *     clés publiques, etc.
 *   - Aucune lecture de configuration à la création ni à l'import du module : la configuration
 *     (`lireConfig`, config.ts, mêmes variables que Node) est lue au PREMIER appel, une fois par
 *     instance de fonction. Configuration invalide (variable manquante, JWKS illisible…) :
 *     chaque appel répond 500 { erreur: 'configuration_invalide' } ; le message clair de
 *     `lireConfig` (qui nomme la variable) va au journal, jamais dans la réponse ; ni la réponse
 *     ni le journal ne contiennent une valeur secrète.
 *   - Le module exporte aussi ce que Vercel appelle (export par défaut ou par méthode HTTP, au
 *     choix du développeur : vérifié par `vercel build`), construit sur
 *     `creerGestionnaire(process.env)` ; l'importer ne lève jamais, même sans aucune variable.
 */
import { VERSION_MODELE_DONNEES } from "@planif/core";
import { exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { app as appNode } from "./app.ts";

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

async function moduleVercel(): Promise<ModuleVercel> {
  return (await import(CHEMIN_VERCEL)) as ModuleVercel;
}

/** Valeurs secrètes factices : aucune ne doit sortir dans une réponse ni dans le journal. */
const MOT_DE_PASSE_BASE = "MdpBaseSecret-7Qx2";
const MOT_DE_PASSE_SMTP = "CleSmtpSecrete-Zr84kP";

let jwks = "";
/** Partie privée « d » de la clé RSA (secrète). */
let partiePrivee = "";

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  partiePrivee = jwk.d ?? "";
  jwks = JSON.stringify({
    keys: [{ ...jwk, kid: "cle-t38a", alg: "RS256", use: "sig" }],
  });
});

/** Configuration complète, valide pour lireConfig ; la base n'est jamais jointe (port fermé). */
function envComplet(): Record<string, string | undefined> {
  return {
    DATABASE_URL: `postgres://planif:${MOT_DE_PASSE_BASE}@127.0.0.1:1/planif`,
    JWT_CLES_PRIVEES: jwks,
    JWT_EMETTEUR: "https://planif.test/api",
    JWT_AUDIENCE: "powersync-planif",
    SMTP_HOTE: "127.0.0.1",
    SMTP_PORT: "1",
    SMTP_EXPEDITEUR: "connexion@planif.test",
    SMTP_UTILISATEUR: "connexion@planif.test",
    SMTP_MOT_DE_PASSE: MOT_DE_PASSE_SMTP,
    PROXY_DE_CONFIANCE: "1",
  };
}

function secrets(): string[] {
  return [MOT_DE_PASSE_BASE, MOT_DE_PASSE_SMTP, partiePrivee];
}

function requete(chemin: string, init?: RequestInit): Request {
  return new Request(`https://planif.test${chemin}`, init);
}

describe("T38a : point d’entrée Vercel", () => {
  it("importer le module ne lit aucune variable et ne lève pas", async () => {
    const m = await moduleVercel();
    expect(typeof m.creerGestionnaire).toBe("function");
  });

  it("créer le gestionnaire ne lit pas la configuration (aucune erreur avant le premier appel)", async () => {
    const { creerGestionnaire } = await moduleVercel();
    expect(() => creerGestionnaire({})).not.toThrow();
  });

  it("GET /api/sante répond comme GET /sante de l’application Node", async () => {
    const { creerGestionnaire } = await moduleVercel();
    const journal: string[] = [];
    const gerer = creerGestionnaire(envComplet(), {
      journal: (l) => journal.push(l),
    });
    const res = await gerer(requete("/api/sante"));
    expect(res.status).toBe(200);
    const corps: unknown = await res.json();
    expect(corps).toEqual({ ok: true, versionModele: VERSION_MODELE_DONNEES });
    const node = await appNode.request("/sante");
    expect(corps).toEqual(await node.json());
  });

  it("sert toute l’application sous /api (JWKS public de la clé configurée)", async () => {
    const { creerGestionnaire } = await moduleVercel();
    const gerer = creerGestionnaire(envComplet(), { journal: () => undefined });
    const res = await gerer(requete("/api/.well-known/jwks.json"));
    expect(res.status).toBe(200);
    const corps = (await res.json()) as {
      keys: { kid?: string; d?: string }[];
    };
    expect(corps.keys.map((k) => k.kid)).toEqual(["cle-t38a"]);
    expect(corps.keys[0]?.d).toBeUndefined();
  });

  it("une route inconnue sous /api répond 404, sans 500", async () => {
    const { creerGestionnaire } = await moduleVercel();
    const gerer = creerGestionnaire(envComplet(), { journal: () => undefined });
    const res = await gerer(requete("/api/nexiste-pas"));
    expect(res.status).toBe(404);
  });

  describe("configuration invalide : erreur claire au premier appel, sans secret", () => {
    const cas: readonly {
      readonly nom: string;
      readonly modifier: (env: Record<string, string | undefined>) => void;
      readonly variable: string;
    }[] = [
      {
        nom: "DATABASE_URL absente",
        modifier: (e) => (e.DATABASE_URL = undefined),
        variable: "DATABASE_URL",
      },
      {
        nom: "JWT_CLES_PRIVEES absente",
        modifier: (e) => (e.JWT_CLES_PRIVEES = undefined),
        variable: "JWT_CLES_PRIVEES",
      },
      {
        nom: "JWT_EMETTEUR vide",
        modifier: (e) => (e.JWT_EMETTEUR = ""),
        variable: "JWT_EMETTEUR",
      },
      {
        nom: "JWT_AUDIENCE absente",
        modifier: (e) => (e.JWT_AUDIENCE = undefined),
        variable: "JWT_AUDIENCE",
      },
      {
        nom: "aucun service d’e-mail",
        modifier: (e) => (e.SMTP_HOTE = undefined),
        variable: "SMTP_HOTE",
      },
      {
        nom: "SMTP_EXPEDITEUR absente",
        modifier: (e) => (e.SMTP_EXPEDITEUR = undefined),
        variable: "SMTP_EXPEDITEUR",
      },
      {
        nom: "JWKS illisible (contient un secret)",
        modifier: (e) =>
          (e.JWT_CLES_PRIVEES = `pas-du-json-${MOT_DE_PASSE_SMTP}`),
        variable: "JWT_CLES_PRIVEES",
      },
    ];

    for (const { nom, modifier, variable } of cas) {
      it(`${nom} : 500 configuration_invalide, la variable nommée au journal`, async () => {
        const { creerGestionnaire } = await moduleVercel();
        const env = envComplet();
        modifier(env);
        const journal: string[] = [];
        const gerer = creerGestionnaire(env, {
          journal: (l) => journal.push(l),
        });

        for (const chemin of ["/api/sante", "/api/auth/code"]) {
          const res = await gerer(
            requete(
              chemin,
              chemin.endsWith("code")
                ? {
                    method: "POST",
                    body: JSON.stringify({ email: "a@b.fr" }),
                    headers: { "content-type": "application/json" },
                  }
                : {},
            ),
          );
          expect(res.status).toBe(500);
          const texte = await res.text();
          expect(JSON.parse(texte)).toEqual({
            erreur: "configuration_invalide",
          });
          for (const s of secrets()) expect(texte).not.toContain(s);
        }

        const tout = journal.join("\n");
        expect(tout).toContain(variable);
        for (const s of secrets()) expect(tout).not.toContain(s);
      });
    }

    it("COURRIEL_CONSOLE=1 reste refusé hors NODE_ENV=development (codes jamais dans les journaux Vercel)", async () => {
      const { creerGestionnaire } = await moduleVercel();
      const env = {
        ...envComplet(),
        COURRIEL_CONSOLE: "1",
        NODE_ENV: "production",
      };
      const journal: string[] = [];
      const gerer = creerGestionnaire(env, { journal: (l) => journal.push(l) });
      const res = await gerer(requete("/api/sante"));
      expect(res.status).toBe(500);
      expect(journal.join("\n")).toContain("COURRIEL_CONSOLE");
    });
  });
});

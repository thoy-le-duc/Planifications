/**
 * Relecture sécurité de T09 — configuration du démarrage.
 *
 * ── Contrat ─────────────────────────────────────────────────────────────────────────────────
 *
 * apps/api/src/config.ts (nouveau, SANS effet de bord à l'import) exporte :
 *
 *   lireConfig(env: Readonly<Record<string, string | undefined>>): Config
 *   interface Config {
 *     readonly databaseUrl: string;      // DATABASE_URL
 *     readonly jwtClesPrivees: string;   // JWT_CLES_PRIVEES (JWKS brut, lu ensuite par trousseauDepuisJwks)
 *     readonly emetteur: string;         // JWT_EMETTEUR
 *     readonly audience: string;         // JWT_AUDIENCE
 *     readonly port: number;             // PORT, 3000 par défaut
 *     readonly courrielConsole: boolean; // COURRIEL_CONSOLE === '1'
 *   }
 *
 * lireConfig lance une Error (message en français qui nomme la variable en cause) :
 *   - si une variable obligatoire manque ou est vide ;
 *   - si COURRIEL_CONSOLE=1 alors que NODE_ENV=production : les codes de connexion
 *     apparaîtraient en clair dans les journaux ;
 *   - si COURRIEL_CONSOLE n'est pas « 1 » : aucun service d'envoi réel dans T09.
 *
 * index.ts appelle lireConfig(process.env), écrit le message d'erreur et sort en code 1.
 *
 * ── T09b : expéditeur réel et proxy de confiance ────────────────────────────────────────────
 *
 * `courrielConsole: boolean` est REMPLACÉ par `courriel` (l'expéditeur que index.ts construit),
 * et `proxyDeConfiance` s'ajoute :
 *
 *   interface Config {
 *     …champs ci-dessus sauf courrielConsole…
 *     readonly courriel:
 *       | { readonly type: 'console' }
 *       | { readonly type: 'smtp'; readonly hote: string; readonly port: number;
 *           readonly securite: 'tls' | 'starttls' | 'aucune'; readonly expediteur: string;
 *           readonly utilisateur?: string; readonly motDePasse?: string };   // OptionsSmtp sans delaiMs
 *     readonly proxyDeConfiance: boolean;
 *     readonly corsOrigines?: readonly string[];   // inchangé (T10)
 *   }
 *
 * Courriel :
 *   COURRIEL_CONSOLE=1       → { type: 'console' } (développement ; refusé si NODE_ENV=production,
 *                              comme avant). Prime sur SMTP_* si les deux sont posés.
 *   sinon SMTP_HOTE posé     → { type: 'smtp', … } avec :
 *     SMTP_SECURITE          'tls' | 'starttls' | 'aucune', défaut 'starttls' ; toute autre valeur
 *                            refusée ; 'aucune' (mot de passe et codes en clair sur le réseau)
 *                            refusée SAUF si NODE_ENV=development exactement (relecture
 *                            sécurité : NODE_ENV absente, vide, 'test', 'staging'… → refus)
 *     SMTP_PORT              défaut 465 ('tls'), 587 ('starttls'), 25 ('aucune') ; entier 1–65535
 *     SMTP_EXPEDITEUR        obligatoire (en-tête From) ; refusé s'il contient CR ou LF
 *     SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE   les deux ou aucun ; vides = absents
 *   ni l'un ni l'autre       → Error qui nomme SMTP_HOTE et COURRIEL_CONSOLE.
 *
 * Proxy : PROXY_DE_CONFIANCE='1' → true ; absente, vide ou '0' → false ; toute autre valeur
 * refusée (une faute de frappe ne doit pas désactiver la limite par IP en silence).
 * Le mot de passe SMTP n'apparaît dans aucun message d'erreur.
 *
 * Le module est chargé par un chemin dynamique pour que ce test type avant que config.ts
 * n'existe ; il échoue alors à l'import.
 */
import { describe, expect, it } from 'vitest';

type ConfigCourriel =
  | { readonly type: 'console' }
  | {
      readonly type: 'smtp';
      readonly hote: string;
      readonly port: number;
      readonly securite: 'tls' | 'starttls' | 'aucune';
      readonly expediteur: string;
      readonly utilisateur?: string;
      readonly motDePasse?: string;
    };

interface Config {
  readonly databaseUrl: string;
  readonly jwtClesPrivees: string;
  readonly emetteur: string;
  readonly audience: string;
  readonly port: number;
  readonly courriel: ConfigCourriel;
  readonly proxyDeConfiance: boolean;
}

interface ModuleConfig {
  lireConfig(env: Readonly<Record<string, string | undefined>>): Config;
}

const CHEMIN_CONFIG = './config.ts';

async function lireConfig(env: Readonly<Record<string, string | undefined>>): Promise<Config> {
  const module = (await import(CHEMIN_CONFIG)) as ModuleConfig;
  return module.lireConfig(env);
}

const ENV_DEV = {
  DATABASE_URL: 'postgres://localhost:5432/planif',
  JWT_CLES_PRIVEES: '{"keys":[]}',
  JWT_EMETTEUR: 'https://api.planif.test',
  JWT_AUDIENCE: 'powersync-planif',
  COURRIEL_CONSOLE: '1',
  NODE_ENV: 'development',
} as const;

describe('lireConfig', () => {
  it('en développement, COURRIEL_CONSOLE=1 est accepté', async () => {
    expect(await lireConfig(ENV_DEV)).toEqual({
      databaseUrl: ENV_DEV.DATABASE_URL,
      jwtClesPrivees: ENV_DEV.JWT_CLES_PRIVEES,
      emetteur: ENV_DEV.JWT_EMETTEUR,
      audience: ENV_DEV.JWT_AUDIENCE,
      port: 3000,
      courriel: { type: 'console' },
      proxyDeConfiance: false,
    });
  });

  it('PORT est lu', async () => {
    expect((await lireConfig({ ...ENV_DEV, PORT: '8080' })).port).toBe(8080);
  });

  it('refuse COURRIEL_CONSOLE=1 en production (codes en clair dans les journaux)', async () => {
    await expect(lireConfig({ ...ENV_DEV, NODE_ENV: 'production' })).rejects.toThrow(/COURRIEL_CONSOLE/);
  });

  it('refuse l’absence de service d’envoi (ni COURRIEL_CONSOLE ni SMTP_HOTE), en nommant les deux', async () => {
    const erreur = lireConfig({ ...ENV_DEV, COURRIEL_CONSOLE: undefined });
    await expect(erreur).rejects.toThrow(/COURRIEL_CONSOLE/);
    await expect(erreur).rejects.toThrow(/SMTP_HOTE/);
  });

  for (const nom of ['DATABASE_URL', 'JWT_CLES_PRIVEES', 'JWT_EMETTEUR', 'JWT_AUDIENCE'] as const) {
    it(`refuse ${nom} absente ou vide`, async () => {
      await expect(lireConfig({ ...ENV_DEV, [nom]: undefined })).rejects.toThrow(nom);
      await expect(lireConfig({ ...ENV_DEV, [nom]: '' })).rejects.toThrow(nom);
    });
  }
});

// ── T09b ───────────────────────────────────────────────────────────────────────────────────────

const ENV_SMTP = {
  DATABASE_URL: 'postgres://localhost:5432/planif',
  JWT_CLES_PRIVEES: '{"keys":[]}',
  JWT_EMETTEUR: 'https://api.planif.test',
  JWT_AUDIENCE: 'powersync-planif',
  NODE_ENV: 'production',
  SMTP_HOTE: 'smtp.fournisseur-ue.test',
  SMTP_PORT: '587',
  SMTP_SECURITE: 'starttls',
  SMTP_EXPEDITEUR: 'Planifications <connexion@planif.fr>',
  SMTP_UTILISATEUR: 'relais-planif',
  SMTP_MOT_DE_PASSE: 'mot-de-passe-de-test',
} as const;

describe('lireConfig : expéditeur SMTP (T09b)', () => {
  it('sans COURRIEL_CONSOLE, SMTP_HOTE sélectionne l’expéditeur SMTP, accepté en production', async () => {
    const config = await lireConfig(ENV_SMTP);
    expect(config.courriel).toEqual({
      type: 'smtp',
      hote: 'smtp.fournisseur-ue.test',
      port: 587,
      securite: 'starttls',
      expediteur: 'Planifications <connexion@planif.fr>',
      utilisateur: 'relais-planif',
      motDePasse: 'mot-de-passe-de-test',
    });
  });

  it('défauts : STARTTLS, port selon la sécurité, sans identifiants', async () => {
    const sansOptions = { ...ENV_SMTP, SMTP_PORT: undefined, SMTP_SECURITE: undefined, SMTP_UTILISATEUR: undefined, SMTP_MOT_DE_PASSE: '' };
    expect((await lireConfig(sansOptions)).courriel).toEqual({
      type: 'smtp',
      hote: 'smtp.fournisseur-ue.test',
      port: 587,
      securite: 'starttls',
      expediteur: 'Planifications <connexion@planif.fr>',
    });
    const tls = await lireConfig({ ...ENV_SMTP, SMTP_PORT: undefined, SMTP_SECURITE: 'tls' });
    expect(tls.courriel).toMatchObject({ type: 'smtp', securite: 'tls', port: 465 });
    const clair = await lireConfig({ ...ENV_SMTP, NODE_ENV: 'development', SMTP_PORT: undefined, SMTP_SECURITE: 'aucune' });
    expect(clair.courriel).toMatchObject({ type: 'smtp', securite: 'aucune', port: 25 });
  });

  it('COURRIEL_CONSOLE=1 prime en développement', async () => {
    expect((await lireConfig({ ...ENV_SMTP, NODE_ENV: 'development', COURRIEL_CONSOLE: '1' })).courriel).toEqual({ type: 'console' });
  });

  it('COURRIEL_CONSOLE=1 reste refusé en production, même avec SMTP_HOTE', async () => {
    await expect(lireConfig({ ...ENV_SMTP, COURRIEL_CONSOLE: '1' })).rejects.toThrow(/COURRIEL_CONSOLE/);
  });

  it('SMTP_SECURITE=aucune refusée en production', async () => {
    await expect(lireConfig({ ...ENV_SMTP, SMTP_SECURITE: 'aucune' })).rejects.toThrow(/SMTP_SECURITE/);
  });

  it.each([undefined, '', 'test', 'staging', 'Development', 'dev'])(
    'SMTP_SECURITE=aucune refusée hors NODE_ENV=development (NODE_ENV %j)',
    async (nodeEnv) => {
      await expect(lireConfig({ ...ENV_SMTP, NODE_ENV: nodeEnv, SMTP_SECURITE: 'aucune' })).rejects.toThrow(/SMTP_SECURITE/);
    },
  );

  it('SMTP_SECURITE=aucune acceptée en développement', async () => {
    const config = await lireConfig({ ...ENV_SMTP, NODE_ENV: 'development', SMTP_SECURITE: 'aucune' });
    expect(config.courriel).toMatchObject({ type: 'smtp', securite: 'aucune' });
  });

  it.each(['TLS', 'ssl', 'oui', 'none'])('SMTP_SECURITE « %s » refusée', async (valeur) => {
    await expect(lireConfig({ ...ENV_SMTP, SMTP_SECURITE: valeur })).rejects.toThrow(/SMTP_SECURITE/);
  });

  it.each(['0', '70000', 'abc', '5.5'])('SMTP_PORT « %s » refusé', async (valeur) => {
    await expect(lireConfig({ ...ENV_SMTP, SMTP_PORT: valeur })).rejects.toThrow(/SMTP_PORT/);
  });

  it('SMTP_EXPEDITEUR obligatoire, sans retour à la ligne', async () => {
    await expect(lireConfig({ ...ENV_SMTP, SMTP_EXPEDITEUR: undefined })).rejects.toThrow(/SMTP_EXPEDITEUR/);
    await expect(lireConfig({ ...ENV_SMTP, SMTP_EXPEDITEUR: 'a@planif.fr\r\nBcc: pirate@exemple.fr' })).rejects.toThrow(
      /SMTP_EXPEDITEUR/,
    );
  });

  it('identifiants : les deux ou aucun, et le mot de passe n’apparaît jamais dans l’erreur', async () => {
    await expect(lireConfig({ ...ENV_SMTP, SMTP_UTILISATEUR: undefined })).rejects.toThrow(/SMTP_UTILISATEUR|SMTP_MOT_DE_PASSE/);
    await expect(lireConfig({ ...ENV_SMTP, SMTP_MOT_DE_PASSE: undefined })).rejects.toThrow(/SMTP_UTILISATEUR|SMTP_MOT_DE_PASSE/);
    for (const env of [
      { ...ENV_SMTP, SMTP_UTILISATEUR: undefined },
      { ...ENV_SMTP, SMTP_SECURITE: 'aucune' },
      { ...ENV_SMTP, SMTP_PORT: 'abc' },
    ]) {
      await expect(lireConfig(env)).rejects.toSatisfy((e: unknown) => e instanceof Error && !e.message.includes('mot-de-passe-de-test'));
    }
  });
});

describe('lireConfig : PROXY_DE_CONFIANCE (T09b)', () => {
  it('absente, vide ou 0 : l’adresse IP est celle de la socket', async () => {
    expect((await lireConfig(ENV_DEV)).proxyDeConfiance).toBe(false);
    expect((await lireConfig({ ...ENV_DEV, PROXY_DE_CONFIANCE: '' })).proxyDeConfiance).toBe(false);
    expect((await lireConfig({ ...ENV_DEV, PROXY_DE_CONFIANCE: '0' })).proxyDeConfiance).toBe(false);
  });

  it('1 : l’en-tête X-Forwarded-For du proxy est lu', async () => {
    expect((await lireConfig({ ...ENV_DEV, PROXY_DE_CONFIANCE: '1' })).proxyDeConfiance).toBe(true);
  });

  it.each(['true', 'oui', 'yes', '2'])('« %s » refusée (faute de frappe)', async (valeur) => {
    await expect(lireConfig({ ...ENV_DEV, PROXY_DE_CONFIANCE: valeur })).rejects.toThrow(/PROXY_DE_CONFIANCE/);
  });
});

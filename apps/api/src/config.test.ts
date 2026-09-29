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
 * Le module est chargé par un chemin dynamique pour que ce test type avant que config.ts
 * n'existe ; il échoue alors à l'import.
 */
import { describe, expect, it } from 'vitest';

interface Config {
  readonly databaseUrl: string;
  readonly jwtClesPrivees: string;
  readonly emetteur: string;
  readonly audience: string;
  readonly port: number;
  readonly courrielConsole: boolean;
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
      courrielConsole: true,
    });
  });

  it('PORT est lu', async () => {
    expect((await lireConfig({ ...ENV_DEV, PORT: '8080' })).port).toBe(8080);
  });

  it('refuse COURRIEL_CONSOLE=1 en production (codes en clair dans les journaux)', async () => {
    await expect(lireConfig({ ...ENV_DEV, NODE_ENV: 'production' })).rejects.toThrow(/COURRIEL_CONSOLE/);
  });

  it('refuse l’absence de service d’envoi (COURRIEL_CONSOLE absent)', async () => {
    await expect(lireConfig({ ...ENV_DEV, COURRIEL_CONSOLE: undefined })).rejects.toThrow(/COURRIEL_CONSOLE/);
  });

  for (const nom of ['DATABASE_URL', 'JWT_CLES_PRIVEES', 'JWT_EMETTEUR', 'JWT_AUDIENCE'] as const) {
    it(`refuse ${nom} absente ou vide`, async () => {
      await expect(lireConfig({ ...ENV_DEV, [nom]: undefined })).rejects.toThrow(nom);
      await expect(lireConfig({ ...ENV_DEV, [nom]: '' })).rejects.toThrow(nom);
    });
  }
});

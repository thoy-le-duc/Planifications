/**
 * T10c, décision 7 du chef : deux lancements de `pnpm e2e:synchro` (deux équipes, deux copies de
 * travail) ne se croisent pas. Le port de la page de diagnostic se choisit par E2E_PORT_PAGE
 * (défaut 4174 pour playwright seul ; pnpm e2e:synchro passe 14174) : playwright.synchro.config.ts construit et sert la page sur ce port, et
 * l'attend là (baseURL, webServer.url). SYNCHRO_BASE_URL, si posée, garde la priorité (page déjà
 * servie ailleurs, aucun serveur lancé).
 *
 * Le nom du projet docker compose (E2E_PROJET_COMPOSE, défaut « planif-e2e-synchro ») se lit
 * dans scripts/e2e-synchro.ts, qui s'exécute à l'import : il est décrit dans l'en-tête de
 * stock.e2e.ts, pas testé ici.
 */
import type { PlaywrightTestConfig } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

const VARIABLES = ['E2E_PORT_PAGE', 'SYNCHRO_BASE_URL', 'API_URL', 'POWERSYNC_URL'] as const;
const avant = new Map(VARIABLES.map((v) => [v, process.env[v]]));

async function configAvec(env: Partial<Record<(typeof VARIABLES)[number], string>>): Promise<PlaywrightTestConfig> {
  for (const v of VARIABLES) {
    const valeur = env[v];
    if (valeur === undefined) Reflect.deleteProperty(process.env, v);
    else process.env[v] = valeur;
  }
  vi.resetModules();
  const module = await import('../playwright.synchro.config.ts');
  return module.default;
}

/** Le serveur de la page (un seul attendu). */
function serveur(config: PlaywrightTestConfig): { command: string; url?: string } | undefined {
  const w = config.webServer;
  return Array.isArray(w) ? w[0] : w;
}

const SERVICES = { API_URL: 'http://localhost:3300', POWERSYNC_URL: 'http://localhost:59180' };

describe('T10c : banc e2e:synchro paramétrable (décision 7)', () => {
  afterEach(() => {
    for (const [v, valeur] of avant) {
      if (valeur === undefined) Reflect.deleteProperty(process.env, v);
      else process.env[v] = valeur;
    }
    vi.resetModules();
  });

  it('sans E2E_PORT_PAGE : la page reste sur le port 4174', async () => {
    const config = await configAvec(SERVICES);
    expect(config.use?.baseURL).toBe('http://localhost:4174');
    expect(serveur(config)?.url).toBe('http://localhost:4174');
    expect(serveur(config)?.command).toContain('--port 4174');
  });

  it('deux valeurs de E2E_PORT_PAGE : deux pages sur deux ports distincts, construites et attendues là', async () => {
    const a = await configAvec({ ...SERVICES, E2E_PORT_PAGE: '4274' });
    const b = await configAvec({ ...SERVICES, E2E_PORT_PAGE: '4374' });
    expect(a.use?.baseURL).toBe('http://localhost:4274');
    expect(serveur(a)?.url).toBe('http://localhost:4274');
    expect(serveur(a)?.command).toContain('--port 4274');
    expect(serveur(a)?.command).not.toContain('4174');
    expect(b.use?.baseURL).toBe('http://localhost:4374');
    expect(serveur(b)?.command).toContain('--port 4374');
  });

  it('SYNCHRO_BASE_URL garde la priorité : aucun serveur lancé', async () => {
    const config = await configAvec({ ...SERVICES, E2E_PORT_PAGE: '4274', SYNCHRO_BASE_URL: 'http://localhost:4999' });
    expect(config.use?.baseURL).toBe('http://localhost:4999');
    expect(config.webServer).toBeUndefined();
  });
});

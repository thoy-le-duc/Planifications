/**
 * T26 : un banc e2e:synchro qui ne tombe plus tout seul (ports, santé de Postgres). Tests
 * statiques, sans Docker.
 *
 * ── API attendue ────────────────────────────────────────────────────────────────────────────
 * Nouveau module scripts/e2e-synchro-ports.ts, importable sans effet de bord (ni Docker, ni
 * process.exit, ni lecture de l'environnement) :
 *
 *   export const PORTS_PAR_DEFAUT: {
 *     readonly postgres: number;   // E2E_PORT_POSTGRES
 *     readonly powersync: number;  // E2E_PORT_POWERSYNC
 *     readonly api: number;        // E2E_PORT_API
 *     readonly page: number;       // E2E_PORT_PAGE
 *   };
 *
 * scripts/e2e-synchro.ts s'en sert pour ses valeurs par défaut (vérifié ici : plus de nombres
 * en dur dans les appels `port('E2E_PORT_…', n)`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RACINE = new URL('../../../', import.meta.url);
const lire = (chemin: string): string => readFileSync(new URL(chemin, RACINE), 'utf8');

const DEBUT_PLAGE_EPHEMERE = 32_768;
const PORTS_COURANTS = [5432, 8080, 3000];

describe('T26 : ports par défaut du banc hors de la plage éphémère de Linux', () => {
  it('quatre ports, tous sous 32768, distincts entre eux et des ports courants', async () => {
    const { PORTS_PAR_DEFAUT } = await import('../../../scripts/e2e-synchro-ports.ts');
    const ports = [PORTS_PAR_DEFAUT.postgres, PORTS_PAR_DEFAUT.powersync, PORTS_PAR_DEFAUT.api, PORTS_PAR_DEFAUT.page];
    for (const p of ports) {
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThan(1024);
      expect(p).toBeLessThan(DEBUT_PLAGE_EPHEMERE);
      expect(PORTS_COURANTS).not.toContain(p);
    }
    expect(new Set(ports).size).toBe(4);
  });

  it('le script du banc n’a plus de port par défaut en dur : il lit PORTS_PAR_DEFAUT', () => {
    const script = lire('scripts/e2e-synchro.ts');
    expect(script).toContain('PORTS_PAR_DEFAUT');
    for (const v of ['E2E_PORT_POSTGRES', 'E2E_PORT_POWERSYNC', 'E2E_PORT_API', 'E2E_PORT_PAGE']) {
      const appel = new RegExp(`port\\(\\s*'${v}'\\s*,\\s*([^)]*)\\)`).exec(script);
      expect(appel, `appel port('${v}', …)`).not.toBeNull();
      expect(appel?.[1]).toContain('PORTS_PAR_DEFAUT');
    }
  });
});

describe('T26 : contrôle de santé de Postgres par TCP', () => {
  it('pg_isready appelle -h 127.0.0.1 (ou localhost) : pas la socket Unix du serveur d’initialisation', () => {
    const compose = lire('docker-compose.yml');
    const bloc = /^ {2}postgres:\n([\s\S]*?)^ {2}powersync:/m.exec(compose)?.[1] ?? '';
    const test = /healthcheck:\s*\n\s*test:\s*(.*)/.exec(bloc)?.[1] ?? '';
    expect(test).toContain('pg_isready');
    expect(test).toMatch(/-h\s+(127\.0\.0\.1|localhost)\b/);
  });
});

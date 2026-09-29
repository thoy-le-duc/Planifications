/**
 * `pnpm e2e:synchro` (T10) : test de bout en bout de la synchro, deux téléphones sur la même
 * ferme (apps/web/e2e-synchro/). Démarre tout ce qu'il faut, lance Playwright, et arrête tout à
 * la fin, même en cas d'échec ou d'interruption :
 *
 *   1. docker compose (projet à part, ports à part) : Postgres en wal_level=logical ;
 *   2. migrations de @planif/db ;
 *   3. le service PowerSync (configuration powersync/), qui réplique cette base ;
 *   4. l'API (apps/api) avec une clé de signature jetable et CORS pour la page de diagnostic ;
 *   5. playwright -c playwright.synchro.config.ts, qui construit la page avec VITE_API_URL et
 *      VITE_POWERSYNC_URL (figées au build) et la sert sur le port 4174.
 *
 * Variables facultatives : POSTGRES_IMAGE, POWERSYNC_IMAGE (miroir si Docker Hub est limité ;
 * l'image de PowerSync est figée en 1.26.1 dans docker-compose.yml), CHROMIUM_PATH (Chromium
 * déjà installé), JWT_CLES_PRIVEES (sinon une clé est générée), et les ports si ceux par défaut
 * sont pris : E2E_PORT_POSTGRES (55432), E2E_PORT_POWERSYNC (58080), E2E_PORT_API (3100).
 * La page est servie par playwright.synchro.config.ts (port 4174, ou SYNCHRO_BASE_URL).
 */
import { spawn, spawnSync, type ChildProcess, type SpawnSyncOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const PROJET = 'planif-e2e-synchro';

/** Port lu dans l'environnement, sinon celui par défaut. */
function port(variable: string, defaut: number): number {
  const valeur = process.env[variable];
  if (valeur === undefined || valeur === '') return defaut;
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) throw new Error(`${variable} : port invalide (${valeur})`);
  return n;
}

const PORT_POSTGRES = port('E2E_PORT_POSTGRES', 55432);
const PORT_POWERSYNC = port('E2E_PORT_POWERSYNC', 58080);
const PORT_API = port('E2E_PORT_API', 3100);
const ORIGINE_PAGE = new URL(process.env.SYNCHRO_BASE_URL ?? 'http://localhost:4174').origin;
const AUDIENCE = 'powersync-planif';
const EMETTEUR = `http://localhost:${String(PORT_API)}`;

const URL_BASE = `postgres://planif:planif@localhost:${String(PORT_POSTGRES)}/planif`;
const URL_API = `http://localhost:${String(PORT_API)}`;
const URL_POWERSYNC = `http://localhost:${String(PORT_POWERSYNC)}`;

/** Variables de docker compose : projet, ports et JWKS de l'API vus depuis le conteneur. */
const ENV_COMPOSE: NodeJS.ProcessEnv = {
  ...process.env,
  COMPOSE_PROJECT_NAME: PROJET,
  POSTGRES_PORT: String(PORT_POSTGRES),
  POWERSYNC_PORT: String(PORT_POWERSYNC),
  PS_JWKS_URI: `http://host.docker.internal:${String(PORT_API)}/.well-known/jwks.json`,
  PS_JWT_AUDIENCE: AUDIENCE,
};

function etape(message: string): void {
  console.log(`\n[e2e:synchro] ${message}`);
}

function executer(commande: string, args: readonly string[], options: SpawnSyncOptions = {}): string {
  const r = spawnSync(commande, args, { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });
  if (r.status !== 0) throw new Error(`${commande} ${args.join(' ')} : code ${String(r.status)}`);
  return String(r.stdout);
}

function compose(args: readonly string[]): void {
  executer('docker', ['compose', ...args], { env: ENV_COMPOSE, stdio: 'inherit' });
}

async function attendre(url: string, delaiMs: number): Promise<void> {
  const fin = Date.now() + delaiMs;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // Pas encore prêt.
    }
    if (Date.now() > fin) throw new Error(`${url} ne répond pas après ${String(delaiMs)} ms`);
    await new Promise((ok) => setTimeout(ok, 300));
  }
}

let api: ChildProcess | null = null;
let arretEnCours = false;

function arreter(): void {
  if (arretEnCours) return;
  arretEnCours = true;
  etape('arrêt de l’API et des conteneurs');
  api?.kill('SIGTERM');
  spawnSync('docker', ['compose', 'down', '-v', '--remove-orphans'], { cwd: RACINE, env: ENV_COMPOSE, stdio: 'inherit' });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    arreter();
    process.exit(130);
  });
}

let code = 1;
try {
  etape('Postgres (wal_level=logical)');
  compose(['up', '-d', '--wait', 'postgres']);

  etape('migrations');
  executer('pnpm', ['--filter', '@planif/db', 'migrer'], { env: { ...process.env, DATABASE_URL: URL_BASE }, stdio: 'inherit' });

  const cles = process.env.JWT_CLES_PRIVEES ?? executer(process.execPath, ['apps/api/src/generer-cles.ts', 'cle-e2e-synchro']).trim();
  const envApi: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: URL_BASE,
    JWT_CLES_PRIVEES: cles,
    JWT_EMETTEUR: EMETTEUR,
    JWT_AUDIENCE: AUDIENCE,
    PORT: String(PORT_API),
    COURRIEL_CONSOLE: '1',
    CORS_ORIGINES: ORIGINE_PAGE,
  };

  etape(`API sur ${URL_API}`);
  api = spawn(process.execPath, ['apps/api/src/index.ts'], { cwd: RACINE, env: envApi, stdio: 'inherit' });
  await attendre(`${URL_API}/sante`, 30_000);

  etape(`service PowerSync sur ${URL_POWERSYNC}`);
  compose(['up', '-d', '--wait', 'powersync']);

  etape('Playwright');
  const r = spawnSync('pnpm', ['--filter', '@planif/web', 'exec', 'playwright', 'test', '-c', 'playwright.synchro.config.ts'], {
    cwd: RACINE,
    stdio: 'inherit',
    env: { ...envApi, API_URL: URL_API, POWERSYNC_URL: URL_POWERSYNC },
  });
  code = r.status ?? 1;
  if (code !== 0) {
    etape('journal du service PowerSync (fin)');
    spawnSync('docker', ['compose', 'logs', '--tail', '60', 'powersync'], { cwd: RACINE, env: ENV_COMPOSE, stdio: 'inherit' });
  }
} catch (erreur) {
  console.error(`[e2e:synchro] ${erreur instanceof Error ? erreur.message : String(erreur)}`);
} finally {
  arreter();
}
process.exit(code);

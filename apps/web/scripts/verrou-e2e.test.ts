/**
 * Tests d'acceptation T33 — un seul jeu e2e à la fois sur la machine (scripts/verrou-e2e.sh).
 *
 * Contrat pour le développeur :
 *
 *   - `scripts/verrou-e2e.sh CMD [ARGS…]` prend un verrou `flock` sur `${TMPDIR:-/tmp}/planifications-e2e.lock`,
 *     puis exécute CMD et renvoie son code de sortie tel quel.
 *   - Si le verrou est déjà pris, le script affiche tout de suite « en attente d'un autre jeu e2e ».
 *   - Délai maximal : 30 minutes (constante dans le script). Pour les tests, la variable
 *     `VERROU_E2E_DELAI_S` (en secondes) remplace ce délai ; ici elle vaut 2.
 *     Au-delà du délai, le script s'arrête avec un message contenant « délai », code non nul, et
 *     ne lance PAS CMD.
 *
 * Les tests utilisent un dossier temporaire propre à chaque test (via TMPDIR), pour ne jamais
 * toucher au vrai verrou de la machine.
 *
 * Emplacement : `apps/web/scripts/`, car le `vitest.config.ts` racine ne collecte que les paquets
 * `packages/*` et `apps/*` ; le dossier racine `scripts/` n'est pas collecté par `pnpm test`.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = join(RACINE, 'scripts', 'verrou-e2e.sh');
const NOM_VERROU = 'planifications-e2e.lock';
const MESSAGE_ATTENTE = "en attente d'un autre jeu e2e";

let dossierTemporaire: string;
let detenteur: ChildProcess | undefined;

function environnement(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: dossierTemporaire };
  delete env.VERROU_E2E_DELAI_S;
  return { ...env, ...extra };
}

function lancerScript(args: string[], extra: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    env: environnement(extra),
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/** Tient le verrou depuis un autre processus jusqu'à la fin du test. Attend qu'il soit pris. */
function tenirVerrou(): Promise<void> {
  const chemin = join(dossierTemporaire, NOM_VERROU);
  return new Promise((aboutir, echouer) => {
    detenteur = spawn('flock', [chemin, 'sh', '-c', 'echo pris; sleep 10'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    detenteur.stdout?.on('data', (morceau: Buffer) => {
      if (morceau.toString().includes('pris')) aboutir();
    });
    detenteur.once('error', echouer);
  });
}

beforeEach(() => {
  dossierTemporaire = mkdtempSync(join(tmpdir(), 'verrou-e2e-test-'));
});

afterEach(() => {
  if (detenteur?.pid !== undefined) {
    // Le groupe entier (flock + sleep) : sinon `sleep` garderait le verrou encore 10 s.
    try {
      process.kill(-detenteur.pid, 'SIGKILL');
    } catch {
      // déjà terminé
    }
  }
  detenteur = undefined;
  rmSync(dossierTemporaire, { recursive: true, force: true });
});

describe('scripts/verrou-e2e.sh — sans concurrence', () => {
  it('exécute la commande et renvoie 0 quand elle réussit', () => {
    const r = lancerScript(['true']);
    expect(r.status).toBe(0);
  });

  it('renvoie 1 quand la commande échoue', () => {
    const r = lancerScript(['false']);
    expect(r.status).toBe(1);
  });

  it('transmet le code de sortie de la commande tel quel (3)', () => {
    const r = lancerScript(['sh', '-c', 'exit 3']);
    expect(r.status).toBe(3);
  });

  it('n\'affiche pas le message d\'attente quand le verrou est libre', () => {
    const r = lancerScript(['true']);
    expect(`${r.stdout}${r.stderr}`).not.toContain(MESSAGE_ATTENTE);
  });
});

describe('scripts/verrou-e2e.sh — verrou tenu par un autre processus', () => {
  it(
    'affiche le message d\'attente, puis échoue au délai sans lancer la commande',
    async () => {
      await tenirVerrou();
      const marqueur = join(dossierTemporaire, 'commande-executee');

      const debut = Date.now();
      const r = lancerScript(['sh', '-c', `touch ${marqueur}`], { VERROU_E2E_DELAI_S: '2' });
      const duree = Date.now() - debut;

      const sortie = `${r.stdout}${r.stderr}`;
      expect(sortie).toContain(MESSAGE_ATTENTE);
      expect(r.status).not.toBe(0);
      expect(sortie).toContain('délai');
      expect(duree).toBeGreaterThanOrEqual(1900);
      expect(existsSync(marqueur)).toBe(false);
    },
    30_000,
  );
});

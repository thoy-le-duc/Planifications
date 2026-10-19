/**
 * T45 : la CI en jobs parallèles, sans perdre aucune vérification.
 *
 * ── Ce qui est attendu de `.github/workflows/ci.yml` ────────────────────────────────────────
 *
 * - Workflow « CI » (nom lu par le workflow des migrations de production, T44), déclenché par
 *   `push` et `workflow_dispatch`, `concurrency` inchangée (lancements dépassés annulés).
 * - Plusieurs jobs sans `needs` entre eux (ils tournent en même temps), chacun avec son checkout,
 *   pnpm, Node avec cache pnpm et `pnpm install --frozen-lockfile`.
 * - Un job final « CI verte » qui dépend de tous les autres, tourne même si l'un échoue
 *   (`always()`), et échoue si l'un d'eux n'a pas conclu `success`.
 * - Exactement les commandes de l'ancien ci.yml (liste figée ci-dessous) : aucune perdue, aucune
 *   ajoutée. Seule variante admise : `pnpm e2e` découpé en parts (`--shard=${{ matrix.shard }}/N`),
 *   la matrice couvrant alors les parts 1 à N.
 * - Chaque job prépare ce dont il a besoin, avant de s'en servir : images Docker avant Postgres et
 *   avant la synchro, Postgres en wal_level=logical avant `pnpm test`, Chromium avant chaque jeu
 *   Playwright, builds avant les e2e qui les servent.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const CHEMIN_CI = `${RACINE}.github/workflows/ci.yml`;
const CHEMIN_BOUCLE = `${RACINE}docs/boucle.md`;

type Objet = Record<string, unknown>;

function objet(valeur: unknown, quoi: string): Objet {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) throw new Error(`${quoi} : objet attendu`);
  return valeur as Objet;
}

function lireTexte(chemin: string): string {
  return existsSync(chemin) ? readFileSync(chemin, 'utf8') : '';
}

interface Etape {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Objet;
  readonly with?: Objet;
}

interface Job {
  readonly id: string;
  readonly brut: Objet;
  readonly etapes: readonly Etape[];
}

function lireJobs(workflow: Objet): Job[] {
  return Object.entries(objet(workflow.jobs ?? {}, 'jobs')).map(([id, valeur]) => {
    const brut = objet(valeur, id);
    const liste: unknown = brut.steps ?? [];
    if (!Array.isArray(liste)) throw new Error(`${id}.steps : liste attendue`);
    return { id, brut, etapes: liste.map((e: unknown) => objet(e, `${id} : étape`) as Etape) };
  });
}

function besoins(job: Job): string[] {
  const needs: unknown = job.brut.needs;
  if (needs === undefined) return [];
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs)) return needs.map(String);
  throw new Error(`${job.id}.needs : texte ou liste attendu`);
}

/** Commande normalisée : espaces de fin retirés, `pnpm e2e --shard=…/N` ramené à `pnpm e2e`. */
const PART_E2E = /^pnpm e2e --shard=\$\{\{ matrix\.shard \}\}\/(\d+)$/;
function normaliser(run: string): string {
  const texte = run.trim();
  return PART_E2E.test(texte) ? 'pnpm e2e' : texte;
}

// ── Liste figée : les commandes de l'ancien ci.yml (un seul job, avant T45) ────────────────────

const TIRER_IMAGES = `tirer() {
  for essai in 1 2 3; do
    for source in "$1" "public.ecr.aws/docker/library/$1" "mirror.gcr.io/library/$1" "mirror.gcr.io/$1"; do
      if docker pull -q "$source"; then
        [ "$source" = "$1" ] || docker tag "$source" "$1"
        return 0
      fi
    done
    sleep $((essai * 20))
  done
  return 1
}
tirer "$POSTGRES_IMAGE"
tirer "$POWERSYNC_IMAGE"`;

const POSTGRES_LOGIQUE = `docker run -d --name postgres -p 5432:5432 \\
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \\
  --health-cmd "pg_isready -U postgres" --health-interval 2s --health-timeout 5s --health-retries 30 \\
  "$POSTGRES_IMAGE" -c wal_level=logical
timeout 90 sh -c 'until [ "$(docker inspect -f "{{.State.Health.Status}}" postgres)" = healthy ]; do sleep 1; done'`;

const SCHEMA_SYNCHRONISE = `# </dev/null : une question interactive (renommage de colonne ?) échoue au lieu d'attendre.
sortie="$(pnpm --filter @planif/db exec drizzle-kit generate </dev/null 2>&1)" || true
echo "$sortie"
if ! grep -q "No schema changes" <<<"$sortie"; then
  echo "::error::drizzle-kit generate n'a pas conclu « No schema changes » : schéma et migrations désynchronisés, ou question interactive (renommage)."
  exit 1
fi
if [ -n "$(git status --porcelain -- packages/db/migrations)" ]; then
  echo "::error::Le schéma Drizzle a changé sans migration : lancer pnpm --filter @planif/db generer et versionner le résultat."
  git status --porcelain -- packages/db/migrations
  exit 1
fi`;

const INSTALLER_CHROMIUM = 'pnpm --filter @planif/web exec playwright install --with-deps chromium';

const COMMANDES_AVANT_T45: readonly string[] = [
  TIRER_IMAGES,
  POSTGRES_LOGIQUE,
  'pnpm install --frozen-lockfile',
  'pnpm typecheck',
  'pnpm lint',
  SCHEMA_SYNCHRONISE,
  'pnpm test',
  'pnpm build',
  'pnpm build:essais',
  'pnpm budget',
  INSTALLER_CHROMIUM,
  'pnpm e2e',
  'pnpm build:demo',
  'pnpm e2e:demo',
  'pnpm e2e:synchro',
];

const ACTIONS_AVANT_T45: readonly string[] = ['actions/checkout@v7', 'pnpm/action-setup@v6', 'actions/setup-node@v7'];

const IMAGE_POWERSYNC = 'journeyapps/powersync-service:1.26.1';
const IMAGE_POSTGRES = 'postgres:17';
const URL_BASE_CI = 'postgres://postgres:postgres@localhost:5432/postgres';

// ─────────────────────────────────────────────────────────────────────────────────────────────

const ci = ((): Objet => {
  const document: unknown = parse(lireTexte(CHEMIN_CI));
  return document === null ? {} : objet(document, CHEMIN_CI);
})();
const tous = lireJobs(ci);
function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur : '';
}
const final = tous.find((job) => besoins(job).length > 0 && texte(job.brut.if).includes('always()'));
const verifications = tous.filter((job) => job !== final);

function indice(job: Job, predicat: (etape: Etape) => boolean): number {
  return job.etapes.findIndex(predicat);
}
function indiceRun(job: Job, commande: string): number {
  return indice(job, (e) => e.run !== undefined && normaliser(e.run) === commande);
}
function jobAvec(commande: string): Job[] {
  return verifications.filter((job) => indiceRun(job, commande) >= 0);
}
function envDe(job: Job): Objet {
  return objet(job.brut.env ?? {}, `${job.id}.env`);
}

describe('T45 : ci.yml, en-tête inchangé', () => {
  it('garde le nom « CI », les déclencheurs et la concurrence', () => {
    expect(ci.name).toBe('CI');
    expect(Object.keys(objet(ci.on ?? {}, 'on')).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(ci.concurrency).toEqual({ group: 'ci-${{ github.ref }}', 'cancel-in-progress': true });
  });
});

describe('T45 : jobs parallèles', () => {
  it('au moins cinq jobs de vérification, aucun ne dépend d’un autre', () => {
    expect(verifications.length).toBeGreaterThanOrEqual(5);
    for (const job of verifications) expect(besoins(job), job.id).toEqual([]);
  });

  it('chaque job installe tout lui-même, avec son cache pnpm', () => {
    for (const job of verifications) {
      const usages = job.etapes.map((e) => e.uses).filter((u): u is string => u !== undefined);
      expect(usages, job.id).toEqual(ACTIONS_AVANT_T45);
      const node = job.etapes.find((e) => e.uses === 'actions/setup-node@v7');
      expect(node?.with, job.id).toEqual({ 'node-version-file': '.node-version', cache: 'pnpm' });
      const installation = indiceRun(job, 'pnpm install --frozen-lockfile');
      expect(installation, job.id).toBeGreaterThan(indice(job, (e) => e.uses === 'actions/setup-node@v7'));
      // Toute commande pnpm vient après l'installation.
      job.etapes.forEach((e, i) => {
        if (e.run !== undefined && /^pnpm (?!install)/.test(e.run.trim())) expect(i, `${job.id} : ${e.run}`).toBeGreaterThan(installation);
      });
    }
  });

  it('chaque job a un nom et une limite de durée', () => {
    for (const job of verifications) {
      expect(typeof job.brut.name, job.id).toBe('string');
      expect(typeof job.brut['timeout-minutes'], job.id).toBe('number');
    }
  });
});

describe('T45 : aucune vérification perdue ni ajoutée', () => {
  const commandes = verifications.flatMap((job) => job.etapes.flatMap((e) => (e.run === undefined ? [] : [normaliser(e.run)])));

  it('même ensemble de commandes que l’ancien ci.yml', () => {
    expect([...new Set(commandes)].sort()).toEqual([...COMMANDES_AVANT_T45].sort());
  });

  it('chaque commande de vérification tourne une seule fois (hors installations et builds partagés)', () => {
    for (const commande of ['pnpm typecheck', 'pnpm lint', SCHEMA_SYNCHRONISE, 'pnpm test', 'pnpm e2e:demo', 'pnpm e2e:synchro', 'pnpm build:demo']) {
      expect(jobAvec(commande).length, commande).toBe(1);
      expect(commandes.filter((c) => c === commande).length, commande).toBe(1);
    }
  });

  it('pnpm e2e : un seul job, entier ou découpé en parts 1 à N par la matrice', () => {
    const jobs = jobAvec('pnpm e2e');
    expect(jobs.length).toBe(1);
    const job = jobs[0];
    if (job === undefined) return;
    const run = job.etapes.find((e) => e.run !== undefined && normaliser(e.run) === 'pnpm e2e')?.run?.trim() ?? '';
    const part = PART_E2E.exec(run);
    if (part === null) {
      expect(run).toBe('pnpm e2e');
      return;
    }
    const n = Number(part[1]);
    const strategie = objet(job.brut.strategy ?? {}, `${job.id}.strategy`);
    const matrice = objet(strategie.matrix ?? {}, `${job.id}.strategy.matrix`);
    expect(matrice.shard).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    // Toutes les parts vont au bout : une part rouge n'annule pas les autres.
    expect(strategie['fail-fast']).toBe(false);
  });
});

describe('T45 : chaque job prépare ce dont il a besoin', () => {
  it('pnpm test : Postgres en wal_level=logical, démarré avant, DATABASE_URL et images posées', () => {
    for (const job of jobAvec('pnpm test')) {
      const images = indiceRun(job, TIRER_IMAGES);
      const postgres = indiceRun(job, POSTGRES_LOGIQUE);
      expect(images, job.id).toBeGreaterThanOrEqual(0);
      expect(postgres, job.id).toBeGreaterThan(images);
      expect(indiceRun(job, 'pnpm test'), job.id).toBeGreaterThan(postgres);
      expect(envDe(job)).toMatchObject({ DATABASE_URL: URL_BASE_CI, POWERSYNC_IMAGE: IMAGE_POWERSYNC, POSTGRES_IMAGE: IMAGE_POSTGRES });
    }
    expect(jobAvec('pnpm test').length).toBe(1);
  });

  it('pnpm e2e:synchro : images tirées d’avance (versions figées) et Chromium, avant', () => {
    for (const job of jobAvec('pnpm e2e:synchro')) {
      const synchro = indiceRun(job, 'pnpm e2e:synchro');
      expect(indiceRun(job, TIRER_IMAGES), job.id).toBeGreaterThanOrEqual(0);
      expect(indiceRun(job, TIRER_IMAGES), job.id).toBeLessThan(synchro);
      expect(indiceRun(job, INSTALLER_CHROMIUM), job.id).toBeGreaterThanOrEqual(0);
      expect(indiceRun(job, INSTALLER_CHROMIUM), job.id).toBeLessThan(synchro);
      expect(envDe(job)).toMatchObject({ POWERSYNC_IMAGE: IMAGE_POWERSYNC, POSTGRES_IMAGE: IMAGE_POSTGRES });
    }
  });

  it('les images ne sont tirées que là où POSTGRES_IMAGE et POWERSYNC_IMAGE sont posées', () => {
    for (const job of jobAvec(TIRER_IMAGES)) {
      expect(envDe(job), job.id).toMatchObject({ POWERSYNC_IMAGE: IMAGE_POWERSYNC, POSTGRES_IMAGE: IMAGE_POSTGRES });
    }
    for (const job of jobAvec(POSTGRES_LOGIQUE)) expect(indiceRun(job, TIRER_IMAGES), job.id).toBeGreaterThanOrEqual(0);
  });

  it('pnpm e2e : build, build des essais et budget de poids avant, Chromium installé', () => {
    for (const job of jobAvec('pnpm e2e')) {
      const e2e = indiceRun(job, 'pnpm e2e');
      const build = indiceRun(job, 'pnpm build');
      const essais = indiceRun(job, 'pnpm build:essais');
      expect(build, job.id).toBeGreaterThanOrEqual(0);
      expect(essais, job.id).toBeGreaterThan(build);
      expect(indiceRun(job, 'pnpm budget'), job.id).toBeGreaterThan(essais);
      expect(indiceRun(job, INSTALLER_CHROMIUM), job.id).toBeGreaterThanOrEqual(0);
      expect(indiceRun(job, INSTALLER_CHROMIUM), job.id).toBeLessThan(e2e);
      expect(e2e, job.id).toBeGreaterThan(essais);
    }
  });

  it('pnpm e2e:demo : build de la démo et Chromium avant', () => {
    for (const job of jobAvec('pnpm e2e:demo')) {
      const demo = indiceRun(job, 'pnpm e2e:demo');
      expect(indiceRun(job, 'pnpm build:demo'), job.id).toBeGreaterThanOrEqual(0);
      expect(indiceRun(job, 'pnpm build:demo'), job.id).toBeLessThan(demo);
      expect(indiceRun(job, INSTALLER_CHROMIUM), job.id).toBeGreaterThanOrEqual(0);
      expect(indiceRun(job, INSTALLER_CHROMIUM), job.id).toBeLessThan(demo);
    }
  });

  it('le budget de poids suit le build et n’est pas relevé dans ci.yml', () => {
    for (const job of jobAvec('pnpm budget')) expect(indiceRun(job, 'pnpm budget'), job.id).toBeGreaterThan(indiceRun(job, 'pnpm build'));
    expect(lireTexte(CHEMIN_CI)).not.toMatch(/BUDGET|budget\.json/);
  });
});

describe('T45 : job final « CI verte »', () => {
  it('existe, dépend de tous les autres jobs et tourne même si l’un échoue', () => {
    expect(final).toBeDefined();
    if (final === undefined) return;
    expect(final.brut.name).toBe('CI verte');
    expect([...besoins(final)].sort()).toEqual(verifications.map((job) => job.id).sort());
    expect(texte(final.brut.if)).toContain('always()');
    expect(final.etapes.every((e) => e.uses === undefined)).toBe(true);
  });

  const etape = final?.etapes.find((e) => e.run !== undefined);
  const script = etape?.run ?? '';

  it('lit le résultat de chaque job par needs.*.result', () => {
    expect(texte(etape?.env?.RESULTATS)).toMatch(/needs\.\*\.result/);
  });

  function conclure(resultats: string): number | null {
    return spawnSync('bash', ['-c', script], { env: { ...process.env, RESULTATS: resultats }, encoding: 'utf8' }).status;
  }

  it('vert seulement si tous les jobs ont conclu success', () => {
    expect(script).not.toBe('');
    expect(conclure('success success success success success')).toBe(0);
  });

  it.each([
    ['un échec', 'success failure success success success'],
    ['un job annulé', 'success success cancelled success success'],
    ['un job sauté', 'skipped success success success success'],
    ['aucun résultat', ''],
  ])('rouge sur %s', (_, resultats) => {
    expect(script).not.toBe('');
    expect(conclure(resultats)).not.toBe(0);
  });
});

describe('T45 : docs/boucle.md', () => {
  const boucle = lireTexte(CHEMIN_BOUCLE);

  it('Fusion : remarques de relecture corrigées dans la PR, petites demandes regroupées', () => {
    expect(boucle).toMatch(/dans la PR du ticket, avant la fusion/);
    expect(boucle).toMatch(/regroupées en un seul ticket/);
  });

  it('Budget : dernière jauge 20 % le lundi 19 octobre 2026', () => {
    expect(boucle).toContain('20 % le lundi 19 octobre 2026');
  });
});

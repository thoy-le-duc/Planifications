/**
 * T67 : règles de synchro PowerSync déployées automatiquement après « Migrations de production ».
 *
 * ── Ce qui est attendu ──────────────────────────────────────────────────────────────────────
 *
 * - `.github/workflows/regles-powersync.yml`, workflow « Règles de synchro PowerSync » :
 *   déclenché seulement par `workflow_run` (workflow « Migrations de production », branche `main`,
 *   terminé) et par `workflow_dispatch` ; le job ne tourne que si les migrations ont conclu
 *   `success` sur `main` dans ce dépôt (pas un fork), ou à la main depuis `main`. Environnement
 *   `production`, permissions `contents: read`, une seule exécution à la fois sans annulation,
 *   actions épinglées comme dans ci.yml, pas d'identifiants git gardés. Deux étapes : valider,
 *   puis déployer (aucune n'est `continue-on-error`). Secrets lus : POWERSYNC_ADMIN_TOKEN et
 *   POWERSYNC_INSTANCE_ID, seulement dans ces deux étapes.
 * - `scripts/deployer-regles-powersync.sh valider|deployer` :
 *   - les deux secrets absents ou vides : « secrets POWERSYNC_ADMIN_TOKEN et POWERSYNC_INSTANCE_ID
 *     absents : rien à faire, voir docs/mise-en-ligne.md », sortie 0 ; jamais de repli sur
 *     PS_ADMIN_TOKEN ou INSTANCE_ID déjà posés dans l'environnement ;
 *   - un seul des deux : refus en non-zéro qui nomme celui qui manque ;
 *   - secret mal formé (identifiant d'instance hors BSON ObjectID de 24 caractères hexadécimaux,
 *     jeton avec blanc ou caractère non imprimable) : refus en non-zéro qui le nomme, sans
 *     jamais afficher sa valeur, et sans lancer la CLI ;
 *   - sinon : `pnpm --dir scripts/powersync-cli exec powersync deploy sync-config
 *     --directory=<racine>/powersync`, avec `--dry-run` pour valider, sans pour déployer ; la CLI
 *     reçoit PS_ADMIN_TOKEN et INSTANCE_ID, jamais API_URL (contexte auto-hébergé) ni les
 *     variables POWERSYNC_* d'origine ; un refus de la CLI sort en non-zéro.
 *
 * T74 (ces points remplacent, pour l'organisation et le projet, ce que T73 faisait) :
 * - la CLI 0.10.2 ne lit `org_id` et `project_id` que dans le `cli.yaml` du dossier de projet
 *   (CloudInstanceCommand.loadProject) : avec les deux identifiants, le script copie `powersync/` dans
 *   un dossier temporaire, y écrit un `cli.yaml` (type, instance_id, org_id, project_id : jamais le
 *   jeton) et lance la CLI avec `--directory` sur cette copie, supprimée à la sortie. `powersync/`
 *   n'est jamais touché. Sans les deux : dossier du dépôt, comme avant ;
 * - la CLI en échec : le script lance `powersync fetch instances` et conclut (jeton refusé, instance
 *   invisible du jeton, ou jeton hors de cause), sans jamais afficher le jeton.
 *
 * Relecture (PR #222) :
 * - chaîne d'approvisionnement : plus de `pnpm dlx` (dépendances transitives résolues à chaque
 *   exécution). La CLI est une devDependency exacte de `scripts/powersync-cli/package.json`, avec
 *   son propre `pnpm-lock.yaml` (hors de l'espace de travail : l'appli, son build et toutes les
 *   autres installations n'en sont pas touchés), installée par le workflow avec
 *   `--frozen-lockfile --ignore-scripts`, dans une étape qui ne voit aucun secret ;
 * - déclencheur : la conclusion `success` ne suffit pas, l'exécution des migrations doit venir de
 *   `workflow_run` (la CI de main) ou de `workflow_dispatch`. Pas `push` : « Migrations de
 *   production » n'a jamais de déclencheur push, son `workflow_run.event` vaut `workflow_run`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const CHEMIN_WORKFLOW = `${RACINE}.github/workflows/regles-powersync.yml`;
const CHEMIN_MIGRATIONS = `${RACINE}.github/workflows/migrations-production.yml`;
const CHEMIN_CI = `${RACINE}.github/workflows/ci.yml`;
const CHEMIN_SCRIPT = `${RACINE}scripts/deployer-regles-powersync.sh`;
const CHEMIN_GUIDE = `${RACINE}docs/mise-en-ligne.md`;
const DOSSIER_CLI = `${RACINE}scripts/powersync-cli/`;
const MESSAGE_ABSENT =
  'secrets POWERSYNC_ADMIN_TOKEN et POWERSYNC_INSTANCE_ID absents : rien à faire, voir docs/mise-en-ligne.md';
const SECRETS = ['POWERSYNC_ADMIN_TOKEN', 'POWERSYNC_INSTANCE_ID'];
// T73 : variables (non secrètes) de l'environnement production.
const VARIABLES = ['POWERSYNC_ORG_ID', 'POWERSYNC_PROJECT_ID'];

type Objet = Record<string, unknown>;

function objet(valeur: unknown, quoi: string): Objet {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) throw new Error(`${quoi} : objet attendu`);
  return valeur as Objet;
}

function lireTexte(chemin: string): string {
  return existsSync(chemin) ? readFileSync(chemin, 'utf8') : '';
}

function lireYaml(chemin: string): Objet {
  const document: unknown = parse(lireTexte(chemin));
  return document === null || document === undefined ? {} : objet(document, chemin);
}

interface Etape {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Objet;
  readonly with?: Objet;
  readonly 'continue-on-error'?: unknown;
}

function jobs(workflow: Objet): [string, Objet][] {
  return Object.entries(objet(workflow.jobs ?? {}, 'jobs')).map(([nom, job]) => [nom, objet(job, nom)]);
}

function etapes(workflow: Objet): Etape[] {
  return jobs(workflow).flatMap(([, job]) => {
    const liste: unknown = job.steps;
    if (!Array.isArray(liste)) throw new Error('steps : liste attendue');
    return liste.map((etape: unknown) => objet(etape, 'étape') as Etape);
  });
}

describe('T67 : workflow « Règles de synchro PowerSync »', () => {
  const texte = lireTexte(CHEMIN_WORKFLOW);
  const workflow = lireYaml(CHEMIN_WORKFLOW);
  const migrations = lireYaml(CHEMIN_MIGRATIONS);
  const ci = lireYaml(CHEMIN_CI);

  it('porte un nom clair', () => {
    expect(workflow.name).toBe('Règles de synchro PowerSync');
  });

  it('ne se déclenche qu’après les migrations de production sur main, ou à la main', () => {
    const declencheurs = objet(workflow.on ?? {}, 'on');
    expect(Object.keys(declencheurs).sort()).toEqual(['workflow_dispatch', 'workflow_run']);
    const suite = objet(declencheurs.workflow_run ?? {}, 'workflow_run');
    expect(migrations.name).toBe('Migrations de production');
    expect(suite.workflows).toEqual([migrations.name]);
    expect(suite.types).toEqual(['completed']);
    expect(suite.branches).toEqual(['main']);
    expect(suite).not.toHaveProperty('branches-ignore');
  });

  it('n’a aucun déclencheur de PR, de push ni de planning (dépôt public)', () => {
    expect(texte).not.toBe('');
    expect(texte).not.toMatch(/pull_request/);
    const declencheurs = objet(workflow.on ?? {}, 'on');
    for (const interdit of ['push', 'schedule', 'pull_request', 'pull_request_target', 'repository_dispatch']) {
      expect(declencheurs).not.toHaveProperty(interdit);
    }
  });

  it('ne lance le job qu’après des migrations réussies sur main, dans ce dépôt, ou à la main depuis main', () => {
    const liste = jobs(workflow);
    expect(liste.length).toBe(1);
    const [, job] = liste[0] ?? ['', {}];
    const condition = typeof job.if === 'string' ? job.if : '';
    expect(condition).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(condition).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(condition).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    expect(condition).toContain("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    // Relecture : l'exécution des migrations elle-même vient de la CI de main ou d'un lancement à la main.
    expect(condition).toContain(
      "(github.event.workflow_run.event == 'workflow_run' || github.event.workflow_run.event == 'workflow_dispatch')",
    );
  });

  it('tourne dans l’environnement production (secrets réservés à main)', () => {
    for (const [, job] of jobs(workflow)) {
      const environnement: unknown = job.environment;
      const nom = typeof environnement === 'string' ? environnement : objet(environnement ?? {}, 'environment').name;
      expect(nom).toBe('production');
    }
    expect(jobs(workflow).length).toBe(1);
  });

  it('a des permissions minimales : contents: read, nulle part élargies', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const [, job] of jobs(workflow)) {
      if ('permissions' in job) expect(job.permissions).toEqual({ contents: 'read' });
    }
  });

  it('ne déploie qu’une fois à la fois, sans annuler le déploiement en cours', () => {
    const concurrence = objet(workflow.concurrency ?? {}, 'concurrency');
    expect(typeof concurrence.group).toBe('string');
    expect(String(concurrence.group)).not.toContain('${{');
    expect(concurrence['cancel-in-progress']).toBe(false);
  });

  it('épingle ses actions par version, comme ci.yml', () => {
    const versionsCi = new Map<string, string>();
    for (const etape of etapes(ci)) {
      if (etape.uses === undefined) continue;
      const [action = '', version = ''] = etape.uses.split('@');
      versionsCi.set(action, version);
    }
    const utilisees = etapes(workflow).filter((etape) => etape.uses !== undefined);
    expect(utilisees.length).toBeGreaterThan(0);
    for (const etape of utilisees) {
      const [action = '', version = ''] = (etape.uses ?? '').split('@');
      expect(version, etape.uses).toMatch(/^v\d+$/);
      expect(versionsCi.get(action), `${action} : même version que ci.yml`).toBe(version);
    }
  });

  it('extrait le commit validé, sans garder les identifiants git', () => {
    const checkout = etapes(workflow).find((etape) => etape.uses?.startsWith('actions/checkout@'));
    expect(checkout).toBeDefined();
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    expect(checkout?.with?.ref).toBe('${{ github.event.workflow_run.head_sha || github.sha }}');
  });

  it('valide d’abord, déploie ensuite, et passe au rouge si les règles sont refusées', () => {
    const commandes = etapes(workflow).map((etape) => etape.run?.trim() ?? '');
    const valider = commandes.indexOf('bash scripts/deployer-regles-powersync.sh valider');
    const deployer = commandes.indexOf('bash scripts/deployer-regles-powersync.sh deployer');
    expect(valider).toBeGreaterThanOrEqual(0);
    expect(deployer).toBeGreaterThan(valider);
    for (const etape of etapes(workflow)) expect(etape['continue-on-error'], etape.name).toBeUndefined();
    for (const [, job] of jobs(workflow)) expect(job['continue-on-error']).toBeUndefined();
  });

  it('installe la CLI figée par son lockfile, sans script d’installation, avant toute étape à secret', () => {
    const liste = etapes(workflow);
    const commandes = liste.map((etape) => etape.run?.trim() ?? '');
    const installation = commandes.indexOf(
      'pnpm --dir scripts/powersync-cli install --frozen-lockfile --ignore-workspace --ignore-scripts',
    );
    expect(installation).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(liste[installation] ?? {})).not.toContain('secrets.');
    const premiereASecret = liste.findIndex((etape) => JSON.stringify(etape).includes('secrets.'));
    expect(installation).toBeLessThan(premiereASecret);
    // Aucune autre installation (ni dlx, ni npx) : le seul code tiers lancé est celui du lockfile.
    for (const commande of commandes) expect(commande).not.toMatch(/\bdlx\b|\bnpx\b|pnpm install(?! --frozen-lockfile)/);
  });

  it('lit seulement les deux secrets PowerSync, et seulement dans les étapes du script', () => {
    const references = [...new Set(texte.match(/secrets\.[A-Za-z_]+/g) ?? [])].sort();
    expect(references).toEqual(SECRETS.map((nom) => `secrets.${nom}`));
    const avecSecret = etapes(workflow).filter((etape) => JSON.stringify(etape).includes('secrets.'));
    expect(avecSecret.length).toBe(2);
    for (const etape of avecSecret) {
      expect(etape.run?.trim()).toMatch(/^bash scripts\/deployer-regles-powersync\.sh (valider|deployer)$/);
      for (const nom of SECRETS) expect(etape.env?.[nom]).toBe(`\${{ secrets.${nom} }}`);
    }
  });

  it('T73 : passe l’organisation et le projet en variables (pas en secrets) aux deux étapes du script', () => {
    const references = [...new Set(texte.match(/vars\.[A-Za-z_]+/g) ?? [])].sort();
    expect(references).toEqual(VARIABLES.map((nom) => `vars.${nom}`));
    const avecScript = etapes(workflow).filter((etape) => etape.run?.includes('deployer-regles-powersync.sh'));
    expect(avecScript.length).toBe(2);
    for (const etape of avecScript) {
      for (const nom of VARIABLES) expect(etape.env?.[nom]).toBe(`\${{ vars.${nom} }}`);
    }
  });

  it('n’a aucune commande qui affiche les secrets', () => {
    expect(etapes(workflow).length).toBeGreaterThan(0);
    for (const etape of etapes(workflow)) {
      const commande = etape.run ?? '';
      expect(commande, etape.name).not.toMatch(/POWERSYNC_|PS_ADMIN_TOKEN|INSTANCE_ID/);
      expect(commande, etape.name).not.toMatch(/\bprintenv\b|\benv\b|set -x|\bdeclare -p\b|\bexport -p\b/);
    }
    expect(JSON.stringify(workflow.env ?? {})).not.toContain('secrets.');
    for (const [, job] of jobs(workflow)) expect(JSON.stringify(job.env ?? {})).not.toContain('secrets.');
  });
});

// ── Le script ───────────────────────────────────────────────────────────────────────────────

const INSTANCE_FACTICE = '0123456789abcdef01234567';
const JETON_FACTICE = 'jeton-factice-t67-0123456789abcdef';
const ORG_FACTICE = '1123456789abcdef01234567';
const PROJET_FACTICE = '2123456789abcdef01234567';

/** Environnement du test, sans aucune variable que le script ou la CLI pourrait lire. */
function environnementSans(): NodeJS.ProcessEnv {
  const retirees = new Set([...SECRETS, ...VARIABLES, 'PS_ADMIN_TOKEN', 'INSTANCE_ID', 'API_URL', 'ORG_ID', 'PROJECT_ID']);
  return Object.fromEntries(Object.entries(process.env).filter(([nom]) => !retirees.has(nom)));
}

const dossiers: string[] = [];
afterEach(() => {
  for (const dossier of dossiers.splice(0)) rmSync(dossier, { recursive: true, force: true });
});

/** Ce que le faux `powersync fetch instances` fait : code de sortie, JSON écrit, avertissement. */
interface FauxFetch {
  readonly code?: number;
  /** Instances visibles : identifiants d'organisation, de projet, d'instance. */
  readonly visibles?: readonly (readonly [string, string, string])[];
  /** Comme la vraie CLI : l'échec est avalé en avertissement, la sortie reste 0 et la liste est vide. */
  readonly avertissement?: string;
}

interface FauxPnpm {
  readonly env: NodeJS.ProcessEnv;
  /** Un appel par ligne : arguments, puis ce que la CLI a reçu (sans jamais écrire les valeurs). */
  appels(): string[];
  /** Dossier passé à `--directory` au dernier déploiement (vide si aucun). */
  dernierDossier(): string;
}

function jsonInstances(visibles: readonly (readonly [string, string, string])[]): string {
  const organisations: Record<string, { id: string; name: string; projects: Record<string, unknown> }> = {};
  for (const [org, projet, instance] of visibles) {
    const o = (organisations[org] ??= { id: org, name: 'Organisation', projects: {} });
    const p = (o.projects[projet] ??= { id: projet, name: 'Projet', instances: [] }) as { instances: unknown[] };
    p.instances.push({ id: instance, name: 'Instance', has_config: true, deployable: true });
  }
  return JSON.stringify({ cloudInstances: organisations, linkedInstances: [] });
}

/** Un faux `pnpm` en tête du PATH : note ses arguments et sort avec `code` (le déploiement) ou selon `fetch`. */
function fauxPnpm(code: number, fetch: FauxFetch = {}): FauxPnpm {
  const dossier = mkdtempSync(join(tmpdir(), 't67-pnpm-'));
  dossiers.push(dossier);
  const journal = join(dossier, 'appels.txt');
  const dernier = join(dossier, 'dernier-dossier.txt');
  writeFileSync(journal, '');
  writeFileSync(dernier, '');
  const jsonFetch = join(dossier, 'instances.json');
  writeFileSync(jsonFetch, jsonInstances(fetch.visibles ?? [[ORG_FACTICE, PROJET_FACTICE, INSTANCE_FACTICE]]));
  const faux = join(dossier, 'pnpm');
  writeFileSync(
    faux,
    `#!/usr/bin/env bash
export LC_ALL=C
jeton=non; [ "\${PS_ADMIN_TOKEN:-}" = "${JETON_FACTICE}" ] && jeton=oui
instance=non; [ "\${INSTANCE_ID:-}" = "${INSTANCE_FACTICE}" ] && instance=oui
api=non; [ -n "\${API_URL:-}" ] && api=oui
brut=non; [ -n "\${POWERSYNC_ADMIN_TOKEN:-}\${POWERSYNC_INSTANCE_ID:-}\${POWERSYNC_ORG_ID:-}\${POWERSYNC_PROJECT_ID:-}" ] && brut=oui
etat="jeton=$jeton instance=$instance api_url=$api brut=$brut org=\${ORG_ID:-non} projet=\${PROJECT_ID:-non}"
args=(); dossier_cli=""; sortie=""
for a in "$@"; do
  case "$a" in
    --directory=*) dossier_cli="\${a#--directory=}"; args+=("--directory=<dossier>") ;;
    --output-file=*) sortie="\${a#--output-file=}"; args+=("--output-file=<fichier>") ;;
    *) args+=("$a") ;;
  esac
done
if [[ " $* " == *" fetch instances "* ]]; then
  printf '%s | %s\\n' "\${args[*]}" "$etat" >> "${journal}"
  [ -n "$sortie" ] && cp "${jsonFetch}" "$sortie"
  ${fetch.avertissement === undefined ? ':' : `echo ' ›  Warning: Failed to fetch cloud instances: ${fetch.avertissement}' >&2; echo '{"cloudInstances":{},"linkedInstances":[]}' > "$sortie"`}
  exit ${String(fetch.code ?? 0)}
fi
if [ "$dossier_cli" = "${RACINE}powersync" ]; then
  nature="depot"; cli="aucun"; fichiers="-"
else
  nature="temporaire"; cli="aucun"; [ -f "$dossier_cli/cli.yaml" ] && cli="$(tr '\\n' ';' < "$dossier_cli/cli.yaml")"
  fichiers="$(ls -A "$dossier_cli" | tr '\\n' ',')"
  printf '%s' "$dossier_cli" > "${dernier}"
fi
printf '%s | %s dossier=%s cli=%s fichiers=%s\\n' "\${args[*]}" "$etat" "$nature" "$cli" "$fichiers" >> "${journal}"
exit ${String(code)}
`,
  );
  chmodSync(faux, 0o755);
  return {
    env: { ...environnementSans(), PATH: `${dossier}:${process.env.PATH ?? ''}` },
    appels: () =>
      readFileSync(journal, 'utf8')
        .split('\n')
        .filter((ligne) => ligne !== ''),
    dernierDossier: () => readFileSync(dernier, 'utf8'),
  };
}

function lancer(mode: string, env: NodeJS.ProcessEnv): { code: number | null; sortie: string } {
  const resultat = spawnSync('bash', [CHEMIN_SCRIPT, mode], { env, encoding: 'utf8', timeout: 30_000 });
  return { code: resultat.status, sortie: `${resultat.stdout}${resultat.stderr}` };
}

/** Version de la CLI figée dans scripts/powersync-cli/package.json (vide si absente). */
function versionCli(): string {
  const paquet = lireTexte(`${DOSSIER_CLI}package.json`);
  if (paquet === '') return '';
  const dependances = objet((JSON.parse(paquet) as Objet).devDependencies ?? {}, 'devDependencies');
  const version = dependances.powersync;
  return typeof version === 'string' ? version : '';
}

const APPEL_CLI = '--dir scripts/powersync-cli exec powersync deploy sync-config --directory=<dossier>';
const ETAT_CLI = 'jeton=oui instance=oui api_url=non brut=non org=non projet=non';
/** Sans organisation ni projet : le dossier du dépôt, sans cli.yaml. */
const LIGNE_DEPOT = `| ${ETAT_CLI} dossier=depot cli=aucun fichiers=-`;
const APPEL_FETCH = '--dir scripts/powersync-cli exec powersync fetch instances --output json --output-file=<fichier>';
/** Avec organisation et projet : la copie temporaire et son cli.yaml (jamais le jeton). */
const CLI_YAML = `type: cloud;instance_id: "${INSTANCE_FACTICE}";org_id: "${ORG_FACTICE}";project_id: "${PROJET_FACTICE}";`;
const LIGNE_LIEE = `| ${ETAT_CLI} dossier=temporaire cli=${CLI_YAML} fichiers=${[
  'cli.yaml',
  ...readdirSync(`${RACINE}powersync`),
]
  .sort()
  .map((nom) => `${nom},`)
  .join('')}`;
const LIGNE_FETCH = `| ${ETAT_CLI}`;

describe('T67 : scripts/deployer-regles-powersync.sh, sans secret', () => {
  for (const mode of ['valider', 'deployer']) {
    it(`${mode} : sans secret, message clair, sortie en succès, CLI non lancée`, () => {
      const pnpm = fauxPnpm(0);
      const { code, sortie } = lancer(mode, pnpm.env);
      expect(code).toBe(0);
      expect(sortie).toContain(MESSAGE_ABSENT);
      expect(pnpm.appels()).toEqual([]);
    });
  }

  it('secrets vides : même arrêt propre', () => {
    const pnpm = fauxPnpm(0);
    const { code, sortie } = lancer('valider', { ...pnpm.env, POWERSYNC_ADMIN_TOKEN: '', POWERSYNC_INSTANCE_ID: '' });
    expect(code).toBe(0);
    expect(sortie).toContain(MESSAGE_ABSENT);
    expect(pnpm.appels()).toEqual([]);
  });

  it('ne se rabat jamais sur PS_ADMIN_TOKEN ou INSTANCE_ID déjà posés', () => {
    const pnpm = fauxPnpm(0);
    const { code, sortie } = lancer('deployer', { ...pnpm.env, PS_ADMIN_TOKEN: JETON_FACTICE, INSTANCE_ID: INSTANCE_FACTICE });
    expect(code).toBe(0);
    expect(sortie).toContain(MESSAGE_ABSENT);
    expect(pnpm.appels()).toEqual([]);
  });
});

describe('T67 : scripts/deployer-regles-powersync.sh, secret incomplet ou mal formé', () => {
  it('un seul des deux secrets : refus qui nomme celui qui manque', () => {
    const pnpm = fauxPnpm(0);
    const sansInstance = lancer('valider', { ...pnpm.env, POWERSYNC_ADMIN_TOKEN: JETON_FACTICE });
    expect(sansInstance.code).not.toBe(0);
    expect(sansInstance.sortie).toContain('POWERSYNC_INSTANCE_ID absent');
    expect(sansInstance.sortie).not.toContain(JETON_FACTICE);
    const sansJeton = lancer('valider', { ...pnpm.env, POWERSYNC_INSTANCE_ID: INSTANCE_FACTICE });
    expect(sansJeton.code).not.toBe(0);
    expect(sansJeton.sortie).toContain('POWERSYNC_ADMIN_TOKEN absent');
    expect(pnpm.appels()).toEqual([]);
  });

  const instancesMalFormees = [
    'pas-un-identifiant-t67',
    '0123456789abcdef0123456', // 23 caractères
    '0123456789abcdef012345678', // 25 caractères
    '0123456789abcdef0123456z',
    ` ${INSTANCE_FACTICE}`,
    `${INSTANCE_FACTICE}\n`,
  ];
  for (const instance of instancesMalFormees) {
    it(`identifiant d’instance mal formé (${JSON.stringify(instance)}) : refus clair, sans la valeur`, () => {
      const pnpm = fauxPnpm(0);
      const { code, sortie } = lancer('deployer', {
        ...pnpm.env,
        POWERSYNC_ADMIN_TOKEN: JETON_FACTICE,
        POWERSYNC_INSTANCE_ID: instance,
      });
      expect(code).not.toBe(0);
      expect(sortie).toContain('POWERSYNC_INSTANCE_ID mal formé');
      expect(sortie).not.toContain(instance.trim());
      expect(sortie).not.toContain(JETON_FACTICE);
      expect(pnpm.appels()).toEqual([]);
    });
  }

  const jetonsMalFormes = ['jeton-t67 avec-espace-secret', 'jeton-t67-secret\n', '\tjeton-t67-secret', 'jeton-t67-é-secret'];
  for (const jeton of jetonsMalFormes) {
    it(`jeton mal formé (${JSON.stringify(jeton)}) : refus clair, sans jamais l’afficher`, () => {
      const pnpm = fauxPnpm(0);
      const { code, sortie } = lancer('valider', {
        ...pnpm.env,
        POWERSYNC_ADMIN_TOKEN: jeton,
        POWERSYNC_INSTANCE_ID: INSTANCE_FACTICE,
      });
      expect(code).not.toBe(0);
      expect(sortie).toContain('POWERSYNC_ADMIN_TOKEN mal formé');
      expect(sortie).not.toMatch(/jeton-t67/);
      expect(pnpm.appels()).toEqual([]);
    });
  }

  it('mode inconnu : refus, CLI non lancée', () => {
    const pnpm = fauxPnpm(0);
    const { code } = lancer('supprimer', { ...pnpm.env, POWERSYNC_ADMIN_TOKEN: JETON_FACTICE, POWERSYNC_INSTANCE_ID: INSTANCE_FACTICE });
    expect(code).not.toBe(0);
    expect(pnpm.appels()).toEqual([]);
  });
});

describe('T67 : scripts/deployer-regles-powersync.sh, avec la CLI', () => {
  const secrets = { POWERSYNC_ADMIN_TOKEN: JETON_FACTICE, POWERSYNC_INSTANCE_ID: INSTANCE_FACTICE };

  it('fige la CLI officielle : version exacte, lockfile pnpm, hors de l’espace de travail', () => {
    expect(versionCli()).toMatch(/^\d+\.\d+\.\d+$/);
    const paquet = JSON.parse(lireTexte(`${DOSSIER_CLI}package.json`)) as Objet;
    expect(paquet.private).toBe(true);
    expect(Object.keys(objet(paquet.devDependencies, 'devDependencies'))).toEqual(['powersync']);
    expect(paquet).not.toHaveProperty('dependencies');
    // Lockfile écrit par pnpm, qui fige toutes les dépendances transitives (intégrité comprise).
    const verrou = lireYaml(`${DOSSIER_CLI}pnpm-lock.yaml`);
    const importateur = objet(objet(verrou.importers ?? {}, 'importers')['.'] ?? {}, 'importer .');
    const entree = objet(objet(importateur.devDependencies ?? {}, 'devDependencies').powersync ?? {}, 'powersync');
    expect(entree.specifier).toBe(versionCli());
    // « 0.10.2 », éventuellement suivi des pairs résolus : « 0.10.2(@types/node@…) ».
    expect(String(entree.version)).toMatch(new RegExp(`^${versionCli().replaceAll('.', '\\.')}(\\(|$)`));
    const paquets = objet(verrou.packages ?? {}, 'packages');
    expect(Object.keys(paquets).length).toBeGreaterThan(1);
    for (const [nom, entree] of Object.entries(paquets)) {
      expect(String(objet(objet(entree, nom).resolution ?? {}, 'resolution').integrity), nom).toMatch(/^sha512-/);
    }
    // Hors de l'espace de travail : ni l'appli ni les autres installations ne l'emportent.
    const espace = lireYaml(`${RACINE}pnpm-workspace.yaml`);
    expect(espace.packages).toEqual(['apps/*', 'packages/*']);
    const script = lireTexte(CHEMIN_SCRIPT);
    expect(script).not.toMatch(/\bdlx\b|\bnpx\b/);
  });

  it('valider : dry-run de deploy sync-config, avec le jeton et l’instance, sans API_URL', () => {
    const pnpm = fauxPnpm(0);
    const { code, sortie } = lancer('valider', { ...pnpm.env, ...secrets, API_URL: 'https://auto-heberge.invalid' });
    expect(code).toBe(0);
    expect(pnpm.appels()).toEqual([
      `${APPEL_CLI} --dry-run ${LIGNE_DEPOT}`,
    ]);
    expect(sortie).not.toContain(JETON_FACTICE);
  });

  it('deployer : deploy sync-config sans dry-run', () => {
    const pnpm = fauxPnpm(0);
    const { code, sortie } = lancer('deployer', { ...pnpm.env, ...secrets });
    expect(code).toBe(0);
    expect(pnpm.appels()).toEqual([
      `${APPEL_CLI} ${LIGNE_DEPOT}`,
    ]);
    expect(sortie).not.toContain(JETON_FACTICE);
  });

  for (const mode of ['valider', 'deployer']) {
    it(`${mode} : règles refusées par la CLI, sortie non nulle avec un message clair`, () => {
      const pnpm = fauxPnpm(1);
      const { code, sortie } = lancer(mode, { ...pnpm.env, ...secrets });
      expect(code).not.toBe(0);
      expect(sortie).toContain('refus');
      expect(sortie).not.toContain(JETON_FACTICE);
    });
  }

  it('n’affiche jamais les secrets', () => {
    const script = lireTexte(CHEMIN_SCRIPT);
    expect(script).not.toBe('');
    for (const ligne of script.split('\n')) {
      if (/^\s*#/.test(ligne)) continue;
      if (/\b(echo|printf)\b/.test(ligne)) expect(ligne).not.toMatch(/\$\{?(POWERSYNC_|PS_ADMIN_TOKEN|INSTANCE_ID)/);
      expect(ligne).not.toMatch(/set -x|\bprintenv\b|\bdeclare -p\b|\bexport -p\b/);
    }
  });
});

describe('T74 : scripts/deployer-regles-powersync.sh, liaison par cli.yaml', () => {
  const secrets = { POWERSYNC_ADMIN_TOKEN: JETON_FACTICE, POWERSYNC_INSTANCE_ID: INSTANCE_FACTICE };
  const identifiants = { POWERSYNC_ORG_ID: ORG_FACTICE, POWERSYNC_PROJECT_ID: PROJET_FACTICE };

  for (const mode of ['valider', 'deployer']) {
    it(`${mode} : lance la CLI sur une copie de powersync/ qui contient un cli.yaml (instance, organisation, projet)`, () => {
      const pnpm = fauxPnpm(0);
      const { code, sortie } = lancer(mode, { ...pnpm.env, ...secrets, ...identifiants });
      expect(code).toBe(0);
      const option = mode === 'valider' ? ' --dry-run' : '';
      expect(pnpm.appels()).toEqual([`${APPEL_CLI}${option} ${LIGNE_LIEE}`]);
      expect(sortie).not.toContain(JETON_FACTICE);
    });
  }

  it('le cli.yaml ne contient jamais le jeton, la copie est supprimée à la sortie, powersync/ reste intact', () => {
    const avant = readdirSync(`${RACINE}powersync`).sort();
    const pnpm = fauxPnpm(0);
    const { code } = lancer('deployer', { ...pnpm.env, ...secrets, ...identifiants });
    expect(code).toBe(0);
    const ligne = pnpm.appels().join('\n');
    expect(ligne).toContain(`cli=${CLI_YAML}`);
    expect(ligne).not.toContain(JETON_FACTICE);
    const copie = pnpm.dernierDossier();
    expect(copie).not.toBe('');
    expect(copie).not.toBe(`${RACINE}powersync`);
    expect(existsSync(copie)).toBe(false);
    expect(readdirSync(`${RACINE}powersync`).sort()).toEqual(avant);
    expect(existsSync(`${RACINE}powersync/cli.yaml`)).toBe(false);
  });

  it('la copie est supprimée aussi quand la CLI échoue', () => {
    const pnpm = fauxPnpm(1);
    const { code } = lancer('valider', { ...pnpm.env, ...secrets, ...identifiants });
    expect(code).not.toBe(0);
    const copie = pnpm.dernierDossier();
    expect(copie).not.toBe('');
    expect(existsSync(copie)).toBe(false);
  });

  it('sans aucun des deux : comportement de T67, dossier du dépôt, sans cli.yaml, sans ORG_ID ni PROJECT_ID', () => {
    const pnpm = fauxPnpm(0);
    const { code } = lancer('deployer', { ...pnpm.env, ...secrets, POWERSYNC_ORG_ID: '', POWERSYNC_PROJECT_ID: '' });
    expect(code).toBe(0);
    expect(pnpm.appels()).toEqual([`${APPEL_CLI} ${LIGNE_DEPOT}`]);
  });

  it('ne reprend jamais un ORG_ID ou un PROJECT_ID déjà posés ailleurs (ni en variable de la CLI, ni dans cli.yaml)', () => {
    const pnpm = fauxPnpm(0);
    const heritage = { ORG_ID: 'ffffffffffffffffffffffff', PROJECT_ID: 'eeeeeeeeeeeeeeeeeeeeeeee' };
    const sans = lancer('deployer', { ...pnpm.env, ...secrets, ...heritage });
    expect(sans.code).toBe(0);
    const avec = lancer('deployer', { ...pnpm.env, ...secrets, ...identifiants, ...heritage });
    expect(avec.code).toBe(0);
    expect(pnpm.appels()).toEqual([`${APPEL_CLI} ${LIGNE_DEPOT}`, `${APPEL_CLI} ${LIGNE_LIEE}`]);
  });

  it('un seul des deux : refus qui nomme celui qui manque, CLI non lancée', () => {
    const pnpm = fauxPnpm(0);
    const sansProjet = lancer('valider', { ...pnpm.env, ...secrets, POWERSYNC_ORG_ID: ORG_FACTICE });
    expect(sansProjet.code).not.toBe(0);
    expect(sansProjet.sortie).toContain('POWERSYNC_PROJECT_ID absent');
    const sansOrg = lancer('valider', { ...pnpm.env, ...secrets, POWERSYNC_PROJECT_ID: PROJET_FACTICE });
    expect(sansOrg.code).not.toBe(0);
    expect(sansOrg.sortie).toContain('POWERSYNC_ORG_ID absent');
    expect(pnpm.appels()).toEqual([]);
  });

  const malFormes = ['pas-un-identifiant', '1123456789abcdef0123456', '1123456789abcdef012345678', '1123456789abcdef0123456z', ` ${ORG_FACTICE}`, `${ORG_FACTICE}\n`];
  for (const valeur of malFormes) {
    for (const nom of VARIABLES) {
      it(`${nom} mal formé (${JSON.stringify(valeur)}) : refus clair, CLI non lancée`, () => {
        const pnpm = fauxPnpm(0);
        const { code, sortie } = lancer('deployer', { ...pnpm.env, ...secrets, ...identifiants, [nom]: valeur });
        expect(code).not.toBe(0);
        expect(sortie).toContain(`${nom} mal formé`);
        expect(sortie).toContain('24 caractères hexadécimaux');
        expect(sortie).not.toContain(JETON_FACTICE);
        expect(pnpm.appels()).toEqual([]);
      });
    }
  }

  it('avec les identifiants mais sans secrets : arrêt propre inchangé', () => {
    const pnpm = fauxPnpm(0);
    const { code, sortie } = lancer('deployer', { ...pnpm.env, ...identifiants });
    expect(code).toBe(0);
    expect(sortie).toContain(MESSAGE_ABSENT);
    expect(pnpm.appels()).toEqual([]);
  });

  for (const mode of ['valider', 'deployer']) {
    it(`${mode} : CLI en échec, rappelle les causes probables sans afficher le jeton`, () => {
      const pnpm = fauxPnpm(1);
      const { code, sortie } = lancer(mode, { ...pnpm.env, ...secrets, ...identifiants });
      expect(code).not.toBe(0);
      expect(sortie).toContain('autre organisation');
      expect(sortie).toContain('révoqué');
      expect(sortie).toContain('POWERSYNC_ORG_ID');
      expect(sortie).not.toContain(JETON_FACTICE);
    });
  }

  it('CLI réussie : aucun diagnostic, fetch instances non lancé', () => {
    const pnpm = fauxPnpm(0);
    const { code, sortie } = lancer('valider', { ...pnpm.env, ...secrets, ...identifiants });
    expect(code).toBe(0);
    expect(sortie).not.toContain('Diagnostic');
    expect(pnpm.appels().some((ligne) => ligne.includes('fetch instances'))).toBe(false);
  });
});

describe('T74 : scripts/deployer-regles-powersync.sh, diagnostic du jeton', () => {
  const secrets = { POWERSYNC_ADMIN_TOKEN: JETON_FACTICE, POWERSYNC_INSTANCE_ID: INSTANCE_FACTICE };
  const identifiants = { POWERSYNC_ORG_ID: ORG_FACTICE, POWERSYNC_PROJECT_ID: PROJET_FACTICE };
  const AUTRE_INSTANCE = 'abcdefabcdefabcdefabcdef';
  const AUTRE_ORG = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const AUTRE_PROJET = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const CONCLUSION_INVISIBLE =
    'le jeton ne voit pas cette instance : recréez-le en étant connecté au compte et à l\'organisation de l\'instance';

  /** Les deux modes, avec ou sans organisation et projet : le diagnostic est le même. */
  const cas: [string, string, Record<string, string>][] = [
    ['valider', 'lié', identifiants],
    ['deployer', 'lié', identifiants],
    ['valider', 'non lié', {}],
  ];
  for (const [mode, nature, variables] of cas) {
    it(`${mode} (${nature}) : instance attendue visible, le jeton n’est pas en cause`, () => {
      const pnpm = fauxPnpm(1, { visibles: [[ORG_FACTICE, PROJET_FACTICE, INSTANCE_FACTICE], [AUTRE_ORG, AUTRE_PROJET, AUTRE_INSTANCE]] });
      const { code, sortie } = lancer(mode, { ...pnpm.env, ...secrets, ...variables });
      expect(code).not.toBe(0);
      expect(pnpm.appels().filter((ligne) => ligne.includes('fetch instances'))).toEqual([`${APPEL_FETCH} ${LIGNE_FETCH}`]);
      expect(sortie).toContain('jeton reconnu');
      expect(sortie).toContain('instances visibles : 2');
      expect(sortie).toContain(`organisation ${ORG_FACTICE}, projet ${PROJET_FACTICE}, instance ${INSTANCE_FACTICE}`);
      expect(sortie).toContain(`organisation ${AUTRE_ORG}, projet ${AUTRE_PROJET}, instance ${AUTRE_INSTANCE}`);
      expect(sortie).toContain('instance attendue : visible');
      expect(sortie).not.toContain(CONCLUSION_INVISIBLE);
      expect(sortie).not.toContain('jeton refusé');
      expect(sortie).not.toContain(JETON_FACTICE);
    });
  }

  it('instance attendue absente de la liste : conclut que le jeton ne la voit pas', () => {
    const pnpm = fauxPnpm(1, { visibles: [[AUTRE_ORG, AUTRE_PROJET, AUTRE_INSTANCE]] });
    const { code, sortie } = lancer('valider', { ...pnpm.env, ...secrets, ...identifiants });
    expect(code).not.toBe(0);
    expect(sortie).toContain('jeton reconnu');
    expect(sortie).toContain('instances visibles : 1');
    expect(sortie).toContain(`instance ${AUTRE_INSTANCE}`);
    expect(sortie).toContain('instance attendue : absente');
    expect(sortie).toContain(CONCLUSION_INVISIBLE);
    expect(sortie).not.toContain('jeton refusé');
    expect(sortie).not.toContain(JETON_FACTICE);
  });

  it('jeton reconnu mais aucune instance visible : même conclusion', () => {
    const pnpm = fauxPnpm(1, { visibles: [] });
    const { sortie } = lancer('deployer', { ...pnpm.env, ...secrets, ...identifiants });
    expect(sortie).toContain('instances visibles : 0');
    expect(sortie).toContain('instance attendue : absente');
    expect(sortie).toContain(CONCLUSION_INVISIBLE);
  });

  it('fetch instances avale l’erreur (sortie 0, avertissement) : jeton refusé', () => {
    const pnpm = fauxPnpm(1, { avertissement: `401 Unauthorized ${JETON_FACTICE}` });
    const { code, sortie } = lancer('valider', { ...pnpm.env, ...secrets, ...identifiants });
    expect(code).not.toBe(0);
    expect(sortie).toContain('jeton refusé : recréez-le');
    expect(sortie).not.toContain('instances visibles');
    expect(sortie).not.toContain(CONCLUSION_INVISIBLE);
    expect(sortie).not.toContain(JETON_FACTICE);
  });

  it('fetch instances sort en erreur : jeton refusé', () => {
    const pnpm = fauxPnpm(1, { code: 2 });
    const { code, sortie } = lancer('deployer', { ...pnpm.env, ...secrets });
    expect(code).not.toBe(0);
    expect(sortie).toContain('jeton refusé : recréez-le');
    expect(sortie).not.toContain(JETON_FACTICE);
  });

  it('le diagnostic ne change pas le code de sortie : toujours non nul', () => {
    for (const fetch of [{}, { visibles: [] }, { code: 2 }, { avertissement: 'refus' }]) {
      const pnpm = fauxPnpm(1, fetch);
      expect(lancer('valider', { ...pnpm.env, ...secrets }).code).not.toBe(0);
    }
  });
});

describe('T67 : guide de mise en ligne, étape 3 bis', () => {
  const guide = lireTexte(CHEMIN_GUIDE);
  const workflow = lireYaml(CHEMIN_WORKFLOW);

  it('a une étape 3 bis qui nomme les deux secrets et la page des jetons', () => {
    expect(guide).toMatch(/^## Étape 3 bis — /m);
    for (const nom of SECRETS) expect(guide).toContain(`\`${nom}\``);
    expect(guide).toContain('https://dashboard.powersync.com/account/access-tokens');
  });

  it('pose les secrets dans l’environnement production, jamais en secret de dépôt', () => {
    const etape = /^## Étape 3 bis — [\s\S]*?(?=^## )/m.exec(guide)?.[0] ?? '';
    expect(etape).toContain('Add environment secret');
    expect(etape).toContain('production');
    expect(guide).not.toContain('New repository secret');
  });

  it('nomme les étapes du workflow exactement comme le YAML', () => {
    const avecScript = etapes(workflow).filter((e) => e.run?.includes('deployer-regles-powersync.sh'));
    expect(avecScript.length).toBe(2);
    for (const etape of avecScript) {
      expect(etape.name).toBeDefined();
      expect(guide).toContain(`« ${etape.name ?? ''} »`);
    }
  });

  it('T73 : explique les deux variables d’environnement et où les lire dans l’adresse du tableau de bord', () => {
    const etape = /^## Étape 3 bis — [\s\S]*?(?=^## )/m.exec(guide)?.[0] ?? '';
    for (const nom of VARIABLES) expect(etape).toContain(`\`${nom}\``);
    expect(etape).toContain('Environment variables');
    expect(etape).toContain('Add environment variable');
    expect(etape).toContain('/org/<ORG>/project/<PROJET>/<INSTANCE>/');
  });

  it('T74 : explique que les variables alimentent cli.yaml et décrit le diagnostic du jeton', () => {
    const etape = /^## Étape 3 bis — [\s\S]*?(?=^## )/m.exec(guide)?.[0] ?? '';
    expect(etape).toContain('cli.yaml');
    expect(etape).not.toMatch(/variables? d'environnement de la CLI/);
    expect(etape).toContain('Diagnostic du jeton');
    expect(etape).toContain('jeton refusé : recréez-le');
    expect(etape).toContain('le jeton ne voit pas cette instance : recréez-le en étant connecté au compte et à l\'organisation de l\'instance');
    expect(etape).toContain('instance attendue : visible');
    expect(guide).toContain('Diagnostic du jeton');
  });

  it('donne la version de la CLI utilisée par le script', () => {
    expect(versionCli()).not.toBe('');
    expect(guide).toContain(`powersync@${versionCli()}`);
  });
});

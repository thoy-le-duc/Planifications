/**
 * T44 : migrations de la base de production lancées automatiquement après chaque CI verte de `main`.
 *
 * ── Ce qui est attendu ──────────────────────────────────────────────────────────────────────
 *
 * - `.github/workflows/migrations-production.yml`, workflow « Migrations de production » :
 *   déclenché seulement par `workflow_run` (workflow « CI », branche `main`, terminé) et par
 *   `workflow_dispatch` ; le job ne tourne que si la CI a conclu `success` sur `main` dans ce
 *   dépôt (pas un fork). Jamais `pull_request` ni `pull_request_target` (dépôt public).
 *   Permissions `contents: read` seules, `concurrency` sans annulation, actions épinglées comme
 *   dans ci.yml. Le secret est lu par `secrets.DATABASE_URL_PRODUCTION`, et aucune commande
 *   n'affiche la variable.
 * - `scripts/migrer-production.sh` : sans secret (absent ou vide), écrit « secret
 *   DATABASE_URL_PRODUCTION absent : rien à faire, voir docs/mise-en-ligne.md » et sort en 0,
 *   même si DATABASE_URL (base de la CI) est posée. Avec le secret, lance
 *   `pnpm --filter @planif/db migrer` sur cette adresse ; un échec sort en non-zéro, sans que
 *   l'adresse ni le mot de passe apparaissent dans la sortie.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));
const CHEMIN_WORKFLOW = `${RACINE}.github/workflows/migrations-production.yml`;
const CHEMIN_CI = `${RACINE}.github/workflows/ci.yml`;
const CHEMIN_SCRIPT = `${RACINE}scripts/migrer-production.sh`;
const MESSAGE_ABSENT = 'secret DATABASE_URL_PRODUCTION absent : rien à faire, voir docs/mise-en-ligne.md';

type Objet = Record<string, unknown>;

function objet(valeur: unknown, quoi: string): Objet {
  if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) throw new Error(`${quoi} : objet attendu`);
  return valeur as Objet;
}

/** Fichier absent : texte vide (chaque test échoue alors pour sa propre raison). */
function lireTexte(chemin: string): string {
  return existsSync(chemin) ? readFileSync(chemin, 'utf8') : '';
}

function lireYaml(chemin: string): Objet {
  const document: unknown = parse(lireTexte(chemin));
  return document === null ? {} : objet(document, chemin);
}

interface Etape {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Objet;
  readonly with?: Objet;
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

describe('T44 : workflow « Migrations de production »', () => {
  const texte = lireTexte(CHEMIN_WORKFLOW);
  const workflow = lireYaml(CHEMIN_WORKFLOW);
  const ci = lireYaml(CHEMIN_CI);

  it('porte un nom clair', () => {
    expect(workflow.name).toBe('Migrations de production');
  });

  it('ne se déclenche qu’après la CI de main, ou à la main', () => {
    const declencheurs = objet(workflow.on ?? {}, 'on');
    expect(Object.keys(declencheurs).sort()).toEqual(['workflow_dispatch', 'workflow_run']);
    const suite = objet(declencheurs.workflow_run ?? {}, 'workflow_run');
    expect(suite.workflows).toEqual([ci.name]);
    expect(ci.name).toBe('CI');
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

  it('ne lance le job que sur une CI réussie de main, dans ce dépôt (pas un fork)', () => {
    const liste = jobs(workflow);
    expect(liste.length).toBe(1);
    const [, job] = liste[0] ?? ['', {}];
    const condition = typeof job.if === 'string' ? job.if : '';
    expect(condition).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(condition).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(condition).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    // Le lancement à la main ne vaut que depuis main.
    expect(condition).toContain("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
  });

  it('a des permissions minimales : contents: read, nulle part élargies', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const [, job] of jobs(workflow)) {
      if ('permissions' in job) expect(job.permissions).toEqual({ contents: 'read' });
    }
  });

  it('ne lance qu’une migration à la fois, sans annuler celle en cours', () => {
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

  it('ne garde pas les identifiants git après le checkout', () => {
    const checkout = etapes(workflow).find((etape) => etape.uses?.startsWith('actions/checkout@'));
    expect(checkout).toBeDefined();
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('lit le secret par secrets.DATABASE_URL_PRODUCTION, et aucun autre secret', () => {
    const references = texte.match(/secrets\.[A-Za-z_]+/g) ?? [];
    expect(references).toEqual(['secrets.DATABASE_URL_PRODUCTION']);
    const avecSecret = etapes(workflow).filter((etape) => JSON.stringify(etape).includes('secrets.'));
    expect(avecSecret.length).toBe(1);
    const etape = avecSecret[0];
    expect(etape?.env?.DATABASE_URL_PRODUCTION).toBe('${{ secrets.DATABASE_URL_PRODUCTION }}');
    expect(etape?.run?.trim()).toBe('bash scripts/migrer-production.sh');
  });

  it('n’a aucune commande qui affiche la variable', () => {
    expect(etapes(workflow).length).toBeGreaterThan(0);
    for (const etape of etapes(workflow)) {
      const commande = etape.run ?? '';
      expect(commande, etape.name).not.toMatch(/DATABASE_URL/);
      expect(commande, etape.name).not.toMatch(/\bprintenv\b|\benv\b|set -x|\bdeclare -p\b|\bexport -p\b/);
    }
    // Le secret n'est pas posé au niveau du workflow ou du job, où toutes les étapes le verraient.
    expect(JSON.stringify(workflow.env ?? {})).not.toContain('secrets.');
    for (const [, job] of jobs(workflow)) expect(JSON.stringify(job.env ?? {})).not.toContain('secrets.');
  });
});

/** Environnement du test, sans aucune des deux adresses de base (celle de la CI comprise). */
function environnementSans(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_PRODUCTION;
  return env;
}

function lancer(env: NodeJS.ProcessEnv): { code: number | null; sortie: string } {
  const resultat = spawnSync('bash', [CHEMIN_SCRIPT], { env, encoding: 'utf8', timeout: 60_000 });
  return { code: resultat.status, sortie: `${resultat.stdout}${resultat.stderr}` };
}

describe('T44 : scripts/migrer-production.sh', () => {
  it('sans secret : message clair, sortie en succès', () => {
    const { code, sortie } = lancer(environnementSans());
    expect(code).toBe(0);
    expect(sortie).toContain(MESSAGE_ABSENT);
  });

  it('secret vide : même arrêt propre', () => {
    const { code, sortie } = lancer({ ...environnementSans(), DATABASE_URL_PRODUCTION: '' });
    expect(code).toBe(0);
    expect(sortie).toContain(MESSAGE_ABSENT);
  });

  it('ne se rabat jamais sur DATABASE_URL (la base de la CI)', () => {
    const { code, sortie } = lancer({ ...environnementSans(), DATABASE_URL: 'postgres://ci:ci@127.0.0.1:1/ci' });
    expect(code).toBe(0);
    expect(sortie).toContain(MESSAGE_ABSENT);
  });

  it('n’affiche jamais la variable', () => {
    const script = lireTexte(CHEMIN_SCRIPT);
    expect(script).toContain('pnpm --filter @planif/db migrer');
    for (const ligne of script.split('\n')) {
      if (/^\s*#/.test(ligne)) continue;
      if (/\b(echo|printf)\b/.test(ligne)) expect(ligne).not.toMatch(/\$\{?DATABASE_URL/);
      expect(ligne).not.toMatch(/set -x|\bprintenv\b|\bdeclare -p\b|\bexport -p\b/);
    }
  });

  it(
    'migration en échec : sortie non nulle, sans l’adresse ni le mot de passe dans la sortie',
    () => {
      const adresse = 'postgres://planif:motdepasse-t44-secret@127.0.0.1:1/planif';
      const { code, sortie } = lancer({ ...environnementSans(), DATABASE_URL_PRODUCTION: adresse });
      expect(code).not.toBe(0);
      expect(sortie).not.toContain(MESSAGE_ABSENT);
      expect(sortie).not.toContain('motdepasse-t44-secret');
      expect(sortie).not.toContain(adresse);
    },
    90_000,
  );
});

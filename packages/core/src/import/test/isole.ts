/**
 * Exécution isolée pour les tests de robustesse de T14 : une fonction du moteur est appelée dans
 * un fil d'exécution (worker) à part, avec une mémoire plafonnée et un délai. Une entrée piégée
 * (expression régulière quadratique, feuille de milliards de cases) ne peut ainsi ni bloquer la
 * suite de tests ni l'emporter par manque de mémoire : le fil est arrêté et le test échoue en
 * disant pourquoi (« delai » ou « memoire »).
 *
 * La durée rendue est celle de l'appel seul, mesurée dans le fil (le chargement du module n'y
 * compte pas).
 *
 * T14c : si `--max-old-space-size` est fixé pour tout le processus (NODE_OPTIONS, comme dans le
 * conteneur de la boucle, ou ligne de commande), Node ignore le plafond `resourceLimits` des fils :
 * le test de mémoire passerait sans rien vérifier. Dans ce cas, l'appel tourne dans un PROCESSUS
 * enfant (même corps, ./execution-isolee.ts) lancé avec `--max-old-space-size` au plafond demandé.
 */

interface FilNode {
  on(evenement: 'message', rappel: (message: unknown) => void): void;
  on(evenement: 'error', rappel: (erreur: unknown) => void): void;
  on(evenement: 'exit', rappel: (code: number) => void): void;
  terminate(): Promise<number>;
}
/** `URL`, les minuteurs et `process` : présents dans Node, absents des types du cœur (lib ES2023 seule). */
interface Globaux {
  readonly URL: new (url: string, base: string) => { readonly href: string };
  setTimeout(rappel: () => void, ms: number): unknown;
  clearTimeout(minuteur: unknown): void;
  readonly process: { readonly env: Readonly<Record<string, string | undefined>>; readonly execArgv: readonly string[]; readonly execPath: string };
}
const G = globalThis as unknown as Globaux;

interface ModuleFils {
  readonly Worker: new (
    url: { readonly href: string },
    options: { readonly workerData: unknown; readonly resourceLimits: { readonly maxOldGenerationSizeMb: number; readonly maxYoungGenerationSizeMb: number } },
  ) => FilNode;
}

interface ProcessusEnfant {
  on(evenement: 'message', rappel: (message: unknown) => void): void;
  on(evenement: 'error', rappel: (erreur: unknown) => void): void;
  on(evenement: 'exit', rappel: (code: number | null, signal: string | null) => void): void;
  readonly stderr: { on(evenement: 'data', rappel: (morceau: { toString(): string }) => void): void } | null;
  send(message: unknown): boolean;
  kill(): boolean;
}

interface ModuleProcessus {
  readonly fork: (
    chemin: string,
    args: readonly string[],
    options: {
      readonly execArgv: readonly string[];
      readonly env: Readonly<Record<string, string | undefined>>;
      readonly serialization: 'advanced';
      readonly stdio: readonly ['ignore', 'ignore', 'pipe', 'ipc'];
    },
  ) => ProcessusEnfant;
}

interface ModuleUrl {
  readonly fileURLToPath: (url: string) => string;
}

const MODULE_FILS = 'node:worker_threads';
const MODULE_PROCESSUS = 'node:child_process';
const MODULE_URL = 'node:url';

const PLAFOND_GLOBAL = /--max-old-space-size(=|\s+)\S+/g;

export type Issue =
  | { readonly issue: 'resultat'; readonly valeur: unknown; readonly dureeMs: number }
  | { readonly issue: 'exception'; readonly message: string }
  | { readonly issue: 'delai' }
  | { readonly issue: 'memoire' };

export interface OptionsIsole {
  /** Arrêt du fil au-delà (chargement du module compris) : le test échoue alors en « delai ». */
  readonly arretMs: number;
  /** Plafond du tas du fil, en Mo. */
  readonly memoireMo?: number;
}

/** `scenarios` : enchaînements du moteur construits DANS le fil (./scenarios.ts), pour ne pas cloner d'énormes entrées ou sorties. */
const MODULES = { import: '../index.ts', xlsx: '../xlsx.ts', scenarios: './scenarios.ts' } as const;

/**
 * Appelle `module.chemin[0].chemin[1]…(...args)` dans un fil à part. Les arguments et le résultat
 * passent par clonage structuré (octets, textes, tableaux, objets simples).
 */
export async function executerIsole(module: keyof typeof MODULES, chemin: readonly string[], args: readonly unknown[], options: OptionsIsole): Promise<Issue> {
  const ici = (import.meta as { readonly url: string }).url;
  const { process } = G;
  const plafondGlobal = (process.env.NODE_OPTIONS ?? '').search(PLAFOND_GLOBAL) !== -1 || process.execArgv.some((a) => a.startsWith('--max-old-space-size'));
  if (plafondGlobal) return executerEnfant(new G.URL(MODULES[module], ici).href, chemin, args, options);
  const { Worker } = (await import(/* @vite-ignore */ MODULE_FILS)) as ModuleFils;
  const fil = new Worker(new G.URL('./execution-isolee.ts', ici), {
    workerData: { module: new G.URL(MODULES[module], ici).href, chemin, args },
    resourceLimits: { maxOldGenerationSizeMb: options.memoireMo ?? 512, maxYoungGenerationSizeMb: 64 },
  });
  return new Promise<Issue>((resoudre) => {
    let fini = false;
    const finir = (issue: Issue): void => {
      if (fini) return;
      fini = true;
      G.clearTimeout(minuteur);
      resoudre(issue);
      void fil.terminate();
    };
    const minuteur = G.setTimeout(() => {
      finir({ issue: 'delai' });
    }, options.arretMs);
    fil.on('message', (message) => {
      finir(message as Issue);
    });
    fil.on('error', (erreur) => {
      const code = (erreur as { readonly code?: unknown } | null)?.code;
      if (code === 'ERR_WORKER_OUT_OF_MEMORY') finir({ issue: 'memoire' });
      else finir({ issue: 'exception', message: erreur instanceof Error ? erreur.message : String(erreur) });
    });
    fil.on('exit', (code) => {
      finir(code === 0 ? { issue: 'exception', message: 'fil terminé sans résultat' } : { issue: 'memoire' });
    });
  });
}

/** Même appel dans un processus enfant plafonné par `--max-old-space-size` (voir l'en-tête). */
async function executerEnfant(module: string, chemin: readonly string[], args: readonly unknown[], options: OptionsIsole): Promise<Issue> {
  const { fork } = (await import(/* @vite-ignore */ MODULE_PROCESSUS)) as ModuleProcessus;
  const { fileURLToPath } = (await import(/* @vite-ignore */ MODULE_URL)) as ModuleUrl;
  const { process } = G;
  const ici = (import.meta as { readonly url: string }).url;
  const nodeOptions = (process.env.NODE_OPTIONS ?? '').replace(PLAFOND_GLOBAL, '').trim();
  const enfant = fork(fileURLToPath(new G.URL('./execution-isolee.ts', ici).href), [], {
    execArgv: [...process.execArgv.filter((a) => !a.startsWith('--max-old-space-size')), `--max-old-space-size=${String(options.memoireMo ?? 512)}`],
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let erreurs = '';
  enfant.stderr?.on('data', (morceau) => {
    erreurs = (erreurs + morceau.toString()).slice(-4_000);
  });
  return new Promise<Issue>((resoudre) => {
    let fini = false;
    const finir = (issue: Issue): void => {
      if (fini) return;
      fini = true;
      G.clearTimeout(minuteur);
      resoudre(issue);
      enfant.kill();
    };
    const minuteur = G.setTimeout(() => {
      finir({ issue: 'delai' });
    }, options.arretMs);
    enfant.on('message', (message) => {
      finir(message as Issue);
    });
    enfant.on('error', (erreur) => {
      finir({ issue: 'exception', message: erreur instanceof Error ? erreur.message : String(erreur) });
    });
    enfant.on('exit', (code, signal) => {
      const memoire = /heap out of memory|Allocation failed/i.test(erreurs) || signal === 'SIGABRT' || code === 134;
      finir(memoire ? { issue: 'memoire' } : { issue: 'exception', message: `processus terminé sans résultat (code ${String(code)}) : ${erreurs.slice(-500)}` });
    });
    enfant.send({ module, chemin, args });
  });
}

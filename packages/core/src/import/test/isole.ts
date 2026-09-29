/**
 * Exécution isolée pour les tests de robustesse de T14 : une fonction du moteur est appelée dans
 * un fil d'exécution (worker) à part, avec une mémoire plafonnée et un délai. Une entrée piégée
 * (expression régulière quadratique, feuille de milliards de cases) ne peut ainsi ni bloquer la
 * suite de tests ni l'emporter par manque de mémoire : le fil est arrêté et le test échoue en
 * disant pourquoi (« delai » ou « memoire »).
 *
 * La durée rendue est celle de l'appel seul, mesurée dans le fil (le chargement du module n'y
 * compte pas).
 */

interface FilNode {
  on(evenement: 'message', rappel: (message: unknown) => void): void;
  on(evenement: 'error', rappel: (erreur: unknown) => void): void;
  on(evenement: 'exit', rappel: (code: number) => void): void;
  terminate(): Promise<number>;
}
/** `URL` et les minuteurs : présents dans Node, absents des types du cœur (lib ES2023 seule). */
interface Globaux {
  readonly URL: new (url: string, base: string) => { readonly href: string };
  setTimeout(rappel: () => void, ms: number): unknown;
  clearTimeout(minuteur: unknown): void;
}
const G = globalThis as unknown as Globaux;

interface ModuleFils {
  readonly Worker: new (
    url: { readonly href: string },
    options: { readonly workerData: unknown; readonly resourceLimits: { readonly maxOldGenerationSizeMb: number; readonly maxYoungGenerationSizeMb: number } },
  ) => FilNode;
}

const MODULE_FILS = 'node:worker_threads';

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

const MODULES = { import: '../index.ts', xlsx: '../xlsx.ts' } as const;

/**
 * Appelle `module.chemin[0].chemin[1]…(...args)` dans un fil à part. Les arguments et le résultat
 * passent par clonage structuré (octets, textes, tableaux, objets simples).
 */
export async function executerIsole(module: keyof typeof MODULES, chemin: readonly string[], args: readonly unknown[], options: OptionsIsole): Promise<Issue> {
  const { Worker } = (await import(/* @vite-ignore */ MODULE_FILS)) as ModuleFils;
  const ici = (import.meta as { readonly url: string }).url;
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

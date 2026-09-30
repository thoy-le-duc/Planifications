/**
 * Durée de calcul d'un appel dans le fil isolé (T19) : min(temps mural, temps CPU du processus).
 *
 * Le temps mural seul échoue quand la machine est chargée (autres tests, autre équipe) : le
 * système préempte le fil, le mural s'allonge sans que le moteur calcule plus. Le temps CPU ne
 * compte que le calcul : un moteur vraiment plus lent (quadratique, par exemple) se voit
 * toujours, sous charge ou non.
 *
 * CPU du PROCESSUS (`process.cpuUsage`, tous fils) et non du fil seul : la lecture d'un classeur
 * décompresse par `DecompressionStream`, donc par node:zlib sur les fils de libuv, que le CPU du
 * fil oublierait. Le fil isolé vit dans le processus de ce seul fichier de test (vitest, pool
 * `forks` par défaut, qui attend pendant l'appel) ou dans un processus enfant (./isole.ts) :
 * rien d'autre n'y calcule. Le min avec le temps mural borne le tout (fils parallèles qui se
 * chevauchent, ou pool `threads` qui mêlerait d'autres fichiers) : jamais plus indulgent que
 * l'ancienne mesure murale.
 */

interface UsageCpu {
  readonly user: number;
  readonly system: number;
}
/** Présents dans Node, absents des types du cœur (lib ES2023 seule). */
const G = globalThis as unknown as {
  readonly performance: { now(): number };
  readonly process: { cpuUsage(): UsageCpu };
};

function cpuMs(): number {
  const u = G.process.cpuUsage();
  return (u.user + u.system) / 1000;
}

/** Lance un chronomètre ; la fonction rendue donne la durée de calcul écoulée, en ms. */
export function chronometre(): () => number {
  const debut = G.performance.now();
  const debutCpu = cpuMs();
  return () => {
    const cpu = cpuMs() - debutCpu;
    return Math.min(G.performance.now() - debut, cpu);
  };
}

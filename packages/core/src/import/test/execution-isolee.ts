/**
 * Corps du fil d'exécution (worker) lancé par `executerIsole` (./isole.ts) : charge un module du
 * moteur, appelle une de ses fonctions avec les arguments reçus, renvoie le résultat et la durée
 * de l'appel seul (chargement du module exclu). Lancé par Node, hors de Vitest : TypeScript lu
 * directement par Node (≥ 22.18), types de Node retrouvés dynamiquement avec un type local.
 */

interface PortParent {
  postMessage(message: unknown): void;
}
interface FilsNode {
  readonly parentPort: PortParent | null;
  readonly workerData: unknown;
}

interface Demande {
  readonly module: string;
  readonly chemin: readonly string[];
  readonly args: readonly unknown[];
}

const MODULE_FILS = 'node:worker_threads';
/** Présent dans Node, absent des types du cœur (lib ES2023 seule). */
const { performance } = globalThis as unknown as { readonly performance: { now(): number } };

const estObjet = (v: unknown): v is Record<string, unknown> => (typeof v === 'object' || typeof v === 'function') && v !== null;

function lireDemande(v: unknown): Demande {
  if (!estObjet(v) || typeof v.module !== 'string' || !Array.isArray(v.chemin) || !Array.isArray(v.args)) throw new Error('demande invalide');
  return { module: v.module, chemin: v.chemin.map(String), args: v.args as unknown[] };
}

const fils = (await import(/* @vite-ignore */ MODULE_FILS)) as FilsNode;
const demande = lireDemande(fils.workerData);
let cible: unknown = (await import(/* @vite-ignore */ demande.module)) as unknown;
let parent: unknown = undefined;
for (const k of demande.chemin) {
  if (!estObjet(cible)) throw new Error(`introuvable : ${demande.chemin.join('.')}`);
  parent = cible;
  cible = cible[k];
}
if (typeof cible !== 'function') throw new Error(`pas une fonction : ${demande.chemin.join('.')}`);
const fonction = cible as (this: unknown, ...args: unknown[]) => unknown;
const debut = performance.now();
const valeur = await Promise.resolve(fonction.apply(parent, [...demande.args]));
const dureeMs = performance.now() - debut;
fils.parentPort?.postMessage({ issue: 'resultat', valeur, dureeMs });

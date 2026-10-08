/**
 * Mesure de temps fiable pour les tests de performance (T31).
 *
 * Un test de temps qui mesure une seule fois, ou qui compare un temps mural à une borne, échoue
 * au hasard quand la machine est chargée (autres tests, autre équipe) : le système préempte le
 * processus, le temps mural s'allonge sans que le code calcule plus. Ce module règle cela sans
 * toucher aux bornes des tests :
 *
 *   1. un échauffement, hors mesure, laisse le moteur JavaScript compiler le code chaud ;
 *   2. chaque mesure vaut min(temps mural, temps CPU du processus) : la préemption ne compte
 *      plus, un code vraiment plus lent (quadratique, par exemple) se voit toujours ;
 *   3. le résultat est la MÉDIANE d'au moins 5 mesures : un ramasse-miettes ou une pointe de
 *      charge isolée ne décide plus du verdict, et un code lent est lent à chaque mesure.
 *
 *   4. si la médiane dépasse la borne donnée (`borneMs`), la série de mesures est refaite, jusqu'à
 *      3 manches ; on garde la meilleure médiane. Même le temps CPU gonfle quand la machine est
 *      saturée (processeurs partagés, caches), parfois pendant toute une manche. La borne ne
 *      bouge pas : un code vraiment trop lent dépasse la borne à CHAQUE manche et échoue.
 *
 * Le min(mural, CPU) n'est jamais plus sévère que le temps mural seul. Même méthode que
 * src/import/test/temps-calcul.ts (T19), pour un appel répété plutôt qu'un appel isolé.
 * Importable depuis les autres paquets par chemin relatif
 * (`../../core/src/test/mesurer.ts`), comme les autres aides de test du cœur.
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

/** Nombre minimal de mesures : en dessous, la médiane ne protège plus d'une pointe de charge. */
export const MESURES_MIN = 5;

export interface OptionsMesure {
  /** Appels hors mesure avant la première mesure. Défaut 3. */
  readonly echauffement?: number;
  /** Nombre de mesures, au moins {@link MESURES_MIN}. Défaut 7. */
  readonly mesures?: number;
  /** Borne du test, en ms : si la médiane la dépasse, on refait une manche (voir plus haut). */
  readonly borneMs?: number;
  /** Nombre de manches au plus quand `borneMs` est donnée. Défaut 3. */
  readonly manches?: number;
}

export interface Mesure<T> {
  /** Médiane des durées, en ms : la valeur à comparer à la borne. */
  readonly mediane: number;
  /** Les durées dans l'ordre des mesures, en ms (pour le message d'échec). */
  readonly serie: readonly number[];
  /** Résultat du dernier appel mesuré, pour les vérifications de fond du test. */
  readonly resultat: T;
  /** Les durées en texte, à mettre dans le message d'`expect`. */
  readonly detail: string;
}

/** Médiane d'une liste de nombres (la valeur du milieu, la plus haute des deux si pair). */
export function medianeDe(valeurs: readonly number[]): number {
  return [...valeurs].sort((a, b) => a - b)[Math.floor(valeurs.length / 2)] ?? Number.NaN;
}

function cpuMs(): number {
  const u = G.process.cpuUsage();
  return (u.user + u.system) / 1000;
}

/** Lance un chronomètre ; la fonction rendue donne min(mural, CPU) écoulé, en ms. */
function chronometre(): () => number {
  const debut = G.performance.now();
  const debutCpu = cpuMs();
  return () => Math.min(G.performance.now() - debut, cpuMs() - debutCpu);
}

function verifier(options: OptionsMesure | undefined): { echauffement: number; mesures: number; borneMs: number; manches: number } {
  const echauffement = options?.echauffement ?? 3;
  const mesures = options?.mesures ?? 7;
  if (mesures < MESURES_MIN) throw new Error(`mesurer : au moins ${String(MESURES_MIN)} mesures, ${String(mesures)} demandées`);
  return { echauffement, mesures, borneMs: options?.borneMs ?? Number.POSITIVE_INFINITY, manches: options?.manches ?? 3 };
}

interface Manche<T> {
  readonly serie: readonly number[];
  readonly resultat: T;
}

function resumer<T>(manches: readonly Manche<T>[]): Mesure<T> {
  const meilleure = manches.reduce((a, b) => (medianeDe(b.serie) < medianeDe(a.serie) ? b : a));
  const texte = (serie: readonly number[]): string => serie.map((d) => d.toFixed(1)).join(' / ');
  const detail = manches.length === 1 ? `${texte(meilleure.serie)} ms` : manches.map((x, i) => `manche ${String(i + 1)} : ${texte(x.serie)}`).join(' ; ') + ' ms';
  return { mediane: medianeDe(meilleure.serie), serie: meilleure.serie, resultat: meilleure.resultat, detail };
}

/** Échauffement, puis médiane de `mesures` appels de `f` (synchrone) ; manches refaites si `borneMs` est dépassée. */
export function mesurer<T>(f: () => T, options?: OptionsMesure): Mesure<T> {
  const { echauffement, mesures, borneMs, manches } = verifier(options);
  for (let i = 0; i < echauffement; i++) f();
  const faites: Manche<T>[] = [];
  do {
    const serie: number[] = [];
    let resultat: T | undefined;
    for (let i = 0; i < mesures; i++) {
      const fin = chronometre();
      resultat = f();
      serie.push(fin());
    }
    faites.push({ serie, resultat: resultat as T });
  } while (faites.length < manches && medianeDe(faites[faites.length - 1]?.serie ?? []) >= borneMs);
  return resumer(faites);
}

/** Comme {@link mesurer}, pour une fonction asynchrone. */
export async function mesurerAsync<T>(f: () => Promise<T>, options?: OptionsMesure): Promise<Mesure<T>> {
  const { echauffement, mesures, borneMs, manches } = verifier(options);
  for (let i = 0; i < echauffement; i++) await f();
  const faites: Manche<T>[] = [];
  do {
    const serie: number[] = [];
    let resultat: T | undefined;
    for (let i = 0; i < mesures; i++) {
      const fin = chronometre();
      resultat = await f();
      serie.push(fin());
    }
    faites.push({ serie, resultat: resultat as T });
  } while (faites.length < manches && medianeDe(faites[faites.length - 1]?.serie ?? []) >= borneMs);
  return resumer(faites);
}

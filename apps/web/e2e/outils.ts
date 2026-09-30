import { expect, type Page } from '@playwright/test';
import { MARQUE_APP_PRETE } from '../src/perf.ts';

/** CPU ralenti ×4 : le profil « mobile milieu de gamme » de Lighthouse. */
export const RALENTISSEMENT_CPU = 4;

export async function ralentirCpu(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RALENTISSEMENT_CPU });
}

/** Temps (ms) entre le début de la navigation et le premier affichage de l'appli. */
export async function tempsAppPrete(page: Page): Promise<number> {
  await expect(page.getByTestId('app')).toBeVisible();
  await page.waitForFunction((nom) => performance.getEntriesByName(nom, 'mark').length > 0, MARQUE_APP_PRETE);
  return page.evaluate((nom) => performance.getEntriesByName(nom, 'mark')[0]?.startTime ?? Number.NaN, MARQUE_APP_PRETE);
}

/**
 * T09b — violations de la CSP vues par la page : événements `securitypolicyviolation` (script
 * d'initialisation de Playwright, que la CSP ne bloque pas) et messages de la console qui
 * mentionnent la Content Security Policy. À appeler avant `page.goto`.
 */
export async function surveillerCsp(page: Page): Promise<() => Promise<string[]>> {
  const console_: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) console_.push(`console : ${message.text()}`);
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __violationsCsp: string[] }).__violationsCsp = violations;
    document.addEventListener('securitypolicyviolation', (e) => {
      violations.push(`${e.effectiveDirective} ${e.blockedURI} (${e.sourceFile}:${String(e.lineNumber)})`);
    });
  });
  return async () => {
    const dansLaPage = await page.evaluate(() => (window as unknown as { __violationsCsp?: string[] }).__violationsCsp ?? []);
    return [...dansLaPage, ...console_];
  };
}

/** Injecte un script en ligne ; vrai s'il s'est exécuté (la CSP ne l'a pas bloqué). */
export async function scriptEnLigneExecute(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const fenetre = window as unknown as { __scriptEnLigne?: boolean };
    delete fenetre.__scriptEnLigne;
    const script = document.createElement('script');
    script.textContent = 'window.__scriptEnLigne = true;';
    document.head.append(script);
    // Relu par une fonction : TypeScript croit la propriété encore absente après le delete.
    const lire = (): unknown => fenetre.__scriptEnLigne;
    return lire() === true;
  });
}

/**
 * T20 — nombre de répétitions d'une mesure de temps d'écran. Une mesure isolée sur une machine
 * partagée (CI) ne distingue pas la charge de la machine d'une vraie régression : on compare la
 * MÉDIANE de ces répétitions au budget, jamais le minimum (budgets inchangés).
 */
export const REPETITIONS_MESURE = 5;

/** Les valeurs d'une mesure répétée, dans l'ordre des répétitions, et leur médiane. */
export interface SerieMesures {
  readonly valeurs: readonly number[];
  readonly mediane: number;
}

/** Médiane (moyenne des deux valeurs centrales pour un nombre pair) ; NaN pour une liste vide. */
export function mediane(valeurs: readonly number[]): number {
  if (valeurs.length === 0) return Number.NaN;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  const haut = triees[milieu] ?? Number.NaN;
  return triees.length % 2 === 1 ? haut : ((triees[milieu - 1] ?? Number.NaN) + haut) / 2;
}

/**
 * Répète `fois` fois une mesure qui relève plusieurs temps nommés (ms) à chaque répétition, et
 * renvoie, pour chaque nom, les valeurs et leur médiane. C'est à `mesure` de repartir du même
 * point à chaque répétition (rechargement, page servie par le service worker, base rouverte).
 * La 1re répétition suit l'installation (caches du navigateur et de V8 encore froids) et est
 * presque toujours la plus lente ; les suivantes sont à chaud. Elle est comptée exprès, sans
 * chauffe cachée : la médiane reflète l'usage quotidien, premier lancement compris (décision
 * du chef, T20).
 */
export async function repeterMesures<K extends string>(
  fois: number,
  mesure: (repetition: number) => Promise<Readonly<Record<K, number>>>,
): Promise<Record<K, SerieMesures>> {
  const releves: Readonly<Record<K, number>>[] = [];
  for (let i = 0; i < fois; i += 1) releves.push(await mesure(i));
  const premier = releves[0];
  if (premier === undefined) throw new Error('repeterMesures : aucune répétition');
  const noms = Object.keys(premier) as K[];
  const series = {} as Record<K, SerieMesures>;
  for (const nom of noms) {
    const valeurs = releves.map((r) => r[nom]);
    series[nom] = { valeurs, mediane: mediane(valeurs) };
  }
  return series;
}

/** Répète `fois` fois une seule mesure de temps (ms). */
export async function repeterMesure(fois: number, mesure: (repetition: number) => Promise<number>): Promise<SerieMesures> {
  const { temps } = await repeterMesures(fois, async (i) => ({ temps: await mesure(i) }));
  return temps;
}

/** Ligne de journal : « libellé : 212, 230, 198, 250, 221 ms → médiane 221 ms (budget 300 ms) ». */
export function decrireSerie(libelle: string, serie: SerieMesures, budgetMs: number): string {
  const valeurs = serie.valeurs.map((v) => v.toFixed(0)).join(', ');
  return `${libelle} : ${valeurs} ms → médiane ${serie.mediane.toFixed(0)} ms (budget ${String(budgetMs)} ms)`;
}

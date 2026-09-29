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

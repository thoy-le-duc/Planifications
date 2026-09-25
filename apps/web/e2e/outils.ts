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

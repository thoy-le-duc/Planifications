import { expect, test } from '@playwright/test';
import { ralentirCpu, tempsAppPrete } from './outils.ts';

/**
 * Première visite : l'appli se télécharge une fois, avant installation.
 * Budget plus large que celui des écrans courants.
 */
const DEMARRAGE_FROID_MAX_MS = 1000;

/**
 * Principe 1 : tout écran courant s'affiche en moins de 300 ms.
 * Rouvrir l'appli au champ, sans réseau, est le cas le plus courant.
 */
const ECRAN_COURANT_MAX_MS = 300;

test('démarrage à froid sous le budget, CPU ralenti', async ({ page }) => {
  await ralentirCpu(page);
  await page.goto('/');
  const ms = await tempsAppPrete(page);
  console.log(`démarrage à froid : ${ms.toFixed(0)} ms (budget ${String(DEMARRAGE_FROID_MAX_MS)} ms)`);
  expect(ms).toBeLessThan(DEMARRAGE_FROID_MAX_MS);
});

test('réouverture hors ligne sous 300 ms, CPU ralenti', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await ralentirCpu(page);
  await page.reload();
  const ms = await tempsAppPrete(page);
  console.log(`réouverture hors ligne : ${ms.toFixed(0)} ms (budget ${String(ECRAN_COURANT_MAX_MS)} ms)`);
  expect(ms).toBeLessThan(ECRAN_COURANT_MAX_MS);
});

import { expect, test } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ralentirCpu, tempsAppPrete } from './outils.ts';

/**
 * Contrat (T16, relecture, point 3) : deux réouvertures hors ligne, CPU ralenti ×4, sous 300 ms
 * chacune : sans session (écran de connexion) et connecté (la coquille, Aujourd'hui : le cas de
 * tous les jours). Démarrage à froid (première visite) sous 1000 ms.
 */

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

test('réouverture hors ligne, connecté, sous 300 ms, CPU ralenti', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [
      CLE_SESSION,
      JSON.stringify({
        utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
        email: 'theophane@ferme.fr',
        jetonAcces: 'aaa.bbb.ccc',
        jetonRenouvellement: 'r'.repeat(43),
      }),
    ] as const,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();

  await context.setOffline(true);
  await ralentirCpu(page);
  await page.reload();
  const ms = await tempsAppPrete(page);
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  console.log(`réouverture hors ligne, connecté : ${ms.toFixed(0)} ms (budget ${String(ECRAN_COURANT_MAX_MS)} ms)`);
  expect(ms).toBeLessThan(ECRAN_COURANT_MAX_MS);
});

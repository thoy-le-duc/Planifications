import { defineConfig, devices } from '@playwright/test';

/**
 * T10 — tests de bout en bout de la synchro (e2e-synchro/), à part de `pnpm e2e` : ils exigent
 * Postgres, le service PowerSync et l'API (voir l'en-tête de e2e-synchro/synchro.e2e.ts).
 *
 * La page de diagnostic est construite avec les URL de l'API et du service (VITE_API_URL,
 * VITE_POWERSYNC_URL, figées au build) dans `dist-synchro/`, puis servie sur le port 4174.
 * Sans API_URL ni POWERSYNC_URL, aucun serveur n'est lancé et les tests se sautent (hors CI).
 */
const executablePath = process.env.CHROMIUM_PATH;
const apiUrl = process.env.API_URL ?? '';
const powersyncUrl = process.env.POWERSYNC_URL ?? '';
const baseURL = process.env.SYNCHRO_BASE_URL ?? 'http://localhost:4174';
const servicesPresents = apiUrl !== '' && powersyncUrl !== '';

export default defineConfig({
  testDir: 'e2e-synchro',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 120_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL,
    launchOptions: executablePath ? { executablePath } : {},
    // Le service worker de l'appli n'a rien à faire ici : la page est déjà chargée quand on coupe le réseau.
    serviceWorkers: 'block',
  },
  ...(servicesPresents && process.env.SYNCHRO_BASE_URL === undefined
    ? {
        webServer: {
          command: 'pnpm exec vite build --outDir dist-synchro && pnpm exec vite preview --outDir dist-synchro --port 4174 --strictPort',
          url: baseURL,
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          env: { VITE_API_URL: apiUrl, VITE_POWERSYNC_URL: powersyncUrl },
        },
      }
    : {}),
});

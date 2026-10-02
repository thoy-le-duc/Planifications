import { defineConfig, devices } from '@playwright/test';

// Chromium déjà installé sur la machine (facultatif) ; sinon celui de Playwright.
const executablePath = process.env.CHROMIUM_PATH;
// Port de la préversion : 4173 par défaut ; E2E_PORT_APPLI pour que deux équipes lancent
// `pnpm e2e` en même temps sans réutiliser le serveur de l'autre (T20).
const port = process.env.E2E_PORT_APPLI ?? '4173';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  // T25 : la démo se teste sur dist-demo/ (playwright.demo.config.ts, `pnpm e2e:demo`).
  testIgnore: '**/demo.e2e.ts',
  // Un seul navigateur à la fois : les mesures de temps ne doivent pas se gêner.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${port}`,
    launchOptions: executablePath ? { executablePath } : {},
  },
  // T11c : le build des essais (dist-essais/ : l'appli de production et les pages de test),
  // construit par `pnpm build` puis `pnpm build:essais`.
  webServer: {
    command: `pnpm preview --outDir dist-essais --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});

import { defineConfig, devices } from '@playwright/test';

/**
 * T25 — e2e de la démo en ligne (e2e/demo.e2e.ts), sur `dist-demo/` (`pnpm build:demo`) servi par
 * `vite preview`, à part de `pnpm e2e` (qui sert `dist-essais/` et ignore demo.e2e.ts).
 * Port : E2E_PORT_DEMO, sinon 4175 (4173 : pnpm e2e ; 14174 : pnpm e2e:synchro).
 */
const executablePath = process.env.CHROMIUM_PATH;
const port = process.env.E2E_PORT_DEMO ?? '4175';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/demo.e2e.ts',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${port}`,
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: `pnpm preview --outDir dist-demo --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});

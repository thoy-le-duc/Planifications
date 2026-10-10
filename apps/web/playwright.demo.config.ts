import { defineConfig, devices } from '@playwright/test';

/**
 * T25 — e2e de la démo en ligne (e2e/demo.e2e.ts), sur `dist-demo/` (`pnpm build:demo`) servi par
 * `vite preview`, à part de `pnpm e2e` (qui sert `dist-essais/` et ignore demo.e2e.ts).
 * Port : E2E_PORT_DEMO, sinon 4175 (4173 : pnpm e2e ; 14174 : pnpm e2e:synchro).
 */
const executablePath = process.env.CHROMIUM_PATH;
const port = process.env.E2E_PORT_DEMO ?? '4175';
// T27b : vue-3d-filtres.e2e.ts a un test pour la démo (il ne tourne que si E2E_DEMO=1) ; ses autres tests visent la grande ferme de T07.
process.env.E2E_DEMO = '1';

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['**/demo.e2e.ts', '**/vue-3d-filtres.e2e.ts', '**/vue-3d-jumeau.e2e.ts', '**/vue-3d-editeur.e2e.ts', '**/vue-3d-travaux.e2e.ts', '**/vue-3d-recolte.e2e.ts', '**/demo-placement.e2e.ts'],
  // T28f : vue-3d-editeur.e2e.ts a un test pour la démo ; ses autres tests s'ignorent d'eux-mêmes (E2E_DEMO).
  // T28c : vue-3d-jumeau.e2e.ts a un test pour la démo ; ses autres tests visent la grande ferme de T07.
  // T32e : vue-3d-recolte.e2e.ts (la récolte se voit dans la 3D de la démo : balises, fruits, « N planches à récolter »).
  // T28i : demo-placement.e2e.ts (essayer le placement d'une serre dans la démo, en ligne simulé et hors ligne).
  grepInvert: /grande ferme de T07|ferme sans placement/,
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

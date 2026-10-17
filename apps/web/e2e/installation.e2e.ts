import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * T40 — l'appli s'installe sur le téléphone (docs/backlog/T40-installer-appli.md).
 *
 * Dans le vrai Chromium, sur le build de production (copié dans dist-essais/) :
 *   1. critères d'installabilité de Chromium : une fois le service worker en place (enregistré au
 *      repos, T20), `Page.getInstallabilityErrors` (CDP) ne renvoie aucune erreur : manifeste
 *      valide, icônes servies, service worker qui contrôle la page ;
 *   2. le manifeste lu par Chromium (`Page.getAppManifest`) : sans erreur, `display` standalone,
 *      icônes PNG 192, 512 et maskable, chacune servie en `image/png` ;
 *   3. `apple-touch-icon` servi en PNG ; métas iOS dans la page.
 *
 * Profil persistant (dossier temporaire) : les contextes ordinaires de Playwright sont « privés »,
 * et Chromium refuse d'y installer une appli (erreur `in-incognito`, sans rapport avec l'appli).
 */

/** Temps laissé à l'appli pour enregistrer son service worker au repos, puis l'installer. */
const DELAI_SERVICE_WORKER_MS = 30_000;

interface IconeManifeste {
  readonly src: string;
  readonly sizes?: string;
  readonly type?: string;
  readonly purpose?: string;
}

test('T40 : Chromium juge l’appli installable (manifeste, icônes, service worker)', async ({ baseURL, browserName, launchOptions }) => {
  expect(browserName).toBe('chromium');
  const profil = mkdtempSync(join(tmpdir(), 'planif-installation-'));
  const context = await chromium.launchPersistentContext(profil, { ...launchOptions, ...(baseURL === undefined ? {} : { baseURL }) });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await verifierInstallable(page, context);
  } finally {
    await context.close();
    rmSync(profil, { recursive: true, force: true });
  }
});

async function verifierInstallable(page: Page, context: BrowserContext): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: DELAI_SERVICE_WORKER_MS });

  const cdp = await context.newCDPSession(page);

  // 1. Installabilité : aucune erreur (le contrôle peut demander un instant après le service worker).
  await expect
    .poll(
      async () => {
        const r = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: { errorId: string }[] };
        return r.installabilityErrors.map((e) => e.errorId);
      },
      { timeout: 15_000, message: 'erreurs d’installabilité de Chromium' },
    )
    .toEqual([]);

  // 2. Le manifeste tel que Chromium le lit.
  const lu = (await cdp.send('Page.getAppManifest')) as { url: string; errors: { message: string }[]; data?: string };
  expect(lu.errors.map((e) => e.message), 'erreurs du manifeste').toEqual([]);
  expect(lu.data, 'manifeste lié par la page').toBeTruthy();
  const manifeste = JSON.parse(lu.data ?? '{}') as { display?: string; id?: string; icons?: IconeManifeste[] };
  expect(manifeste.display).toBe('standalone');
  const icones = manifeste.icons ?? [];
  const buts = (i: IconeManifeste) => (i.purpose ?? 'any').split(/\s+/);
  expect(icones.some((i) => i.type === 'image/png' && i.sizes === '192x192' && buts(i).includes('any')), 'PNG 192').toBe(true);
  expect(icones.some((i) => i.type === 'image/png' && i.sizes === '512x512' && buts(i).includes('any')), 'PNG 512').toBe(true);
  expect(icones.some((i) => i.type === 'image/png' && buts(i).includes('maskable')), 'PNG maskable').toBe(true);
  for (const icone of icones.filter((i) => i.type === 'image/png')) {
    const reponse = await page.request.get(new URL(icone.src, lu.url).href);
    expect(reponse.status(), icone.src).toBe(200);
    expect(reponse.headers()['content-type'], icone.src).toContain('image/png');
  }

  // 3. iPhone : icône d'écran d'accueil et métas.
  const pomme = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(pomme, '<link rel="apple-touch-icon">').toBeTruthy();
  const reponse = await page.request.get(pomme ?? '');
  expect(reponse.status()).toBe(200);
  expect(reponse.headers()['content-type']).toContain('image/png');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', /.+/);
}

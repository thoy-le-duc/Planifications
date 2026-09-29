import { expect, test } from '@playwright/test';
import { scriptEnLigneExecute, surveillerCsp, tempsAppPrete } from './outils.ts';

/**
 * T09b — CSP stricte servie avec l'appli (contrat et décision : scripts/csp.test.ts).
 *
 * Sur le build servi par `vite preview` :
 *   - dist/index.html porte UNE balise <meta http-equiv="Content-Security-Policy" content="…">,
 *     placée avant tout <script> et tout <link> ; script-src n'y permet que 'self' (et
 *     'wasm-unsafe-eval') ; aucun <script> sans src, aucun attribut on…= ;
 *   - la politique est effective : un script injecté en ligne ne s'exécute pas, en ligne comme
 *     à la réouverture hors ligne (index.html resservi par le service worker) ;
 *   - l'appli fonctionne sous cette politique : aucune violation (événement
 *     securitypolicyviolation ni message de console) au démarrage, à la réouverture hors ligne
 *     et pendant la connexion.
 */

const SCRIPT_SRC_PERMIS = new Set(["'self'", "'wasm-unsafe-eval'"]);

function decoderEntites(v: string): string {
  return v.replaceAll('&#39;', "'").replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

/** Balises <meta> CSP de la page : position dans le HTML et contenu. */
function balisesCsp(html: string): { position: number; contenu: string }[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)]
    .filter((m) => /http-equiv\s*=\s*["']?content-security-policy["']?/i.test(m[0]))
    .map((m) => ({
      position: m.index,
      contenu: decoderEntites(/\bcontent\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(m[0])?.[1] ?? ''),
    }));
}

function directives(csp: string): Map<string, string[]> {
  const resultat = new Map<string, string[]>();
  for (const brute of csp.split(';')) {
    const [nom, ...valeurs] = brute.trim().split(/\s+/);
    if (nom !== undefined && nom !== '') resultat.set(nom.toLowerCase(), valeurs);
  }
  return resultat;
}

test('index.html servi : une balise CSP stricte, en tête, et aucun script en ligne', async ({ request }) => {
  const res = await request.get('/');
  expect(res.ok()).toBe(true);
  const html = await res.text();

  const balises = balisesCsp(html);
  expect(balises, 'une seule balise CSP').toHaveLength(1);
  const [balise] = balises;
  const premierScriptOuLien = html.search(/<(script|link)\b/i);
  expect(premierScriptOuLien).toBeGreaterThan(0);
  expect(balise?.position ?? Number.POSITIVE_INFINITY, 'CSP avant tout <script> et <link>').toBeLessThan(premierScriptOuLien);

  const d = directives(balise?.contenu ?? '');
  const scriptSrc = d.get('script-src') ?? [];
  expect(scriptSrc).toContain("'self'");
  for (const v of scriptSrc) expect(SCRIPT_SRC_PERMIS.has(v), `script-src ${v}`).toBe(true);
  expect(d.get('default-src')).toEqual(["'self'"]);
  expect(d.get('object-src')).toEqual(["'none'"]);

  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    expect(script[1] ?? '', `script sans src : ${script[0].slice(0, 80)}`).toMatch(/\bsrc\s*=/i);
    expect((script[2] ?? '').trim(), 'script avec du code en ligne').toBe('');
  }
  expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
});

test('démarrage : aucune violation de la CSP, et un script injecté en ligne est bloqué', async ({ page }) => {
  const violations = await surveillerCsp(page);
  await page.goto('/');
  await tempsAppPrete(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  expect(await violations()).toEqual([]);

  expect(await scriptEnLigneExecute(page)).toBe(false);
  // Témoin : la surveillance voit bien une violation quand il y en a une.
  await expect.poll(async () => (await violations()).length).toBeGreaterThan(0);
});

test('réouverture hors ligne (service worker) : la CSP s’applique toujours, sans violation', async ({ page, context }) => {
  const violations = await surveillerCsp(page);
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await tempsAppPrete(page);
  expect(await violations()).toEqual([]);
  expect(await scriptEnLigneExecute(page)).toBe(false);
});

test.describe('connexion sous CSP (API simulée)', () => {
  // Le service worker intercepterait les requêtes avant page.route.
  test.use({ serviceWorkers: 'block' });

  test('demande et vérification du code : aucune violation', async ({ page }) => {
    await page.route('**/auth/code', (route) => route.fulfill({ status: 202, json: { ok: true } }));
    await page.route('**/auth/verifier', (route) =>
      route.fulfill({
        status: 200,
        json: { utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) },
      }),
    );
    const violations = await surveillerCsp(page);
    await page.goto('/');
    await page.getByLabel(/adresse e-mail/i).fill('theophane@ferme.fr');
    await page.getByRole('button', { name: /recevoir un code/i }).click();
    await expect(page.getByLabel(/code/i)).toBeVisible();
    await page.keyboard.type('012345');
    await expect(page.getByLabel(/code/i)).toBeHidden();
    expect(await violations()).toEqual([]);
  });
});

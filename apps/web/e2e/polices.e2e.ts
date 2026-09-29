import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page, type Request, type Response } from '@playwright/test';
import { surveillerCsp, tempsAppPrete } from './outils.ts';

/**
 * T16 — polices hébergées avec l'appli (fichiers : src/ui/polices.test.ts).
 *
 * Contrat, sur le build servi par `vite preview` :
 *   - aucune requête vers un autre domaine que celui de l'appli (polices comprises : pas de
 *     Google Fonts) pendant le démarrage et la connexion ;
 *   - les trois familles sont déclarées en @font-face (document.fonts) avec
 *     `font-display: swap` : « Archivo », « Atkinson Hyperlegible », « IBM Plex Mono » ;
 *     les polices viennent de /polices/*.woff2 (même origine) ;
 *   - l'écran de connexion utilise Archivo (titre) et Atkinson Hyperlegible (texte), chargées ;
 *   - hors ligne (réouverture servie par le service worker), les trois familles se chargent
 *     depuis le cache du service worker (précache : les woff2 doivent y être) ;
 *   - aucune violation de la CSP (default-src 'self' couvre les polices) ;
 *   - préchargement (relecture, point 3) : le build (dist/index.html) porte, pour les polices de
 *     l'écran de connexion et elles seules, un
 *     <link rel="preload" as="font" type="font/woff2" crossorigin href="/polices/….woff2"> :
 *     le fichier Archivo (archivo*.woff2), Atkinson Hyperlegible 400
 *     (atkinson-hyperlegible*400*.woff2) et 700 (atkinson-hyperlegible*700*.woff2) ; chaque
 *     fichier préchargé existe dans dist/, est celui des @font-face (une seule requête par fichier
 *     à l'écran de connexion : pas de double téléchargement, que provoquerait un crossorigin
 *     manquant) et se charge.
 */

const FAMILLES = ['Archivo', 'Atkinson Hyperlegible', 'IBM Plex Mono'] as const;
/** Graisse utilisée par chaque famille dans les maquettes. */
const GRAISSES: Readonly<Record<(typeof FAMILLES)[number], number>> = { Archivo: 800, 'Atkinson Hyperlegible': 400, 'IBM Plex Mono': 600 };
/** Texte à couvrir : le français des écrans. */
const TEXTE = 'Récolte à l’œuvre, « Ça presse » · déjà 12 €';

interface FaceVue {
  readonly famille: string;
  readonly statut: string;
  readonly affichage: string;
}

function surveillerRequetes(cible: Page | BrowserContext): Request[] {
  const requetes: Request[] = [];
  cible.on('request', (r) => requetes.push(r));
  return requetes;
}

/** URL hors de l'origine de l'appli (data: et blob: exceptés). */
function tierces(requetes: readonly Request[], origine: string): string[] {
  return requetes
    .map((r) => r.url())
    .filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'))
    .filter((u) => new URL(u).origin !== origine);
}

async function faces(page: Page): Promise<FaceVue[]> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => ({ famille: f.family.replace(/["']/g, ''), statut: f.status, affichage: f.display }));
  });
}

/** Force le chargement de chaque famille ; rend, par famille, les statuts des faces chargées. */
async function chargerFamilles(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(
    async ([familles, graisses, texte]) => {
      const resultat: Record<string, string[]> = {};
      for (const famille of familles) {
        try {
          const chargees = await document.fonts.load(`${String(graisses[famille])} 16px "${famille}"`, texte);
          resultat[famille] = chargees.map((f) => f.status);
        } catch (e) {
          resultat[famille] = [`échec : ${e instanceof Error ? e.message : String(e)}`];
        }
      }
      return resultat;
    },
    [FAMILLES, GRAISSES, TEXTE] as const,
  );
}

function verifierDeclarees(vues: readonly FaceVue[]): void {
  for (const famille of FAMILLES) {
    const siennes = vues.filter((v) => v.famille === famille);
    expect(siennes.length, `@font-face « ${famille} »`).toBeGreaterThan(0);
    for (const v of siennes) expect(v.affichage, `${famille} : font-display`).toBe('swap');
  }
}

function verifierChargees(chargees: Record<string, string[]>): void {
  for (const famille of FAMILLES) {
    expect(chargees[famille]?.length ?? 0, `${famille} chargée`).toBeGreaterThan(0);
    for (const statut of chargees[famille] ?? []) expect(statut, famille).toBe('loaded');
  }
}

test.describe('en ligne, connexion (API simulée)', () => {
  // Le service worker intercepterait les requêtes avant page.route.
  test.use({ serviceWorkers: 'block' });

  test('aucune requête tierce ; polices de l’appli, font-display: swap, utilisées sur l’écran de connexion', async ({ page, baseURL }) => {
    const origine = new URL(baseURL ?? 'http://localhost:4173').origin;
    await page.route('**/auth/code', (route) => route.fulfill({ status: 202, json: { ok: true } }));
    await page.route('**/auth/verifier', (route) =>
      route.fulfill({
        status: 200,
        json: { utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) },
      }),
    );
    const requetes = surveillerRequetes(page);
    const reponsesPolices: Response[] = [];
    page.on('response', (r) => {
      if (new URL(r.url()).pathname.startsWith('/polices/')) reponsesPolices.push(r);
    });
    const violations = await surveillerCsp(page);

    await page.goto('/');
    await tempsAppPrete(page);
    const vues = await faces(page);
    verifierDeclarees(vues);

    // Titre en Archivo, texte en Atkinson Hyperlegible, chargées.
    const titre = page.getByRole('heading', { level: 1, name: 'Planifications' });
    expect(await titre.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/^\s*["']?Archivo\b/);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^\s*["']?Atkinson Hyperlegible\b/);
    for (const famille of ['Archivo', 'Atkinson Hyperlegible']) {
      expect(vues.some((v) => v.famille === famille && v.statut === 'loaded'), `${famille} chargée à l’écran de connexion`).toBe(true);
    }
    verifierChargees(await chargerFamilles(page));

    // Fichiers woff2 de l'appli.
    expect(reponsesPolices.length).toBeGreaterThan(0);
    for (const r of reponsesPolices) {
      expect(r.ok(), r.url()).toBe(true);
      expect(new URL(r.url()).pathname).toMatch(/^\/polices\/[^/]+\.woff2$/);
    }

    // Connexion complète.
    await page.getByLabel(/adresse e-mail/i).fill('theophane@ferme.fr');
    await page.getByRole('button', { name: /recevoir un code/i }).click();
    await expect(page.getByLabel(/code/i)).toBeVisible();
    await page.keyboard.type('012345');
    await expect(page.getByLabel(/code/i)).toBeHidden();

    expect(tierces(requetes, origine)).toEqual([]);
    expect(await violations()).toEqual([]);
  });
});

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

interface Prechargement {
  readonly balise: string;
  readonly href: string;
}

/** Balises <link rel="preload" as="font"> de dist/index.html. */
function prechargementsDePolices(): Prechargement[] {
  const html = readFileSync(`${DIST}index.html`, 'utf8');
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((b) => /\brel=["']?preload\b/i.test(b) && /\bas=["']?font\b/i.test(b))
    .map((balise) => ({ balise, href: /\bhref=["']?([^"'\s>]+)/i.exec(balise)?.[1] ?? '' }));
}

test.describe('préchargement des polices de la connexion (build)', () => {
  test.use({ serviceWorkers: 'block' });

  test('dist/index.html précharge Archivo et Atkinson 400/700, crossorigin, sans double téléchargement', async ({ page }) => {
    const liens = prechargementsDePolices();
    const hrefs = liens.map((l) => l.href);
    for (const { balise, href } of liens) {
      expect(balise, href).toMatch(/\btype=["']?font\/woff2\b/i);
      expect(balise, `${href} : crossorigin`).toMatch(/\scrossorigin(\s|=|\/?>)/i);
      expect(href, balise).toMatch(/^\/polices\/[^/]+\.woff2$/);
      expect(existsSync(`${DIST}${href.slice(1)}`), `dist${href}`).toBe(true);
    }
    const nom = (h: string) => h.replace(/^\/polices\//, '');
    expect(hrefs.filter((h) => /^archivo[-.a-z0-9]*\.woff2$/.test(nom(h))), 'Archivo préchargée').toHaveLength(1);
    expect(hrefs.filter((h) => /^atkinson-hyperlegible[-.a-z0-9]*400[-.a-z0-9]*\.woff2$/.test(nom(h))), 'Atkinson 400 préchargée').toHaveLength(1);
    expect(hrefs.filter((h) => /^atkinson-hyperlegible[-.a-z0-9]*700[-.a-z0-9]*\.woff2$/.test(nom(h))), 'Atkinson 700 préchargée').toHaveLength(1);
    expect(hrefs, 'rien d’autre de préchargé').toHaveLength(3);

    // Dans le navigateur : chaque fichier préchargé demandé une fois, et chargé.
    const demandes: string[] = [];
    page.on('request', (r) => {
      const chemin = new URL(r.url()).pathname;
      if (chemin.startsWith('/polices/')) demandes.push(chemin);
    });
    await page.goto('/');
    await tempsAppPrete(page);
    await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    for (const href of hrefs) expect(demandes.filter((d) => d === href), `${href} : une seule requête`).toHaveLength(1);
    const chargees = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/["']/g, '')} ${f.weight}`));
    expect(chargees.some((f) => f.startsWith('Archivo')), `Archivo chargée (${chargees.join(', ')})`).toBe(true);
    expect(chargees, 'Atkinson 400').toContain('Atkinson Hyperlegible 400');
    expect(chargees, 'Atkinson 700').toContain('Atkinson Hyperlegible 700');
  });
});

test.describe('hors ligne, appli servie par le service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('démarrage : aucune requête tierce, service worker compris', async ({ page, context, baseURL }) => {
    const origine = new URL(baseURL ?? 'http://localhost:4173').origin;
    const requetes = surveillerRequetes(context);
    await page.goto('/');
    await tempsAppPrete(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect(tierces(requetes, origine)).toEqual([]);
  });

  test('réouverture hors ligne : les trois polices viennent du cache du service worker', async ({ page, context }) => {
    const violations = await surveillerCsp(page);
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await context.setOffline(true);
    const reponsesPolices: Response[] = [];
    page.on('response', (r) => {
      if (new URL(r.url()).pathname.startsWith('/polices/')) reponsesPolices.push(r);
    });
    await page.reload();
    await tempsAppPrete(page);

    verifierDeclarees(await faces(page));
    verifierChargees(await chargerFamilles(page));
    const titre = page.getByRole('heading', { level: 1, name: 'Planifications' });
    expect(await titre.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/^\s*["']?Archivo\b/);

    expect(reponsesPolices.length).toBeGreaterThan(0);
    for (const r of reponsesPolices) {
      expect(r.ok(), r.url()).toBe(true);
      expect(r.fromServiceWorker(), `${r.url()} servie par le service worker`).toBe(true);
    }
    expect(await violations()).toEqual([]);
  });
});

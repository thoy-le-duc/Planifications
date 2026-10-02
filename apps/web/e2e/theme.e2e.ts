import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { fermeItineraires } from '../src/ecrans/itineraires/test/ferme-itineraires.ts';
import { SAISON, fermeSerie } from '../src/ecrans/serie/test/ferme-serie.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T18 — mode sombre (docs/backlog/T18-mode-sombre.md), sur un téléphone de 390 × 844.
 *
 * Contrat :
 *   - l'appli suit le réglage du téléphone (prefers-color-scheme) ; en sombre, le fond des écrans
 *     est sombre (luminance < 0,1) et le texte clair ; en clair, rien ne change (#EEF1E8) ;
 *   - captures de chaque écran principal dans les deux thèmes, apps/web/e2e/captures/
 *     <écran>-clair.png et <écran>-sombre.png, 780 × 1688 px (390 × 844, densité 2) : aujourdhui,
 *     planches, serie, itineraires, ferme (dossier ignoré par git, le relecteur les regarde) ;
 *   - onglet Ferme : section « Apparence », trois choix (radio) « Comme le téléphone », « Clair »,
 *     « Sombre », chacun d'au moins 56 px de haut ; un tap change data-theme sur <html> et
 *     planif.theme du localStorage ;
 *   - « Sombre » forcé (téléphone en clair) et rechargement : jamais de fond clair, ni à
 *     aucun affichage avant l'appli (data-theme="sombre" posé dès que <body> existe, fond du body
 *     sombre à chaque image) ; <meta name="theme-color"> adapté (différent du thème clair).
 *
 * Amorçage : mêmes pages de diagnostic que serie.e2e.ts et itineraires.e2e.ts.
 */

const LARGEUR = 390;
const HAUTEUR = 844;
const DENSITE = 2;
const CIBLE_MIN_PX = 56;
const DELAI_AMORCAGE_MS = 60_000;
const DOSSIER_CAPTURES = fileURLToPath(new URL('captures/', import.meta.url));
const THEMES = ['clair', 'sombre'] as const;
type Theme = (typeof THEMES)[number];

test.use({ viewport: { width: LARGEUR, height: HAUTEUR }, deviceScaleFactor: DENSITE, serviceWorkers: 'block', actionTimeout: 15_000 });

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string | RegExp) => navigation(page).locator('button').filter({ hasText: libelle });

async function capturer(page: Page, nom: string): Promise<void> {
  mkdirSync(DOSSIER_CAPTURES, { recursive: true });
  const chemin = `${DOSSIER_CAPTURES}${nom}.png`;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: chemin });
  expect(statSync(chemin).size, `${nom}.png`).toBeGreaterThan(0);
  const png = readFileSync(chemin);
  expect(png.subarray(1, 4).toString('latin1'), `${nom}.png : signature`).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${nom}.png : dimensions`).toEqual([LARGEUR * DENSITE, HAUTEUR * DENSITE]);
}

/** Luminance relative WCAG de la couleur de fond calculée du <body> (0 noir, 1 blanc). */
async function luminanceFond(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.body).backgroundColor);
    const [r, v, b] = (m?.[1] ?? '255,255,255').split(/[ ,/]+/).filter((x) => x !== '').slice(0, 3).map((c) => {
      const s = Number(c) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 1) + 0.7152 * (v ?? 1) + 0.0722 * (b ?? 1);
  });
}

async function attendreEtVerifierTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const lum = await luminanceFond(page);
  if (theme === 'sombre') expect(lum, 'fond sombre').toBeLessThan(0.1);
  else expect(lum, 'fond clair').toBeGreaterThan(0.75);
}

async function amorcer(page: Page, url: string, attendu: { utilisateurId: string; fermeId: string; total: number }): Promise<void> {
  await page.goto(url);
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { utilisateurId?: string; fermeId?: string; lignes?: number; erreur?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  expect(a.utilisateurId).toBe(attendu.utilisateurId);
  expect(a.fermeId).toBe(attendu.fermeId);
  expect(a.lignes).toBe(attendu.total);
}

async function connecter(page: Page, utilisateurId: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
}

for (const theme of THEMES) {
  test(`captures ${theme} : Aujourd’hui, Planches, Série, Ferme (le téléphone est en ${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme === 'sombre' ? 'dark' : 'light' });
    const ferme = fermeSerie();
    await amorcer(page, '/diagnostic/amorcer.html?jeu=serie', ferme);
    const violations = await surveillerCsp(page);
    await connecter(page, ferme.utilisateurId);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), 'réglage par défaut : le téléphone décide').toBe(false);

    await attendreEtVerifierTheme(page, theme);
    await capturer(page, `aujourdhui-${theme}`);

    await onglet(page, 'Planches').click();
    await expect(page.getByTestId('plan-defilement')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Saison').selectOption(SAISON.s2027);
    await attendreEtVerifierTheme(page, theme);
    await capturer(page, `planches-${theme}`);

    await page.getByRole('button', { name: 'Nouvelle série' }).click();
    await expect(page.getByRole('dialog', { name: 'Nouvelle série' })).toBeVisible();
    await attendreEtVerifierTheme(page, theme);
    await capturer(page, `serie-${theme}`);
    await page.getByRole('dialog', { name: 'Nouvelle série' }).getByRole('button', { name: 'Fermer' }).click();

    await onglet(page, 'Ferme').click();
    await expect(page.getByRole('button', { name: 'Exporter toute ma ferme', exact: true })).toBeVisible();
    await attendreEtVerifierTheme(page, theme);
    await capturer(page, `ferme-${theme}`);
    expect(await violations()).toEqual([]);
  });

  test(`captures ${theme} : Itinéraires (le téléphone est en ${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme === 'sombre' ? 'dark' : 'light' });
    const jour = new Date().toLocaleDateString('sv-SE');
    const ferme = fermeItineraires(jour);
    await amorcer(page, `/diagnostic/amorcer.html?jeu=itineraires&date=${jour}`, ferme);
    await connecter(page, ferme.utilisateurId);
    await onglet(page, 'Ferme').click();
    await page.getByRole('button', { name: 'Mes itinéraires' }).click();
    await expect(page.getByRole('dialog', { name: 'Mes itinéraires' })).toBeVisible();
    await attendreEtVerifierTheme(page, theme);
    await capturer(page, `itineraires-${theme}`);
  });
}

test('Ferme : « Apparence », trois choix de 56 px, un tap change data-theme et le stockage', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10', email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
  await onglet(page, 'Ferme').click();

  await expect(page.getByText('Apparence').first()).toBeVisible();
  const groupe = page.getByRole('radiogroup', { name: 'Apparence' });
  await expect(groupe).toBeVisible();
  const choix = { systeme: groupe.getByRole('radio', { name: 'Comme le téléphone' }), clair: groupe.getByRole('radio', { name: 'Clair', exact: true }), sombre: groupe.getByRole('radio', { name: 'Sombre', exact: true }) };
  await expect(choix.systeme).toBeChecked();
  for (const [nom, c] of Object.entries(choix)) {
    // La cible tactile est le radio, ou son libellé quand le radio natif est masqué.
    const cible = (await c.evaluate((el) => (el.closest('label') !== null ? 'label' : 'self'))) === 'label' ? c.locator('xpath=ancestor::label[1]') : c;
    const boite = await cible.boundingBox();
    expect(boite, `choix ${nom} visible`).not.toBeNull();
    expect(boite?.height ?? 0, `choix ${nom} : hauteur`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
    expect(boite?.width ?? 0, `choix ${nom} : largeur`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
  }

  await choix.sombre.click();
  await expect(choix.sombre).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('sombre');
  expect(await page.evaluate(() => localStorage.getItem('planif.theme'))).toBe('sombre');
  await attendreEtVerifierTheme(page, 'sombre');

  await choix.clair.click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('clair');
  expect(await page.evaluate(() => localStorage.getItem('planif.theme'))).toBe('clair');
  await attendreEtVerifierTheme(page, 'clair');

  // « Clair » forcé tient même quand le téléphone passe en sombre.
  await page.emulateMedia({ colorScheme: 'dark' });
  await attendreEtVerifierTheme(page, 'clair');

  await choix.systeme.click();
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('planif.theme'))).toBeNull();
  await attendreEtVerifierTheme(page, 'sombre'); // le téléphone est en sombre
});

test('« Sombre » forcé, téléphone en clair : un rechargement n’affiche jamais de fond clair', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const session = JSON.stringify({ utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10', email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) });
  await page.goto('/');
  await page.evaluate(
    ([c1, v1, c2, v2]) => {
      localStorage.setItem(c1, v1);
      localStorage.setItem(c2, v2);
    },
    [CLE_SESSION, session, 'planif.theme', 'clair'] as const,
  );
  // « Clair » forcé d'abord : couleur de la barre du navigateur de référence.
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
  const barreClair = await page.locator('meta[name="theme-color"]').getAttribute('content');
  await page.evaluate(() => {
    localStorage.setItem('planif.theme', 'sombre');
  });

  // À chaque image, dès le début du document : thème posé et fond du body sombre (jamais clair).
  await page.addInitScript(() => {
    interface Releve {
      image: number;
      theme: string | null;
      fond: string | null;
    }
    const releves: Releve[] = [];
    (window as unknown as { __releves: Releve[] }).__releves = releves;
    let image = 0;
    const lire = () => {
      releves.push({
        image: image++,
        theme: document.documentElement.getAttribute('data-theme'),
        // <body> n'existe pas encore aux premières images (le type du DOM l'ignore).
        fond: (document.body as HTMLElement | null) === null ? null : getComputedStyle(document.body).backgroundColor,
      });
      if (image < 600) requestAnimationFrame(lire);
    };
    requestAnimationFrame(lire);
  });
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
  await page.waitForTimeout(500);

  const releves = await page.evaluate(() => (window as unknown as { __releves: { image: number; theme: string | null; fond: string | null }[] }).__releves);
  expect(releves.length, 'des images relevées').toBeGreaterThan(3);
  const clairs: string[] = [];
  for (const r of releves) {
    if (r.theme !== 'sombre') clairs.push(`image ${String(r.image)} : data-theme=${String(r.theme)}`);
    if (r.fond !== null) {
      const [rr, vv, bb] = (/rgba?\(([^)]+)\)/.exec(r.fond)?.[1] ?? '255,255,255').split(/[ ,/]+/).filter((x) => x !== '').slice(0, 3).map(Number);
      if (((rr ?? 255) + (vv ?? 255) + (bb ?? 255)) / 3 > 100) clairs.push(`image ${String(r.image)} : fond ${r.fond}`);
    }
  }
  expect(clairs, 'aucun affichage en thème clair ni à fond clair').toEqual([]);
  await attendreEtVerifierTheme(page, 'sombre');
  const barreSombre = await page.locator('meta[name="theme-color"]').getAttribute('content');
  expect(barreSombre, 'theme-color adapté au sombre').not.toBe(barreClair);
});

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T16 — habillage de l'appli comme les maquettes validées (docs/maquettes/, Ferme sur
 * https://claude.ai/artifact/CkYjAD2qX9mxw3FNLT9miP), sur un téléphone de 390 × 844.
 *
 * Contrat (en plus des composants : src/ui/composants.test.tsx, et des jetons : src/ui/jetons.test.ts) :
 *
 * Écran de connexion (maquette « Connexion ») :
 *   - bandeau vert : le titre h1 « Planifications » (Archivo, ≥ 32 px, couleur surForet) posé sur
 *     la forêt (premier fond opaque de ses ancêtres) ;
 *   - carte claire data-testid="carte-connexion" : fond #EEF1E8, coins du haut arrondis
 *     (≥ 20 px), sous le titre et collée au bas de l'écran ; elle contient les champs ;
 *   - bouton principal (« Recevoir un code ») : ≥ 56 px, forêt, Archivo ; texte en Atkinson
 *     Hyperlegible ;
 *   - étape code : six cases data-testid="case-code" (aria-hidden="true", ≥ 48 px de haut) qui
 *     montrent les chiffres saisis dans l'unique champ (les tests de T09 restent vrais :
 *     un seul champ, libellé « code », focus, envoi au 6e chiffre).
 * Coquille (connecté) :
 *   - barre de navigation basse <nav aria-label="Navigation principale">, collée au bas de
 *     l'écran, fond blanc, quatre boutons dans l'ordre Aujourd'hui, Planches, Dicter, Ferme,
 *     chacun ≥ 48 × 48 px, aria-current="page" sur l'onglet affiché ; au démarrage : Aujourd'hui ;
 *   - chaque onglet : en-tête vert avec un h1 au nom de l'onglet (Archivo) ;
 *   - Aujourd'hui, Planches, Dicter : écran d'attente propre, un texte « Bientôt : … » ;
 *   - Ferme (maquette « Ferme ») : bouton « Exporter toute ma ferme » (T15) et bouton
 *     « Se déconnecter » (T09b, texte orange #9A4A0F), noms accessibles exacts, ≥ 48 px ;
 *   - aucun défilement horizontal ; aucune violation de la CSP.
 * Variables CSS : `--couleur-fond` est définie sur :root (valeur des jetons).
 *
 * Captures (non comparées au pixel ; le relecteur les regarde) : apps/web/e2e/captures/*.png,
 * 780 × 1688 px (390 × 844, densité 2) : connexion-email, connexion-code, aujourdhui, planches,
 * dicter, ferme. Le dossier est ignoré par git (captures/.gitignore).
 */

const LARGEUR = 390;
const HAUTEUR = 844;
const DENSITE = 2;
const CIBLE_MIN_PX = 48;
const DOSSIER_CAPTURES = fileURLToPath(new URL('captures/', import.meta.url));

const FORET = 'rgb(31, 77, 58)';
const FOND = 'rgb(238, 241, 232)';
const SURFACE = 'rgb(255, 255, 255)';
const SUR_FORET = 'rgb(244, 247, 239)';
const TEXTE_ORANGE = 'rgb(154, 74, 15)';

const SESSION = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

// API simulée par page.route : le service worker intercepterait les requêtes avant.
test.use({ viewport: { width: LARGEUR, height: HAUTEUR }, deviceScaleFactor: DENSITE, serviceWorkers: 'block' });

/** Capture de l'écran entier (polices chargées), puis vérifie le fichier : PNG de 780 × 1688. */
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

async function styleCalcule(cible: Locator, propriete: string): Promise<string> {
  return cible.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), propriete);
}

/** Premier fond opaque en remontant les ancêtres (l'élément compris). */
async function fondOpaque(cible: Locator): Promise<string> {
  return cible.evaluate((el) => {
    for (let e: Element | null = el; e !== null; e = e.parentElement) {
      const fond = getComputedStyle(e).backgroundColor;
      if (fond !== 'rgba(0, 0, 0, 0)' && fond !== 'transparent') return fond;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
}

/** Couleur du texte : celle de l'élément le plus profond qui porte ce texte. */
async function couleurTexte(cible: Locator, texte: string): Promise<string> {
  return cible.evaluate((el, t) => {
    const candidats = [el, ...el.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() === t));
    const porteur = candidats.at(-1) ?? el;
    return getComputedStyle(porteur).color;
  }, texte);
}

async function assezGrand(cible: Locator, nom: string, min = CIBLE_MIN_PX): Promise<void> {
  const boite = await cible.boundingBox();
  expect(boite, `${nom} visible`).not.toBeNull();
  expect(boite?.height ?? 0, `${nom} : hauteur`).toBeGreaterThanOrEqual(min);
  expect(boite?.width ?? 0, `${nom} : largeur`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
}

async function sansDefilementHorizontal(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(LARGEUR);
}

async function ouvrirConnecte(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(([cle, valeur]) => {
    localStorage.setItem(cle, valeur);
  }, [CLE_SESSION, JSON.stringify(SESSION)] as const);
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string | RegExp) => navigation(page).locator('button').filter({ hasText: libelle });

/** En-tête vert : h1 au nom de l'écran, en Archivo, sur la forêt. */
async function enTeteVert(page: Page, titre: string | RegExp): Promise<void> {
  const h1 = page.getByRole('heading', { level: 1, name: titre });
  await expect(h1).toBeVisible();
  expect(await styleCalcule(h1, 'font-family')).toMatch(/^\s*["']?Archivo\b/);
  expect(await fondOpaque(h1)).toBe(FORET);
}

test('connexion : bandeau vert, titre, carte claire, gros bouton, cases du code', async ({ page }) => {
  await page.route('**/auth/code', (route) => route.fulfill({ status: 202, json: { ok: true } }));
  await page.route('**/auth/verifier', (route) =>
    route.fulfill({ status: 200, json: { utilisateurId: SESSION.utilisateurId, jetonAcces: SESSION.jetonAcces, jetonRenouvellement: SESSION.jetonRenouvellement } }),
  );
  const violations = await surveillerCsp(page);
  await page.goto('/');

  // Variables CSS des jetons en place.
  expect((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--couleur-fond'))).trim().toUpperCase()).toBe('#EEF1E8');

  // Bandeau vert et titre.
  const titre = page.getByRole('heading', { level: 1, name: 'Planifications' });
  await expect(titre).toBeVisible();
  expect(await styleCalcule(titre, 'font-family')).toMatch(/^\s*["']?Archivo\b/);
  expect(parseFloat(await styleCalcule(titre, 'font-size'))).toBeGreaterThanOrEqual(32);
  expect(await styleCalcule(titre, 'color')).toBe(SUR_FORET);
  expect(await fondOpaque(titre)).toBe(FORET);

  // Carte claire, en bas, sous le titre, qui porte le champ.
  const carte = page.getByTestId('carte-connexion');
  await expect(carte).toBeVisible();
  expect(await styleCalcule(carte, 'background-color')).toBe(FOND);
  expect(parseFloat(await styleCalcule(carte, 'border-top-left-radius'))).toBeGreaterThanOrEqual(20);
  expect(parseFloat(await styleCalcule(carte, 'border-top-right-radius'))).toBeGreaterThanOrEqual(20);
  const boiteTitre = await titre.boundingBox();
  const boiteCarte = await carte.boundingBox();
  expect(boiteCarte?.y ?? 0).toBeGreaterThanOrEqual((boiteTitre?.y ?? 0) + (boiteTitre?.height ?? 0));
  expect((boiteCarte?.y ?? 0) + (boiteCarte?.height ?? 0)).toBeGreaterThanOrEqual(HAUTEUR - 1);
  const email = page.getByLabel(/adresse e-mail/i);
  await expect(carte.getByLabel(/adresse e-mail/i)).toBeVisible();
  expect(await styleCalcule(email, 'font-family')).toMatch(/^\s*["']?Atkinson Hyperlegible\b/);

  // Bouton principal.
  const recevoir = page.getByRole('button', { name: /recevoir un code/i });
  await assezGrand(recevoir, 'Recevoir un code', 56);
  expect(await styleCalcule(recevoir, 'background-color')).toBe(FORET);
  expect(await styleCalcule(recevoir, 'font-family')).toMatch(/^\s*["']?Archivo\b/);
  await sansDefilementHorizontal(page);
  await capturer(page, 'connexion-email');

  // Étape code : six cases qui montrent la saisie.
  await email.fill(SESSION.email);
  await recevoir.click();
  const code = page.getByLabel(/code/i);
  await expect(code).toBeFocused();
  const cases = page.getByTestId('case-code');
  await expect(cases).toHaveCount(6);
  for (const [i, c] of (await cases.all()).entries()) {
    await expect(c).toBeVisible();
    expect(await c.getAttribute('aria-hidden'), `case ${String(i + 1)}`).toBe('true');
    const boite = await c.boundingBox();
    expect(boite?.height ?? 0, `case ${String(i + 1)} : hauteur`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
  }
  await page.keyboard.type('482');
  await expect(cases).toHaveText(['4', '8', '2', '', '', '']);
  await sansDefilementHorizontal(page);
  await capturer(page, 'connexion-code');

  await page.keyboard.type('015');
  await expect(navigation(page)).toBeVisible();
  expect(await violations()).toEqual([]);
});

test('coquille : barre de navigation basse, onglets, écrans d’attente', async ({ page }) => {
  const violations = await surveillerCsp(page);
  await ouvrirConnecte(page);

  const nav = navigation(page);
  await expect(nav).toBeVisible();
  const boutons = nav.locator('button');
  await expect(boutons).toHaveText([/Aujourd['’]hui/, 'Planches', 'Dicter', 'Ferme']);
  for (const [i, b] of (await boutons.all()).entries()) await assezGrand(b, `onglet ${String(i + 1)}`);
  const boiteNav = await nav.boundingBox();
  expect((boiteNav?.y ?? 0) + (boiteNav?.height ?? 0), 'barre collée au bas de l’écran').toBeGreaterThanOrEqual(HAUTEUR - 1);
  expect(await fondOpaque(nav)).toBe(SURFACE);

  // Au démarrage : Aujourd'hui.
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(onglet(page, /Aujourd['’]hui/)).toHaveAttribute('aria-current', 'page');
  await enTeteVert(page, /Aujourd['’]hui/);
  await expect(page.getByText(/^Bientôt : .+/)).toBeVisible();
  await sansDefilementHorizontal(page);
  await capturer(page, 'aujourdhui');

  for (const [libelle, capture] of [
    ['Planches', 'planches'],
    ['Dicter', 'dicter'],
  ] as const) {
    await onglet(page, libelle).click();
    await expect(onglet(page, libelle)).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await enTeteVert(page, libelle);
    await expect(page.getByText(/^Bientôt : .+/)).toBeVisible();
    await sansDefilementHorizontal(page);
    await capturer(page, capture);
  }
  expect(await violations()).toEqual([]);
});

test('Ferme : exporter toute ma ferme et se déconnecter, comme la maquette', async ({ page }) => {
  const violations = await surveillerCsp(page);
  await ouvrirConnecte(page);
  await onglet(page, 'Ferme').click();
  await expect(onglet(page, 'Ferme')).toHaveAttribute('aria-current', 'page');
  await enTeteVert(page, 'Ferme');

  // Lignes sur des cartes blanches, comme la maquette.
  const exporter = page.getByRole('button', { name: 'Exporter toute ma ferme', exact: true });
  await expect(exporter).toBeVisible();
  expect(await fondOpaque(exporter)).toBe(SURFACE);
  await assezGrand(exporter, 'Exporter toute ma ferme');

  const deconnecter = page.getByRole('button', { name: 'Se déconnecter', exact: true });
  await expect(deconnecter).toBeVisible();
  await assezGrand(deconnecter, 'Se déconnecter');
  expect(await couleurTexte(deconnecter, 'Se déconnecter')).toBe(TEXTE_ORANGE);

  await sansDefilementHorizontal(page);
  await capturer(page, 'ferme');
  expect(await violations()).toEqual([]);
});

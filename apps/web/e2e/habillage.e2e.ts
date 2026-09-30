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
 * Écran de connexion (maquette « Connexion », docs/maquettes/Connexion.dc.html) :
 *   - bandeau vert : le titre h1 « Planifications » (Archivo, ≥ 32 px, couleur surForet) posé sur
 *     la forêt (premier fond opaque de ses ancêtres) ;
 *   - motif : dans le svg décoratif (aria-hidden="true"), huit pousses (<circle>) : cinq opaques
 *     et trois à 60 % d'opacité (opacity calculée 0,6), comme la maquette ;
 *   - carte claire data-testid="carte-connexion" : fond #EEF1E8, coins du haut arrondis
 *     (≥ 20 px), sous le titre et collée au bas de l'écran ; elle contient les champs ;
 *   - bouton principal (« Recevoir un code ») : ≥ 56 px, forêt, Archivo ; texte en Atkinson
 *     Hyperlegible ;
 *   - étape code : six cases data-testid="case-code" (aria-hidden="true", ≥ 48 px de haut) qui
 *     montrent les chiffres saisis dans l'unique champ (les tests de T09 restent vrais :
 *     un seul champ, libellé « code », focus, envoi au 6e chiffre) ;
 *     texte d'aide exact « Envoyé à <adresse> · valable 10 minutes » ;
 *     curseur data-testid="curseur-code" (un seul, aria-hidden par sa case) dans la case active,
 *     celle du prochain chiffre : ≥ 2 px de large, ≥ 24 px de haut, fond forêt ;
 *     bouton « Se connecter » (nom exact) désactivé tant que les 6 chiffres ne sont pas saisis ;
 *     bouton « Renvoyer un code » : un tap redemande un code (POST /auth/code, même adresse) et
 *     reste sur l'étape code ; « Changer d'adresse » reste.
 * Coquille (connecté) :
 *   - barre de navigation basse <nav aria-label="Navigation principale">, collée au bas de
 *     l'écran, fond blanc, quatre boutons dans l'ordre Aujourd'hui, Planches, Dicter, Ferme,
 *     chacun ≥ 48 × 48 px, aria-current="page" sur l'onglet affiché ; au démarrage : Aujourd'hui ;
 *   - chaque onglet : en-tête vert avec un h1 au nom de l'onglet (Archivo), interlettrage
 *     −0,01em ; 34 px pour Aujourd'hui, 32 px pour Planches, Dicter et Ferme ;
 *   - Aujourd'hui, Dicter : écran d'attente propre, un texte « Bientôt : … » ; Planches (T11) :
 *     l'écran de la vue 2D (e2e/plan.e2e.ts), plus de « Bientôt » ; ici, sans ferme dans la
 *     base locale (session factice), il reste propre : en-tête, pas de défilement horizontal ;
 *   - Ferme (maquette « Ferme ») : bouton « Exporter toute ma ferme » (T15) et bouton
 *     « Se déconnecter » (T09b, texte orange #9A4A0F), noms accessibles exacts, ≥ 48 px ;
 *     intitulé de section h2 « Mes données » en Atkinson Hyperlegible 700, majuscules
 *     (text-transform: uppercase), interlettrage ≥ 0,05em. Décision du testeur (relecture, point
 *     8) : pas d'Archivo à largeur 100 % pour les intitulés, qui demanderait un second fichier
 *     de police ; Archivo ne sert plus qu'aux titres, à 112 % (voir src/ui/polices.test.ts) ;
 *   - Ferme, effacement en attente : si effacementsEnAttente() n'est pas vide (clé
 *     'planif.effacement-en-attente' du localStorage, un autre compte), une alerte (role="alert")
 *     dit exactement « Les données d'un ancien compte n'ont pas encore été effacées de ce
 *     téléphone : fermez les autres onglets. » (apostrophe droite ou typographique) ; sans
 *     effacement en attente, pas d'alerte ;
 *   - aucun défilement horizontal ; aucune violation de la CSP.
 * Zoom et petits écrans (relecture, point 1) : à 195 × 422 (390 × 844 zoomé à 200 %), 320 × 568
 * et en paysage 844 × 390, sur la connexion (étapes e-mail et code), chaque onglet et l'écran
 * Ferme : aucun défilement horizontal ; aucun élément (hors svg décoratif aria-hidden) ne sort de
 * la largeur de l'écran ; aucun titre, paragraphe, bouton ou libellé dont le texte déborde de sa
 * boîte (scrollWidth ≤ clientWidth) ; le h1 reste dans son bandeau (dans le <header> de la
 * coquille ; au-dessus de la carte, sur la forêt, à la connexion) ; les quatre onglets de la barre
 * entièrement visibles dans l'écran et cliquables (un clic sur Ferme l'ouvre).
 * Focus au clavier (relecture, point 2) : chaque élément atteint par Tab (champs, boutons, onglets,
 * lignes de l'écran Ferme ; champs nommés par leur attribut name : email, code) montre un contour `outline` plein (style ni none, ni hidden, ni auto)
 * d'au moins 3 px, de contraste ≥ 3:1 avec le fond adjacent (le fond opaque du parent si
 * outline-offset ≥ 0, sinon celui de l'élément), jamais rogné : le bord extérieur du contour reste
 * dans l'écran et dans la zone visible de chaque ancêtre dont overflow n'est pas visible.
 * Exception : le champ du code, invisible, montre son focus par le bord de la case active (la
 * seule case dont border-top-width ≥ 3 px), mêmes règles de contraste (avec le fond autour de la
 * case) et de rognage.
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

/** Alerte de l'écran Ferme quand un effacement reste en attente (relecture, point 6). */
const ALERTE_EFFACEMENT = /^Les données d['’]un ancien compte n['’]ont pas encore été effacées de ce téléphone : fermez les autres onglets\.$/;
const CLE_EFFACEMENT_EN_ATTENTE = 'planif.effacement-en-attente';
const AUTRE_COMPTE = '0192f0c1-7a6e-7cc3-9b1e-000000000002';

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

/** Curseur visible dans la case du prochain chiffre (indice à partir de 0). */
async function curseurDansLaCase(page: Page, indice: number): Promise<void> {
  const curseur = page.getByTestId('curseur-code');
  await expect(curseur).toHaveCount(1);
  await expect(curseur).toBeVisible();
  const boite = await curseur.boundingBox();
  const laCase = await page.getByTestId('case-code').nth(indice).boundingBox();
  expect(boite, 'curseur').not.toBeNull();
  expect(laCase, `case ${String(indice + 1)}`).not.toBeNull();
  if (boite === null || laCase === null) return;
  expect(boite.width, 'curseur : largeur').toBeGreaterThanOrEqual(2);
  expect(boite.height, 'curseur : hauteur').toBeGreaterThanOrEqual(24);
  expect(boite.x, `curseur dans la case ${String(indice + 1)}`).toBeGreaterThanOrEqual(laCase.x);
  expect(boite.x + boite.width).toBeLessThanOrEqual(laCase.x + laCase.width);
  expect(boite.y).toBeGreaterThanOrEqual(laCase.y);
  expect(boite.y + boite.height).toBeLessThanOrEqual(laCase.y + laCase.height);
  expect(await styleCalcule(curseur, 'background-color'), 'curseur : forêt').toBe(FORET);
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
async function enTeteVert(page: Page, titre: string | RegExp, taillePx = 32): Promise<void> {
  const h1 = page.getByRole('heading', { level: 1, name: titre });
  await expect(h1).toBeVisible();
  expect(await styleCalcule(h1, 'font-family')).toMatch(/^\s*["']?Archivo\b/);
  expect(await fondOpaque(h1)).toBe(FORET);
  expect(parseFloat(await styleCalcule(h1, 'font-size')), `${String(titre)} : taille`).toBe(taillePx);
  expect(parseFloat(await styleCalcule(h1, 'letter-spacing')), `${String(titre)} : interlettrage −0,01em`).toBeCloseTo(-0.01 * taillePx, 2);
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

  // Motif : cinq pousses opaques, trois à 60 %.
  const pousses = page.locator('svg[aria-hidden="true"] circle');
  await expect(pousses).toHaveCount(8);
  const opacites = await pousses.evaluateAll((cercles) => cercles.map((c) => Number(getComputedStyle(c).opacity)));
  expect(opacites.filter((o) => Math.abs(o - 1) < 0.01), 'pousses opaques').toHaveLength(5);
  expect(opacites.filter((o) => Math.abs(o - 0.6) < 0.01), 'pousses à 60 %').toHaveLength(3);

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
  await expect(carte.getByText(/^Envoyé à theophane@ferme\.fr · valable 10 minutes$/)).toBeVisible();
  const seConnecter = page.getByRole('button', { name: 'Se connecter', exact: true });
  await expect(seConnecter).toBeVisible();
  await expect(seConnecter).toBeDisabled();
  await expect(page.getByRole('button', { name: /renvoyer un code/i })).toBeVisible();
  await curseurDansLaCase(page, 0);
  await page.keyboard.type('482');
  await expect(cases).toHaveText(['4', '8', '2', '', '', '']);
  await expect(seConnecter).toBeDisabled();
  await curseurDansLaCase(page, 3);
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
  await enTeteVert(page, /Aujourd['’]hui/, 34);
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
    // T11 : Planches n'est plus un écran d'attente (vue 2D, e2e/plan.e2e.ts).
    if (libelle === 'Planches') await expect(page.getByText(/^Bientôt : .+/)).toHaveCount(0);
    else await expect(page.getByText(/^Bientôt : .+/)).toBeVisible();
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

  // Intitulé de section : Atkinson Hyperlegible 700, majuscules espacées.
  const intitule = page.getByRole('heading', { level: 2, name: /^mes données$/i });
  await expect(intitule).toBeVisible();
  expect(await styleCalcule(intitule, 'font-family')).toMatch(/^\s*["']?Atkinson Hyperlegible\b/);
  expect(await styleCalcule(intitule, 'font-weight')).toBe('700');
  expect(await styleCalcule(intitule, 'text-transform')).toBe('uppercase');
  const taille = parseFloat(await styleCalcule(intitule, 'font-size'));
  expect(parseFloat(await styleCalcule(intitule, 'letter-spacing')), 'interlettrage ≥ 0,05em').toBeGreaterThanOrEqual(0.05 * taille - 0.005);
  await expect(page.getByText(ALERTE_EFFACEMENT)).toHaveCount(0);

  await sansDefilementHorizontal(page);
  await capturer(page, 'ferme');
  expect(await violations()).toEqual([]);
});

test('Ferme : un effacement en attente est signalé par une alerte orange', async ({ page }) => {
  // Session et marqueur posés ensemble : sans session, l'écran de connexion reprendrait
  // l'effacement (et le réussirait, la base de l'autre compte n'existant pas ici).
  await page.goto('/');
  // T20 : attendre l'écran de connexion avant de poser la marque. Sinon, chargé à la demande,
  // il peut démarrer après elle, reprendre l'effacement et l'effacer avant le rechargement
  // (6 échecs sur 30 sur main). Même course que deconnexion.e2e.ts, corrigée dans T19.
  await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible();
  await page.evaluate(
    ([cleSession, session, cleEffacement, enAttente]) => {
      localStorage.setItem(cleSession, session);
      localStorage.setItem(cleEffacement, enAttente);
    },
    [CLE_SESSION, JSON.stringify(SESSION), CLE_EFFACEMENT_EN_ATTENTE, JSON.stringify([AUTRE_COMPTE])] as const,
  );
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
  await onglet(page, 'Ferme').click();
  await expect(page.getByRole('button', { name: 'Exporter toute ma ferme', exact: true })).toBeVisible();
  const alerte = page.getByRole('alert').filter({ hasText: ALERTE_EFFACEMENT });
  await expect(alerte).toBeVisible();
  await expect(alerte).toHaveText(ALERTE_EFFACEMENT);
});

test('connexion : « Renvoyer un code » redemande un code pour la même adresse', async ({ page }) => {
  const demandes: unknown[] = [];
  await page.route('**/auth/code', async (route) => {
    demandes.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.goto('/');
  await page.getByLabel(/adresse e-mail/i).fill(SESSION.email);
  await page.getByRole('button', { name: /recevoir un code/i }).click();
  await expect(page.getByLabel(/code/i)).toBeVisible();
  await page.getByRole('button', { name: /renvoyer un code/i }).click();
  await expect.poll(() => demandes.length).toBe(2);
  expect(demandes).toEqual([{ email: SESSION.email }, { email: SESSION.email }]);
  await expect(page.getByLabel(/code/i)).toBeVisible();
  await expect(page.getByTestId('case-code')).toHaveCount(6);
});

// ── Zoom 200 % et petits écrans (relecture, point 1) ─────────────────────────────────────────

/** Éléments qui sortent de la largeur de l'écran, et textes qui débordent de leur boîte. */
async function horsDeLaLargeur(page: Page, largeur: number): Promise<string[]> {
  return page.evaluate((l) => {
    const fautes: string[] = [];
    const nom = (e: Element) => `${e.tagName.toLowerCase()} « ${e.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)} »`;
    for (const e of document.querySelectorAll('[data-testid="app"] *')) {
      if (e.closest('svg[aria-hidden="true"]') !== null) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < -0.5 || r.right > l + 0.5) fautes.push(`${nom(e)} sort de l’écran : ${r.left.toFixed(1)} → ${r.right.toFixed(1)}`);
      const texte = ['H1', 'H2', 'P', 'BUTTON', 'LABEL', 'SPAN'].includes(e.tagName);
      if (texte && e instanceof HTMLElement && getComputedStyle(e).display !== 'inline' && e.scrollWidth > e.clientWidth + 1) {
        fautes.push(`${nom(e)} : texte qui déborde (${String(e.scrollWidth)} > ${String(e.clientWidth)})`);
      }
    }
    return fautes;
  }, largeur);
}

async function sansDebordement(page: Page, largeur: number, ecran: string): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${ecran} : défilement horizontal`).toBeLessThanOrEqual(largeur);
  expect(await horsDeLaLargeur(page, largeur), ecran).toEqual([]);
}

/** Boîte entièrement dans l'écran. */
async function dansLEcran(cible: Locator, nom: string, largeur: number, hauteur: number): Promise<void> {
  await expect(cible, nom).toBeVisible();
  const b = await cible.boundingBox();
  expect(b, nom).not.toBeNull();
  if (b === null) return;
  expect(b.x, `${nom} : bord gauche`).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, `${nom} : bord droit`).toBeLessThanOrEqual(largeur + 0.5);
  expect(b.y, `${nom} : haut`).toBeGreaterThanOrEqual(-0.5);
  expect(b.y + b.height, `${nom} : bas`).toBeLessThanOrEqual(hauteur + 0.5);
}

/** Boîte de `interieur` contenue dans celle de `exterieur`. */
async function contenu(interieur: Locator, exterieur: Locator, nom: string): Promise<void> {
  const i = await interieur.boundingBox();
  const e = await exterieur.boundingBox();
  expect(i, nom).not.toBeNull();
  expect(e, nom).not.toBeNull();
  if (i === null || e === null) return;
  expect(i.x, `${nom} : gauche`).toBeGreaterThanOrEqual(e.x - 0.5);
  expect(i.y, `${nom} : haut`).toBeGreaterThanOrEqual(e.y - 0.5);
  expect(i.x + i.width, `${nom} : droite`).toBeLessThanOrEqual(e.x + e.width + 0.5);
  expect(i.y + i.height, `${nom} : bas`).toBeLessThanOrEqual(e.y + e.height + 0.5);
}

for (const { nom, largeur, hauteur } of [
  { nom: 'zoom 200 % (195 × 422)', largeur: 195, hauteur: 422 },
  { nom: 'petit écran (320 × 568)', largeur: 320, hauteur: 568 },
  { nom: 'paysage (844 × 390)', largeur: 844, hauteur: 390 },
] as const) {
  test.describe(nom, () => {
    test.use({ viewport: { width: largeur, height: hauteur } });

    test('connexion : rien ne déborde, le titre reste dans le bandeau', async ({ page }) => {
      await page.route('**/auth/code', (route) => route.fulfill({ status: 202, json: { ok: true } }));
      await page.goto('/');
      const email = page.getByLabel(/adresse e-mail/i);
      await expect(email).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const titre = page.getByRole('heading', { level: 1, name: 'Planifications' });
      expect(await fondOpaque(titre)).toBe(FORET);
      const boiteTitre = await titre.boundingBox();
      const boiteCarte = await page.getByTestId('carte-connexion').boundingBox();
      expect((boiteTitre?.y ?? 0) + (boiteTitre?.height ?? 0), 'titre au-dessus de la carte').toBeLessThanOrEqual((boiteCarte?.y ?? 0) + 0.5);
      await sansDebordement(page, largeur, 'connexion, e-mail');

      await email.fill(SESSION.email);
      await page.getByRole('button', { name: /recevoir un code/i }).click();
      await expect(page.getByLabel(/code/i)).toBeFocused();
      await page.keyboard.type('48');
      await expect(page.getByTestId('case-code').first()).toHaveText('4');
      await sansDebordement(page, largeur, 'connexion, code');
    });

    test('coquille et Ferme : rien ne déborde, les quatre onglets visibles et cliquables', async ({ page }) => {
      await ouvrirConnecte(page);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const boutons = navigation(page).locator('button');
      await expect(boutons).toHaveCount(4);
      for (const [i, b] of (await boutons.all()).entries()) await dansLEcran(b, `onglet ${String(i + 1)}`, largeur, hauteur);

      for (const libelle of [/Aujourd['’]hui/, 'Planches', 'Dicter', 'Ferme'] as const) {
        await onglet(page, libelle).click();
        await expect(onglet(page, libelle)).toHaveAttribute('aria-current', 'page');
        const h1 = page.getByRole('heading', { level: 1, name: libelle });
        await expect(h1).toBeVisible();
        await contenu(h1, h1.locator('xpath=ancestor::header[1]'), `${String(libelle)} : h1 dans l’en-tête`);
        if (libelle === 'Ferme') await expect(page.getByRole('button', { name: 'Exporter toute ma ferme', exact: true })).toBeVisible();
        await sansDebordement(page, largeur, String(libelle));
        for (const [i, b] of (await boutons.all()).entries()) await dansLEcran(b, `${String(libelle)}, onglet ${String(i + 1)}`, largeur, hauteur);
      }
    });
  });
}

// ── Focus au clavier (relecture, point 2) ────────────────────────────────────────────────────

interface FocusVu {
  /** Position de l'élément dans le document : repère un tour complet. */
  readonly cle: number;
  readonly nom: string;
  readonly style: string;
  readonly largeur: number;
  readonly couleur: string;
  readonly fond: string;
  readonly rogne: string | null;
}

/** Contour de focus de l'élément actif (null : rien de focalisé). */
async function focusActuel(page: Page): Promise<FocusVu | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return null;
    const fondOpaque = (depart: Element | null): string => {
      for (let e = depart; e !== null; e = e.parentElement) {
        const f = getComputedStyle(e).backgroundColor;
        if (f !== 'rgba(0, 0, 0, 0)' && f !== 'transparent') return f;
      }
      return 'rgb(255, 255, 255)';
    };
    // Champ : « champ <name> » ; bouton : son nom accessible (aria-label ou texte).
    const nom = el instanceof HTMLInputElement ? `champ ${el.name}` : (el.getAttribute('aria-label') ?? el.textContent).replace(/\s+/g, ' ').trim();
    const cle = [...document.querySelectorAll('*')].indexOf(el);

    // Champ du code, invisible : le focus se voit au bord de la case active.
    let porteur: HTMLElement = el;
    let style: string;
    let largeur: number;
    let decalage: number;
    let couleur: string;
    let fond: string;
    if (el instanceof HTMLInputElement && el.autocomplete === 'one-time-code') {
      const active = [...document.querySelectorAll<HTMLElement>('[data-testid="case-code"]')].find((c) => parseFloat(getComputedStyle(c).borderTopWidth) >= 3);
      if (active === undefined) return { cle, nom, style: 'aucune case active', largeur: 0, couleur: '', fond: '', rogne: null };
      porteur = active;
      const cs = getComputedStyle(active);
      style = cs.borderTopStyle;
      largeur = parseFloat(cs.borderTopWidth);
      decalage = -largeur;
      couleur = cs.borderTopColor;
      fond = fondOpaque(active.parentElement);
    } else {
      const cs = getComputedStyle(el);
      style = cs.outlineStyle;
      largeur = parseFloat(cs.outlineWidth);
      decalage = parseFloat(cs.outlineOffset);
      couleur = cs.outlineColor;
      fond = decalage >= 0 ? fondOpaque(el.parentElement) : fondOpaque(el);
    }

    // Bord extérieur du contour, comparé à l'écran et aux ancêtres qui rognent.
    const r = porteur.getBoundingClientRect();
    const e = decalage + largeur;
    const bord = { g: r.left - e, h: r.top - e, d: r.right + e, b: r.bottom + e };
    const zones: { nom: string; g: number; h: number; d: number; b: number }[] = [
      { nom: 'écran', g: 0, h: 0, d: document.documentElement.clientWidth, b: window.innerHeight },
    ];
    for (let a = porteur.parentElement; a !== null && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ra = a.getBoundingClientRect();
      const g = ra.left + a.clientLeft;
      const h = ra.top + a.clientTop;
      zones.push({ nom: `${a.tagName.toLowerCase()} (overflow ${cs.overflowX}/${cs.overflowY})`, g, h, d: g + a.clientWidth, b: h + a.clientHeight });
    }
    const rogne = zones.find((z) => bord.g < z.g - 0.5 || bord.h < z.h - 0.5 || bord.d > z.d + 0.5 || bord.b > z.b + 0.5);
    return { cle, nom, style, largeur, couleur, fond, rogne: rogne === undefined ? null : `rogné par ${rogne.nom}` };
  });
}

function luminance(couleur: string): number {
  const m = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/.exec(couleur);
  if (m === null) throw new Error(`couleur illisible : ${couleur}`);
  const [r, v, b] = [m[1], m[2], m[3]].map((c) => {
    const x = Number(c) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (v ?? 0) + 0.0722 * (b ?? 0);
}

function contraste(a: string, b: string): number {
  const [claire, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((claire ?? 0) + 0.05) / ((sombre ?? 0) + 0.05);
}

/** Parcourt la page au clavier (Tab) jusqu'à revenir au premier élément ; vérifie chaque contour. */
async function focusVisibleAuClavier(page: Page, attendus: readonly RegExp[]): Promise<void> {
  const vus: FocusVu[] = [];
  const premier = await focusActuel(page);
  if (premier !== null) vus.push(premier);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const f = await focusActuel(page);
    if (f === null) continue;
    if (vus.some((v) => v.cle === f.cle)) break;
    vus.push(f);
  }
  for (const attendu of attendus) {
    expect(
      vus.some((v) => attendu.test(v.nom)),
      `${String(attendu)} atteint au clavier (vus : ${vus.map((v) => v.nom).join(' | ')})`,
    ).toBe(true);
  }
  for (const v of vus) {
    expect(['none', 'hidden', 'auto'], `« ${v.nom} » : style du contour`).not.toContain(v.style);
    expect(v.largeur, `« ${v.nom} » : épaisseur du contour`).toBeGreaterThanOrEqual(3);
    expect(contraste(v.couleur, v.fond), `« ${v.nom} » : contraste ${v.couleur} / ${v.fond}`).toBeGreaterThanOrEqual(3);
    expect(v.rogne, `« ${v.nom} »`).toBeNull();
  }
}

test('focus au clavier : connexion, contour visible, contrasté, jamais rogné', async ({ page }) => {
  await page.route('**/auth/code', (route) => route.fulfill({ status: 202, json: { ok: true } }));
  await page.goto('/');
  const email = page.getByLabel(/adresse e-mail/i);
  await expect(email).toBeFocused();
  await focusVisibleAuClavier(page, [/^champ email$/, /recevoir un code/i]);

  await email.fill(SESSION.email);
  await page.getByRole('button', { name: /recevoir un code/i }).click();
  await expect(page.getByLabel(/code/i)).toBeFocused();
  await focusVisibleAuClavier(page, [/^champ code$/, /renvoyer un code/i, /changer d['’]adresse/i]);
});

test('focus au clavier : onglets et lignes de l’écran Ferme', async ({ page }) => {
  await ouvrirConnecte(page);
  await onglet(page, 'Ferme').click();
  await expect(page.getByRole('button', { name: 'Exporter toute ma ferme', exact: true })).toBeVisible();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await focusVisibleAuClavier(page, [/Aujourd['’]hui/, /^Planches$/, /^Dicter$/, /^Ferme$/, /^Exporter toute ma ferme$/, /^Se déconnecter$/]);
});

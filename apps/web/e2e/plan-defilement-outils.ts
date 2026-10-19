import { expect, type CDPSession, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';

/**
 * Outils de l'e2e de T50 (plan-defilement-doigt.e2e.ts).
 *
 * T50 — Planches défile au doigt sur un téléphone (docs/backlog/T50-planches-defilement-tel.md).
 *
 * Retour de Théophane (iPhone, appli installée) : « on ne peut pas descendre ». Ferme neuve juste
 * après « Ma ferme » (saison, une zone, 7 planches, pas de série) : le bandeau « Démarrer votre
 * ferme » prend tout l'écran, le plan est poussé sous la barre de navigation, rien ne défile, et la
 * barre « Saison / Voir en 3D / Nouvelle série » est coupée à droite.
 *
 * Chromium (Pixel 7 : écran tactile, appareil mobile), 390 × 844 et 360 × 800 : le doigt glisse
 * vers le haut avec de vrais évènements tactiles (Input.dispatchTouchEvent : toucher, glisser par
 * pas, lever), donc défilement natif au doigt, ni scrollTop ni molette
 * (Input.synthesizeScrollGesture en « touch » ne défile pas du tout en Chromium sans écran).
 *
 * WebKit (Safari iOS, l'appli de Théophane) n'est ni installé ici ni en CI (Chromium seul) : ses
 * causes connues sont vérifiées dans le code (pas de `touch-action`, pas de `preventDefault` au
 * toucher, défilements imbriqués, hauteur en 100dvh d'un conteneur sans débordement), et le
 * chemin qu'un test WebKit aurait pris (défilement natif demandé au point du pouce, page.mouse.wheel :
 * le conteneur défilant sous le point, puis ses ancêtres) est rejoué dans Chromium en plus du doigt.
 *
 * Le doigt se pose là où le maraîcher le pose : au milieu de la partie visible du plan (entre son
 * haut, ou celui de l'écran, et la barre de navigation). Ce qui précède le plan (bandeau replié,
 * zones, barre d'outils) tient au-dessus, et le plan se voit dès l'ouverture (planVisibleDEmblee).
 * Après assez de gestes, la DERNIÈRE ligne du plan doit être visible : au point de sa colonne des
 * codes, le navigateur montre bien cette ligne (ni coupée par un conteneur, ni sous la barre de
 * navigation). Et jamais de défilement horizontal de la page, ni de commande coupée à droite
 * (contrôles « soft » : un débordement n'empêche pas de vérifier aussi le défilement).
 *
 * Cas : ferme de Théophane (1 zone, 7 planches, sans série, bandeau), ferme neuve plus grande
 * (3 zones × 12 planches, sans série, bandeau), la même avec 1 série (le bandeau s'en va), ferme
 * de T07 (400 emplacements, non-régression).
 */

export const DELAI_AMORCAGE_MS = 60_000;
const GESTES_MAX = 80;
export const PAS_PX = 600;

interface Amorcage {
  readonly utilisateurId?: string;
  readonly erreur?: string;
}

export interface Cas {
  readonly nom: string;
  readonly adresse: string;
  readonly bandeau: boolean;
}

const NEUVE = '/diagnostic/amorcer.html?jeu=ferme-neuve';
export const CAS: readonly Cas[] = [
  { nom: 'ferme de Théophane (1 zone, 7 planches, sans série), bandeau', adresse: `${NEUVE}&zones=1&planches=7`, bandeau: true },
  { nom: 'ferme neuve (3 zones × 12 planches, sans série), bandeau', adresse: `${NEUVE}&zones=3&planches=12`, bandeau: true },
  { nom: 'ferme neuve, 1 série, sans bandeau', adresse: `${NEUVE}&zones=3&planches=12&series=1`, bandeau: false },
  { nom: 'ferme de T07', adresse: '/diagnostic/amorcer.html', bandeau: false },
];

export const VUES = [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const;

export async function amorcerEtOuvrir(page: Page, cas: Cas): Promise<void> {
  await page.goto(cas.adresse);
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as Amorcage;
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  expect(a.utilisateurId).toBeDefined();
  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId: a.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  await page.getByRole('navigation', { name: 'Navigation principale' }).locator('button').filter({ hasText: 'Planches' }).click();
  await expect(page.locator('[data-testid="ligne-plan"][data-sorte="emplacement"]').first()).toBeAttached({ timeout: 15_000 });
  if (cas.bandeau) await expect(page.getByTestId('demarrer-ferme')).toBeVisible();
  else await expect(page.getByTestId('demarrer-ferme')).toHaveCount(0);
}

/**
 * Avant tout geste, le plan se voit déjà : au moins `PLAN_VISIBLE_MIN_PX` de sa hauteur entre son
 * haut et la barre de navigation (le bandeau ne prend plus tout l'écran).
 */
export const PLAN_VISIBLE_MIN_PX = 160;
export async function planVisibleDEmblee(page: Page): Promise<void> {
  const visible = await page.evaluate(() => {
    const plan = document.querySelector('[data-testid="plan-defilement"]')?.getBoundingClientRect();
    const bas = document.querySelector('nav')?.getBoundingClientRect().top ?? innerHeight;
    return plan === undefined ? 0 : Math.min(plan.bottom, bas) - Math.max(plan.top, 0);
  });
  expect(visible, 'hauteur du plan visible à l’ouverture (px)').toBeGreaterThanOrEqual(PLAN_VISIBLE_MIN_PX);
}

/** Le bandeau replié se voit en entier : rien ne le recouvre (la bande des zones le suit). */
export async function bandeauEntier(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const dem = document.querySelector('[data-testid="demarrer-ferme"]')?.getBoundingClientRect();
    const zones = document.querySelector('.plan-zones')?.getBoundingClientRect();
    return { basBandeau: dem?.bottom ?? 0, hautZones: zones?.top ?? Infinity };
  });
  expect(m.basBandeau, 'la bande des zones ne recouvre pas le bandeau').toBeLessThanOrEqual(m.hautZones);
}

/** Point où le pouce se pose : le milieu de la partie visible du plan, au-dessus de la barre de navigation. */
async function pointDuPouce(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const plan = document.querySelector('[data-testid="plan-defilement"]')?.getBoundingClientRect();
    const haut = Math.max(plan?.top ?? 0, document.querySelector('header')?.getBoundingClientRect().bottom ?? 0);
    const bas = Math.min(plan?.bottom ?? innerHeight, document.querySelector('nav')?.getBoundingClientRect().top ?? innerHeight);
    return { x: Math.round(innerWidth / 2), y: Math.round((haut + bas) / 2) };
  });
}

/** La dernière ligne du plan est-elle vue à l'écran (au point de sa colonne des codes, c'est bien elle) ? */
async function derniereLigneVue(page: Page): Promise<{ vue: boolean; detail: string }> {
  return page.evaluate(() => {
    const defilement = document.querySelector('[data-testid="plan-defilement"]');
    const lignes = [...document.querySelectorAll<HTMLElement>('[data-testid="ligne-plan"]')];
    const derniere = lignes.reduce<HTMLElement | null>((d, l) => (d === null || Number(l.dataset.index) > Number(d.dataset.index) ? l : d), null);
    if (defilement === null || derniere === null) return { vue: false, detail: 'pas de plan' };
    const fin = defilement.scrollTop + defilement.clientHeight >= defilement.scrollHeight - 1;
    const cadre = defilement.getBoundingClientRect();
    const r = derniere.getBoundingClientRect();
    // Colonne des codes : collée à gauche du plan, quel que soit le défilement horizontal.
    const x = cadre.left + 40;
    const y = r.top + r.height / 2;
    const vu = y >= 0 && y < innerHeight ? document.elementFromPoint(x, y) : null;
    const vue = fin && vu !== null && derniere.contains(vu);
    const page = document.querySelector('.coquille-contenu');
    return {
      vue,
      detail: `index ${String(derniere.dataset.index)}, ligne y=${r.top.toFixed(0)}, plan ${cadre.top.toFixed(0)}–${cadre.bottom.toFixed(0)} (défile ${String(defilement.scrollTop)}/${String(defilement.scrollHeight - defilement.clientHeight)}), contenu ${String(page?.scrollTop ?? 0)}/${String((page?.scrollHeight ?? 0) - (page?.clientHeight ?? 0))}, au point : ${vu === null ? 'rien' : vu.getAttribute('class') ?? vu.tagName}`,
    };
  });
}

/** Rien ne dépasse à droite : ni la page, ni le contenu, ni une commande de la barre d'outils du plan. */
export async function sansDebordement(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const contenu = document.querySelector('.coquille-contenu');
    const commandes = [...document.querySelectorAll('.plan-outils > *')].map((e) => ({ nom: e.textContent.trim(), droite: e.getBoundingClientRect().right }));
    return { largeur: innerWidth, page: document.documentElement.scrollWidth, contenu: contenu === null ? 0 : contenu.scrollWidth - contenu.clientWidth, commandes };
  });
  expect.soft(m.page, 'pas de défilement horizontal de la page').toBeLessThanOrEqual(m.largeur);
  expect.soft(m.contenu, 'le contenu ne déborde pas à droite').toBeLessThanOrEqual(0);
  expect(m.commandes.length).toBeGreaterThan(0);
  for (const c of m.commandes) expect.soft(c.droite, `« ${c.nom} » coupé à droite`).toBeLessThanOrEqual(m.largeur);
}

/** Un glissé du doigt, de (x, y) vers le haut sur `distance` px, puis le doigt se lève. */
export async function glisser(cdp: CDPSession, x: number, y: number, distance: number): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let d = 40; d <= distance; d += 40) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - d }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Le chemin de WebKit : défilement natif demandé au point du pouce, puis une image. */
export async function molette(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, PAS_PX);
  await page.evaluate(() => new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin))));
}

export async function descendreJusquauBout(page: Page, geste: (x: number, y: number) => Promise<void>, titre: string): Promise<void> {
  let etat = await derniereLigneVue(page);
  for (let i = 0; i < GESTES_MAX && !etat.vue; i++) {
    const { x, y } = await pointDuPouce(page);
    await geste(x, y);
    etat = await derniereLigneVue(page);
  }
  console.log(`${titre} : ${etat.detail}`);
  expect(etat.vue, `dernière ligne visible (${etat.detail})`).toBe(true);
}


import { devices, expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { validerContour } from '@planif/core';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ENTREE_PLACEMENT, TESTID_PLACEMENT as T, type Point } from '../src/ecrans/placement/test/contrat.ts';
import { BOUTONS_CONTOURS as B, TESTID_CONTOURS as TC } from '../src/ecrans/placement/test/contrat-contours.ts';
import { fermePlacement, ZONE_CHAMP } from '../src/ecrans/placement/test/ferme-placement.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T28d — contours de zones en formes libres, de bout en bout, sur ordinateur (Chromium
 * 1280 × 800), avec la ferme du placement (?jeu=placement : gérant, sans point de départ, « Plein
 * champ » sans contour). Contrats : src/ecrans/placement/test/contrat.ts (T28b) et
 * src/ecrans/placement/test/contrat-contours.ts (T28d).
 *
 * AUCUN appel réseau réel : les tuiles de data.geopf.fr sont servies par une fausse route (PNG de
 * 1 × 1 px), comme e2e/placement.e2e.ts ; toute autre requête hors de localhost est bloquée.
 *
 *   1. Tracer « Plein champ » en L (6 sommets, à la souris, fermé sur le premier sommet),
 *      enregistrer ; glisser un sommet, enregistrer, « Annuler » → retour exact au L ; recharger
 *      → contour conservé.
 *   2. Au clavier seul : Tab d'un sommet au suivant, Maj+flèche = 1 m, Entrée sur « Enregistrer ».
 *   3. Croiser deux côtés (glisser un sommet au-delà d'un côté) → message de validerContour,
 *      « Enregistrer » inactif, rien d'écrit.
 * Le poids (budget jsPlacementGzKio, démarrage 71 Kio) : scripts/placement.test.ts et `pnpm budget`.
 */

const DELAI_AMORCAGE_MS = 120_000;
/** PNG de 1 × 1 px. */
const IMAGE_TUILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
/** m/px au zoom 19, à 44° N. */
const MPP_19 = 0.214782;

const executablePath = process.env.CHROMIUM_PATH;

test.use({
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  launchOptions: executablePath ? { executablePath } : {},
});

interface Reseau {
  readonly tuiles: string[];
  readonly ailleurs: string[];
}

async function intercepter(context: BrowserContext): Promise<Reseau> {
  const reseau: Reseau = { tuiles: [], ailleurs: [] };
  await context.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://data.geopf.fr') {
        reseau.tuiles.push(url.href);
        await route.fulfill({ status: 200, contentType: 'image/png', body: IMAGE_TUILE });
        return;
      }
      reseau.ailleurs.push(url.href);
      await route.abort('blockedbyclient');
    },
  );
  return reseau;
}

const ferme = fermePlacement();
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const editeur = (page: Page) => page.getByTestId(T.editeur);
const plan = (page: Page) => page.getByTestId(T.plan);
const sommets = (page: Page) => page.getByTestId(TC.sommet);
const sommet = (page: Page, i: number) => page.locator(`[data-testid="${TC.sommet}"][data-index="${String(i)}"]`);
const edition = (page: Page) => page.getByTestId(TC.edition);
const zoneChamp = (page: Page) => page.locator(`[data-testid="${TC.zoneChoix}"][data-id="${ZONE_CHAMP}"]`);
const boutonEnregistrer = (page: Page) => page.getByRole('button', { name: 'Enregistrer', exact: true });

async function amorcerEtOuvrir(page: Page): Promise<void> {
  await page.goto('/diagnostic/amorcer.html?jeu=placement');
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { erreur?: string; fermeId?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  expect(a.fermeId).toBe(ferme.fermeId);

  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId: ferme.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
}

async function ouvrirEditeur(page: Page): Promise<void> {
  await onglet(page, 'Ferme').click();
  await page.getByRole('button', { name: new RegExp(ENTREE_PLACEMENT) }).click();
  await expect(editeur(page)).toBeVisible({ timeout: 15_000 });
  await expect(editeur(page)).toHaveAttribute('data-mode', 'edition');
}

async function centreDe(l: Locator): Promise<Point> {
  const b = await l.boundingBox();
  if (b === null) throw new Error('élément sans boîte');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Les sommets affichés (m), dans l'ordre de data-index. */
async function contourAffiche(page: Page): Promise<Point[]> {
  return sommets(page).evaluateAll((els) =>
    els
      .map((el) => ({ i: Number(el.getAttribute('data-index')), x: Number(el.getAttribute('data-x')), y: Number(el.getAttribute('data-y')) }))
      .sort((a, b) => a.i - b.i)
      .map(({ x, y }) => ({ x, y })),
  );
}

/** Même cycle de sommets (premier sommet libre), à `tolerance` m près. */
function memeCycle(recu: readonly Point[], attendu: readonly Point[], tolerance = 0.001): boolean {
  if (recu.length !== attendu.length) return false;
  const n = attendu.length;
  for (let k = 0; k < n; k++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const r = recu[(i + k) % n];
      const a = attendu[i];
      ok = r !== undefined && a !== undefined && Math.abs(r.x - a.x) <= tolerance && Math.abs(r.y - a.y) <= tolerance;
    }
    if (ok) return true;
  }
  return false;
}

async function enregistrer(page: Page): Promise<void> {
  await boutonEnregistrer(page).click();
  await expect(page.getByTestId(T.annuler), 'Annuler proposé après l’enregistrement').toBeVisible();
}

async function choisirChamp(page: Page): Promise<void> {
  await zoneChamp(page).click();
  await expect(zoneChamp(page)).toHaveAttribute('aria-pressed', 'true');
}

/** Parcelle en L, en pixels relatifs au milieu du plan (y vers le bas), à l'écart du point de départ. */
const L_PX: readonly Point[] = [
  { x: -100, y: 140 },
  { x: 100, y: 140 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
  { x: 0, y: -60 },
  { x: -100, y: -60 },
];

test('ordinateur : tracer une zone en L, glisser un sommet, annuler, recharger ; clavier seul ; côtés croisés refusés', async ({ page, context }) => {
  test.setTimeout(240_000);
  const reseau = await intercepter(context);
  const violations = await surveillerCsp(page);
  await amorcerEtOuvrir(page);
  await ouvrirEditeur(page);

  await test.step('point de départ : la position de la ferme', async () => {
    await page.getByRole('button', { name: 'Utiliser la position de la ferme' }).click();
    const f = page.locator(`[role="alertdialog"], [role="dialog"]:not([data-testid="${T.editeur}"])`).filter({ hasText: /point de départ/i });
    await f.getByRole('button', { name: 'Confirmer' }).click();
    await expect(editeur(page)).toHaveAttribute('data-origine', '44,1.5');
  });

  let trace: Point[] = [];
  await test.step('tracer « Plein champ » en L : 6 clics, fermé sur le premier sommet', async () => {
    await choisirChamp(page);
    await expect(sommets(page)).toHaveCount(0);
    await page.getByRole('button', { name: B.tracer, exact: true }).click();
    await expect(edition(page)).toHaveAttribute('data-etat', 'trace');
    await expect(boutonEnregistrer(page)).toBeDisabled();
    const milieu = await centreDe(plan(page));
    for (const [k, p] of L_PX.entries()) {
      await page.mouse.click(milieu.x + p.x, milieu.y + p.y);
      await expect(sommets(page)).toHaveCount(k + 1);
      // Le sommet est dessiné là où l'on a cliqué.
      const c = await centreDe(sommet(page, k));
      expect(Math.hypot(c.x - (milieu.x + p.x), c.y - (milieu.y + p.y)), `sommet ${String(k + 1)} sous le pointeur`).toBeLessThan(2);
    }
    const poses = await contourAffiche(page);
    const p0 = poses[0] ?? { x: 0, y: 0 };
    const l0 = L_PX[0] ?? { x: 0, y: 0 };
    poses.forEach((s, i) => {
      const l = L_PX[i] ?? { x: 0, y: 0 };
      expect(Math.abs(s.x - p0.x - (l.x - l0.x) * MPP_19), `sommet ${String(i + 1)} : écart est-ouest`).toBeLessThan(0.5);
      expect(Math.abs(s.y - p0.y + (l.y - l0.y) * MPP_19), `sommet ${String(i + 1)} : écart nord-sud`).toBeLessThan(0.5);
    });
    await sommet(page, 0).click();
    await expect(edition(page)).toHaveAttribute('data-etat', 'valide');
    await expect(sommets(page)).toHaveCount(6);
    await expect(page.getByTestId(TC.erreur)).toHaveCount(0);
    await enregistrer(page);
    await expect(page.locator(`[data-testid="${T.zoneContour}"][data-id="${ZONE_CHAMP}"]`)).toHaveCount(1);
    trace = await contourAffiche(page);
    expect(memeCycle(trace, poses, 0.002) || memeCycle(trace, [...poses].reverse(), 0.002), `contour écrit = contour tracé (${JSON.stringify(trace)})`).toBe(true);
  });

  await test.step('glisser un sommet, enregistrer, « Annuler » → retour exact au L', async () => {
    const s = sommet(page, 2);
    const depart = await centreDe(s);
    await page.mouse.move(depart.x, depart.y);
    await page.mouse.down();
    await page.mouse.move(depart.x + 20, depart.y + 10, { steps: 3 });
    await page.mouse.move(depart.x + 40, depart.y + 20, { steps: 3 });
    await page.mouse.up();
    await expect.poll(async () => (await contourAffiche(page))[2]?.x ?? 0).toBeCloseTo((trace[2]?.x ?? 0) + 40 * MPP_19, 1);
    await enregistrer(page);
    await page.getByTestId(T.annuler).click();
    await expect.poll(async () => memeCycle(await contourAffiche(page), trace)).toBe(true);
  });

  await test.step('recharger : contour conservé', async () => {
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await choisirChamp(page);
    await expect(sommets(page)).toHaveCount(6);
    expect(memeCycle(await contourAffiche(page), trace), 'contour relu après rechargement').toBe(true);
    await expect(edition(page)).toHaveAttribute('data-etat', 'valide');
  });

  await test.step('clavier seul : Tab au sommet suivant, Maj+→ = 1 m, Entrée sur « Enregistrer »', async () => {
    const avant = await contourAffiche(page);
    await sommet(page, 0).focus();
    await page.keyboard.press('Tab');
    await expect(sommet(page, 1)).toBeFocused();
    await expect(sommet(page, 1)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await contourAffiche(page))[1]?.x).toBeCloseTo((avant[1]?.x ?? 0) + 1, 3);
    expect((await contourAffiche(page))[1]?.y).toBeCloseTo(avant[1]?.y ?? 0, 3);
    await boutonEnregistrer(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(T.annuler)).toBeVisible();
    const attendu = avant.map((p, i) => (i === 1 ? { x: p.x + 1, y: p.y } : p));
    await expect.poll(async () => memeCycle(await contourAffiche(page), attendu)).toBe(true);
  });

  await test.step('croiser deux côtés : message de validerContour, « Enregistrer » inactif, rien d’écrit', async () => {
    const avant = await contourAffiche(page);
    // Le sommet 2 passe de l'autre côté du côté (sommet 4 → sommet 5) : ses deux côtés le croisent.
    const s2 = await centreDe(sommet(page, 1));
    const s3 = await centreDe(sommet(page, 2));
    const s4 = await centreDe(sommet(page, 3));
    const s5 = await centreDe(sommet(page, 4));
    const m = { x: (s4.x + s5.x) / 2, y: (s4.y + s5.y) / 2 };
    const cible = { x: 2 * m.x - s3.x, y: 2 * m.y - s3.y };
    await page.mouse.move(s2.x, s2.y);
    await page.mouse.down();
    await page.mouse.move((s2.x + cible.x) / 2, (s2.y + cible.y) / 2, { steps: 3 });
    await page.mouse.move(cible.x, cible.y, { steps: 3 });
    await page.mouse.up();
    await expect(edition(page)).toHaveAttribute('data-etat', 'invalide');
    const croise = await contourAffiche(page);
    const verdict = validerContour(croise);
    expect(verdict.ok, `contour croisé ${JSON.stringify(croise)}`).toBe(false);
    await expect(page.getByTestId(TC.erreur)).toContainText(verdict.ok ? '???' : verdict.erreur.message);
    await expect(boutonEnregistrer(page)).toBeDisabled();
    // Rouvrir : le contour enregistré est toujours le précédent.
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await ouvrirEditeur(page);
    await choisirChamp(page);
    expect(memeCycle(await contourAffiche(page), avant), 'rien d’écrit').toBe(true);
  });

  expect(reseau.ailleurs, 'aucun appel réseau hors de localhost et des tuiles').toEqual([]);
  expect(await violations(), 'violations de la CSP').toEqual([]);
});

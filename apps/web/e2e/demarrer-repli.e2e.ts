import { expect, test, type Locator, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { DELAI_AMORCAGE_MS, PLAN_VISIBLE_MIN_PX, planVisibleDEmblee } from './plan-defilement-outils.ts';

/**
 * T65 — le bandeau « Démarrer votre ferme » est repliable partout et ne cache jamais l'écran
 * (docs/backlog/T65-bandeau-demarrer-repliable.md).
 *
 * Retour de Théophane (téléphone) : la liste dépliée des 4 étapes empêchait de voir le reste de
 * l'écran ; il l'a fait disparaître sans savoir où il avait cliqué.
 *
 * Ferme neuve « juste après Ma ferme » (saison, 1 zone, 7 planches, sans série : bandeau affiché),
 * amorcée par /diagnostic/amorcer.html, sur le build des essais (dist-essais/).
 *
 * Téléphone (390 × 844 et 360 × 800, toucher) : Aujourd'hui puis Planches ; replié à l'ouverture,
 * le contenu (état vide qui guide, plan) se voit sans défiler ; « Voir les étapes » déplie (les 4
 * étapes, au plus 40 % de la hauteur de l'écran, la liste défile à l'intérieur), « Replier »
 * (≥ 44 px) replie ; le choix survit au rechargement et vaut pour les deux écrans.
 * Ordinateur (1280 × 800) : déplié par défaut, au plus 40 % de la hauteur, rien ne déborde.
 */

const CIBLE_MIN_PX = 44;
const PART_MAX = 0.4;
/** Replié : une ligne et la prochaine étape, jamais plus d'un tiers de l'écran. */
const PART_REPLIE_MAX = 0.3;
/** Déplié sur Planches : le plan reste au moins à portée de doigt. */
const PLAN_DEPLIE_MIN_PX = 80;

const NEUVE = '/diagnostic/amorcer.html?jeu=ferme-neuve&zones=1&planches=7';

interface Amorcage {
  readonly utilisateurId?: string;
  readonly erreur?: string;
}

const bandeau = (page: Page) => page.getByTestId('demarrer-ferme');
const onglet = (page: Page, libelle: string) => page.getByRole('navigation', { name: 'Navigation principale' }).locator('button').filter({ hasText: libelle });
const voirEtapes = (page: Page) => bandeau(page).getByRole('button', { name: 'Voir les étapes', exact: true });
const replier = (page: Page) => bandeau(page).getByRole('button', { name: 'Replier', exact: true });
const etapes = (page: Page) => bandeau(page).locator('[data-testid="etape-demarrage"]');
/** L'état vide d'Aujourd'hui et son bouton (« Planifier une série »), hors du bandeau. */
const boutonVide = (page: Page) => page.getByTestId('aujourdhui').locator('.dem-vide').getByRole('button');
/** Le premier contenu d'Aujourd'hui sous le bandeau : la barre d'actions (« Noter une récolte »…). */
const premiereAction = (page: Page) => page.getByTestId('aujourdhui').getByRole('button', { name: 'Noter une récolte' });

async function amorcerEtOuvrir(page: Page): Promise<void> {
  await page.goto(NEUVE);
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
  await recharger(page);
}

async function recharger(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  await expect(bandeau(page)).toBeVisible({ timeout: 15_000 });
}

/** Hauteur du bandeau rapportée à celle de l'écran. */
async function partDeLEcran(page: Page): Promise<number> {
  return bandeau(page).evaluate((e) => e.getBoundingClientRect().height / innerHeight);
}

/** L'élément est entièrement dans l'écran, au-dessus de la barre de navigation, sans défiler. */
async function vuSansDefiler(l: Locator, quoi: string): Promise<void> {
  const m = await l.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const bas = document.querySelector('nav')?.getBoundingClientRect().top ?? innerHeight;
    const haut = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    return { top: r.top, bottom: r.bottom, haut, bas, hauteur: r.height };
  });
  expect(m.hauteur, `${quoi} : affiché`).toBeGreaterThan(0);
  expect(m.top, `${quoi} : sous l’en-tête`).toBeGreaterThanOrEqual(m.haut - 1);
  expect(m.bottom, `${quoi} : au-dessus de la barre de navigation (${JSON.stringify(m)})`).toBeLessThanOrEqual(m.bas + 1);
}

async function cibleTactile(l: Locator, quoi: string): Promise<void> {
  const r = await l.boundingBox();
  expect(r, `${quoi} : affiché`).not.toBeNull();
  expect(r?.height ?? 0, `${quoi} : hauteur`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
  expect(r?.width ?? 0, `${quoi} : largeur`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
}

/** Replié : une ligne, la prochaine étape seule visible, la bascule « Voir les étapes ». */
async function verifierReplie(page: Page, ou: string): Promise<void> {
  await expect(bandeau(page), `${ou} : replié`).toHaveAttribute('data-replie', 'oui');
  await expect(voirEtapes(page)).toBeVisible();
  await expect(voirEtapes(page)).toHaveAttribute('aria-expanded', 'false');
  await cibleTactile(voirEtapes(page), `${ou} : « Voir les étapes »`);
  await expect(etapes(page).filter({ visible: true }), `${ou} : une seule étape visible (la prochaine)`).toHaveCount(1);
  await expect(bandeau(page), `${ou} : le titre et le compte`).toContainText(/Démarrer votre ferme\s*\d\/4/);
  await expect(bandeau(page).getByText('Vous avez déjà un tableur ?'), `${ou} : l’import est dans la liste dépliée`).toBeHidden();
  expect(await partDeLEcran(page), `${ou} : replié, au plus ${String(PART_REPLIE_MAX * 100)} % de l’écran`).toBeLessThanOrEqual(PART_REPLIE_MAX);
}

/** Déplié : les 4 étapes, au plus 40 % de l'écran, la liste défile à l'intérieur jusqu'à la 4e. */
async function verifierDeplie(page: Page, ou: string): Promise<void> {
  await expect(bandeau(page), `${ou} : déplié`).toHaveAttribute('data-replie', 'non');
  await expect(replier(page)).toBeVisible();
  await expect(replier(page)).toHaveAttribute('aria-expanded', 'true');
  await cibleTactile(replier(page), `${ou} : « Replier »`);
  await vuSansDefiler(replier(page), `${ou} : « Replier »`);
  expect(await partDeLEcran(page), `${ou} : déplié, au plus 40 % de l’écran`).toBeLessThanOrEqual(PART_MAX + 0.001);
  await expect(etapes(page)).toHaveCount(4);
  // La 4e étape s'atteint en faisant défiler la liste à l'intérieur du bandeau (jamais la page).
  const m = await etapes(page)
    .last()
    .evaluate((derniere) => {
      const dem = derniere.closest('[data-testid="demarrer-ferme"]');
      let c: HTMLElement | null = derniere.parentElement;
      while (c !== null && c !== dem && !/(auto|scroll)/.test(getComputedStyle(c).overflowY)) c = c.parentElement;
      if (c === null || c === dem || dem === null) return { defilant: false, vue: false, detail: 'aucun conteneur défilant dans le bandeau' };
      c.scrollTop = c.scrollHeight;
      const rc = c.getBoundingClientRect();
      const r = derniere.getBoundingClientRect();
      const rd = dem.getBoundingClientRect();
      return { defilant: true, vue: r.bottom <= rc.bottom + 1 && r.top >= rc.top - 1 && r.bottom <= rd.bottom + 1, detail: `liste ${rc.top.toFixed(0)}–${rc.bottom.toFixed(0)}, 4e étape ${r.top.toFixed(0)}–${r.bottom.toFixed(0)}` };
    });
  expect(m.defilant, `${ou} : la liste défile dans le bandeau (${m.detail})`).toBe(true);
  expect(m.vue, `${ou} : la 4e étape s’atteint dans la liste (${m.detail})`).toBe(true);
}

async function planVisible(page: Page): Promise<number> {
  return page.evaluate(() => {
    const plan = document.querySelector('[data-testid="plan-defilement"]')?.getBoundingClientRect();
    const bas = document.querySelector('nav')?.getBoundingClientRect().top ?? innerHeight;
    return plan === undefined ? 0 : Math.min(plan.bottom, bas) - Math.max(plan.top, 0);
  });
}

async function sansDefilementHorizontal(page: Page, ou: string): Promise<void> {
  const m = await page.evaluate(() => {
    const dem = document.querySelector('[data-testid="demarrer-ferme"]');
    return { largeur: innerWidth, page: document.documentElement.scrollWidth, bandeau: dem === null ? 0 : dem.scrollWidth - dem.clientWidth };
  });
  expect(m.page, `${ou} : pas de défilement horizontal`).toBeLessThanOrEqual(m.largeur);
  expect(m.bandeau, `${ou} : rien ne déborde du bandeau`).toBeLessThanOrEqual(0);
}

test.describe('téléphone', () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const vue of [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ] as const) {
    const taille = `${String(vue.width)} × ${String(vue.height)}`;
    test(`bandeau replié à l’ouverture, dépliable, repliable, choix retenu : ${taille}`, async ({ page }) => {
      test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
      await page.setViewportSize(vue);
      await amorcerEtOuvrir(page);

      await test.step('Aujourd’hui : replié, le contenu de l’écran se voit sans défiler', async () => {
        await verifierReplie(page, 'Aujourd’hui');
        await vuSansDefiler(premiereAction(page), 'Aujourd’hui : « Noter une récolte »');
        await sansDefilementHorizontal(page, 'Aujourd’hui replié');
      });

      await test.step('« Voir les étapes » déplie, sans cacher l’écran ; « Replier » replie', async () => {
        await voirEtapes(page).tap();
        await verifierDeplie(page, 'Aujourd’hui');
        await expect(boutonVide(page), 'l’état vide reste dans la page').toBeVisible();
        await sansDefilementHorizontal(page, 'Aujourd’hui déplié');
        await replier(page).tap();
        await verifierReplie(page, 'Aujourd’hui, après « Replier »');
      });

      await test.step('Planches : replié, le plan se voit dès l’ouverture', async () => {
        await onglet(page, 'Planches').tap();
        await expect(page.getByTestId('plan-defilement')).toBeVisible({ timeout: 15_000 });
        await verifierReplie(page, 'Planches');
        await planVisibleDEmblee(page);
      });

      await test.step('Planches : déplié, le plan reste à portée de doigt', async () => {
        await voirEtapes(page).tap();
        await verifierDeplie(page, 'Planches');
        expect(await planVisible(page), 'Planches déplié : plan visible (px)').toBeGreaterThanOrEqual(PLAN_DEPLIE_MIN_PX);
      });

      await test.step('le choix (déplié) survit au rechargement et vaut pour Aujourd’hui', async () => {
        await recharger(page);
        await expect(bandeau(page), 'Aujourd’hui après rechargement').toHaveAttribute('data-replie', 'non');
        await verifierDeplie(page, 'Aujourd’hui après rechargement');
        await replier(page).tap();
        await recharger(page);
        await verifierReplie(page, 'Aujourd’hui, replié puis rechargé');
        await onglet(page, 'Planches').tap();
        await expect(page.getByTestId('plan-defilement')).toBeVisible({ timeout: 15_000 });
        await verifierReplie(page, 'Planches, replié puis rechargé');
        expect(await planVisible(page)).toBeGreaterThanOrEqual(PLAN_VISIBLE_MIN_PX);
      });
    });
  }
});

test.describe('ordinateur', () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test('déplié par défaut, au plus 40 % de l’écran, rien ne déborde', async ({ page }) => {
    test.setTimeout(DELAI_AMORCAGE_MS + 60_000);
    await amorcerEtOuvrir(page);
    await verifierDeplie(page, 'Aujourd’hui (ordinateur)');
    await expect(boutonVide(page)).toBeVisible();
    await sansDefilementHorizontal(page, 'Aujourd’hui (ordinateur)');
    await onglet(page, 'Planches').click();
    await expect(page.getByTestId('plan-defilement')).toBeVisible({ timeout: 15_000 });
    await verifierDeplie(page, 'Planches (ordinateur)');
    await sansDefilementHorizontal(page, 'Planches (ordinateur)');
    await replier(page).click();
    await expect(bandeau(page)).toHaveAttribute('data-replie', 'oui');
  });
});

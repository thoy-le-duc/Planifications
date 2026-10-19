import { expect, test, type Locator, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { ESPECE_BIBLIOTHEQUE, fermeNeuve, ITINERAIRE_BIBLIOTHEQUE } from '../src/ecrans/parcellaire/test/ferme-neuve.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T49 — démarrer sa ferme sans import, de bout en bout (docs/backlog/T49-demarrer-sa-ferme.md),
 * sur le build des essais servi par `vite preview` (dist-essais/), réseau coupé : base locale
 * simulée, comme les autres e2e (la synchro elle-même est vérifiée par T10s, e2e-synchro).
 *
 * Amorçage : /diagnostic/amorcer.html?jeu=ferme-neuve remplit la base locale de l'utilisateur de
 * test avec une ferme NEUVE (src/ecrans/parcellaire/test/ferme-neuve.ts : ni saison, ni zone, ni
 * planche, ni série ; la bibliothèque commune propose l'itinéraire « Batavia »).
 *
 * Parcours : Aujourd'hui → bandeau « Démarrer votre ferme » → saison en un tap → zone « Tunnel 1 »
 * et 10 planches P1…P10 de 30 × 0,8 m → étape « première série » → nouvelle série de Batavia
 * sur l'itinéraire de la bibliothèque, sur P1 → elle apparaît dans Planches, ses travaux dans
 * Aujourd'hui, le bandeau disparaît. Tout hors ligne ; cibles ≥ 56 px ; à 360 px, pas de
 * défilement horizontal ; aucune violation de la CSP.
 */

const CIBLE_MIN_PX = 56;
const DELAI_AMORCAGE_MS = 60_000;

test.use({ actionTimeout: 15_000 });

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const bandeau = (page: Page) => page.getByTestId('demarrer-ferme');
const etape = (page: Page, cle: string) => bandeau(page).locator(`[data-testid="etape-demarrage"][data-etape="${cle}"]`);
const maFerme = (page: Page) => page.getByRole('dialog', { name: 'Ma ferme' });
const etatSynchro = (page: Page) => page.getByTestId('etat-synchro');

/** Toutes les commandes visibles de `racine` font au moins CIBLE_MIN_PX de côté. */
async function verifierCibles(racine: Locator, ou: string): Promise<void> {
  const tailles = await racine.locator('button, input, select').evaluateAll((els) =>
    els
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { nom: e.getAttribute('aria-label') ?? (e.textContent.trim() || e.outerHTML.slice(0, 60)), largeur: r.width, hauteur: r.height };
      })
      .filter((t) => t.largeur > 0 && t.hauteur > 0),
  );
  expect(tailles.length, `${ou} : des commandes`).toBeGreaterThan(0);
  for (const t of tailles) {
    expect(t.hauteur, `${ou} : hauteur de « ${t.nom} »`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
    expect(t.largeur, `${ou} : largeur de « ${t.nom} »`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
  }
}

test('ferme neuve → saison en un tap → zone + 10 planches → série de la bibliothèque → Planches et Aujourd’hui, hors ligne', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 180_000);
  const ferme = fermeNeuve();
  const annee = String(new Date().getFullYear());

  await test.step('amorcer la base locale avec la ferme neuve (page de diagnostic)', async () => {
    await page.goto('/diagnostic/amorcer.html?jeu=ferme-neuve');
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(ferme.utilisateurId);
    expect(a.fermeId).toBe(ferme.fermeId);
    expect(a.lignes).toBe(ferme.total);
  });

  const violations = await surveillerCsp(page);

  await test.step('connexion (session rangée), service worker, puis réseau coupé', async () => {
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
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    await expect(etatSynchro(page)).toHaveText('Hors ligne');
  });

  await test.step('Aujourd’hui : bandeau « Démarrer votre ferme », 4 étapes à faire, état vide qui guide', async () => {
    await expect(bandeau(page)).toBeVisible({ timeout: 15_000 });
    await expect(bandeau(page).locator('[data-testid="etape-demarrage"][data-faite="non"]')).toHaveCount(4);
    await expect(page.getByTestId('aujourdhui')).toContainText('Aucune série');
    await verifierCibles(bandeau(page), 'bandeau');
  });

  await test.step('étape 1 → onglet Ferme, « Ma ferme » : la saison de l’année en un tap', async () => {
    await etape(page, 'saison').click();
    await expect(maFerme(page)).toBeVisible();
    await maFerme(page).getByRole('button', { name: `Créer la saison ${annee}` }).click();
    await expect(maFerme(page).getByTestId('saison')).toHaveCount(1);
    await expect(maFerme(page).getByTestId('saison')).toContainText(annee);
    await expect(page.getByTestId('saisie-annulable')).toBeVisible();
  });

  await test.step('zone « Tunnel 1 » et 10 planches P de 30 × 0,8 m en un geste', async () => {
    await maFerme(page).getByRole('button', { name: 'Nouvelle zone' }).click();
    const z = page.getByRole('dialog', { name: 'Nouvelle zone' });
    await z.getByLabel('Nom').fill('Tunnel 1');
    await z.getByLabel('Type d’abri').selectOption('tunnel');
    await z.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(z).toHaveCount(0);
    await maFerme(page).getByRole('button', { name: 'Ouvrir Tunnel 1' }).click();
    const t = page.getByRole('dialog', { name: 'Tunnel 1' });
    await t.getByLabel('Nombre de planches').fill('10');
    await t.getByLabel('Préfixe du code').fill('P');
    await t.getByLabel('Longueur (m)').fill('30');
    await t.getByLabel('Largeur (m)').fill('0,8');
    await t.getByRole('button', { name: 'Ajouter les planches' }).click();
    await expect(t.getByTestId('planche')).toHaveCount(10);
    await expect(t.getByTestId('planche').first()).toContainText('P1');
    await verifierCibles(t, 'zone');
    await page.setViewportSize({ width: 360, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), '360 px : pas de défilement horizontal').toBeLessThanOrEqual(360);
    expect(await t.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    await t.getByRole('button', { name: 'Fermer' }).click();
    await maFerme(page).getByRole('button', { name: 'Fermer' }).click();
    await expect(maFerme(page)).toHaveCount(0);
  });

  await test.step('retour à Aujourd’hui : saison et planches cochées ; étape 4 → Planches, « Nouvelle série »', async () => {
    await onglet(page, 'Aujourd').click();
    await expect(etape(page, 'saison')).toHaveAttribute('data-faite', 'oui');
    await expect(etape(page, 'planches')).toHaveAttribute('data-faite', 'oui');
    await expect(etape(page, 'serie')).toHaveAttribute('data-faite', 'non');
    await etape(page, 'serie').click();
    const f = page.getByRole('dialog', { name: 'Nouvelle série' });
    await expect(f).toBeVisible({ timeout: 15_000 });
    await f.getByLabel('Culture').fill('bat');
    await f.locator(`[data-testid="choix-culture"][data-espece="${ESPECE_BIBLIOTHEQUE}"]`).first().click();
    await expect(f.getByLabel('Itinéraire'), 'l’itinéraire de la bibliothèque est proposé').toHaveValue(ITINERAIRE_BIBLIOTHEQUE);
    await f.getByLabel('Ajouter une planche').selectOption({ label: 'P1' });
    await f.getByRole('button', { name: 'Planifier la série' }).click();
    await expect(f).toHaveCount(0);
  });

  await test.step('la série est dans Planches, le bandeau a disparu, 1 saisie de plus en attente', async () => {
    await expect(page.getByTestId('plan-defilement')).toBeVisible();
    await expect(page.locator('[data-testid="ligne-plan"][data-sorte="emplacement"]').filter({ hasText: 'P1' }).first().getByTestId('barre')).toContainText('Batavia');
    await expect(bandeau(page)).toHaveCount(0);
    await expect(etatSynchro(page)).toContainText('en attente');
  });

  await test.step('ses travaux sont dans Aujourd’hui', async () => {
    await onglet(page, 'Aujourd').click();
    await expect(page.getByTestId('tache').filter({ hasText: /Batavia/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(bandeau(page)).toHaveCount(0);
  });

  expect(await violations()).toEqual([]);
});

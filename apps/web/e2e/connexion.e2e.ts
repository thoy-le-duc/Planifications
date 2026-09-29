import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * T09 — connexion au doigt, avec des gants (Q9) : un seul champ par étape, cibles d'au moins
 * 48 px, focus déjà dans le champ, vérification qui part seule au 6e chiffre, et plus aucune
 * saisie au retour (session gardée sur le téléphone).
 *
 * L'API est simulée (page.route) : l'appli appelle `${VITE_API_URL ou '/api'}/auth/code` puis
 * `/auth/verifier` (contrat : apps/web/src/connexion/connexion.test.tsx).
 */

/** Taille minimale d'une cible tactile (Material : 48 dp). */
const CIBLE_MIN_PX = 48;

const SESSION_API = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

// Le service worker intercepterait les requêtes avant page.route.
test.use({ serviceWorkers: 'block' });

async function assezGrand(cible: Locator, nom: string): Promise<void> {
  const boite = await cible.boundingBox();
  expect(boite, `${nom} visible`).not.toBeNull();
  expect(boite?.height ?? 0, `${nom} : hauteur`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
  expect(boite?.width ?? 0, `${nom} : largeur`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
}

async function toutesAssezGrandes(page: Page): Promise<void> {
  for (const [i, cible] of (await page.locator('main input:visible, main button:visible').all()).entries()) {
    await assezGrand(cible, `cible ${String(i + 1)}`);
  }
}

test('connexion par code : un champ à la fois, gros boutons, puis plus rien à saisir', async ({ page }) => {
  const demandes: unknown[] = [];
  const verifications: unknown[] = [];
  await page.route('**/auth/code', async (route) => {
    demandes.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.route('**/auth/verifier', async (route) => {
    verifications.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, json: SESSION_API });
  });

  await page.goto('/');

  // Étape e-mail.
  const email = page.getByLabel(/adresse e-mail/i);
  await expect(email).toBeVisible();
  await expect(page.locator('main input:visible')).toHaveCount(1);
  await toutesAssezGrandes(page);
  await email.fill('theophane@ferme.fr');
  await page.getByRole('button', { name: /recevoir un code/i }).click();

  // Étape code : focus déjà dans le champ, l'adresse n'est pas redemandée.
  const code = page.getByLabel(/code/i);
  await expect(code).toBeVisible();
  await expect(code).toBeFocused();
  await expect(page.locator('main input:visible')).toHaveCount(1);
  await expect(page.getByText('theophane@ferme.fr')).toBeVisible();
  await toutesAssezGrandes(page);
  expect(demandes).toEqual([{ email: 'theophane@ferme.fr' }]);

  // Six chiffres, sans toucher de bouton : la vérification part seule.
  await page.keyboard.type('012345');
  await expect(code).toBeHidden();
  expect(verifications).toEqual([{ email: 'theophane@ferme.fr', code: '012345' }]);

  // Retour dans l'appli : session gardée, aucune saisie.
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
  await expect(page.getByLabel(/adresse e-mail/i)).toHaveCount(0);
  await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
});

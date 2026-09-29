import { expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { surveillerCsp } from './outils.ts';

/**
 * T09b — se déconnecter depuis l'appli (téléphone partagé).
 *
 * Contrat (fonction : src/connexion/deconnexion.test.ts) :
 *   - connecté (session dans localStorage), l'appli montre un bouton « Se déconnecter »
 *     (cible d'au moins 48 px, comme les autres) ;
 *   - un tap : POST {API}/auth/deconnexion { jetonRenouvellement } (sans Authorization), session
 *     effacée (localStorage `planif.session`), base locale de l'utilisateur effacée
 *     (effacerDonneesLocales, chargée à la demande : PowerSync hors du JavaScript de
 *     démarrage), puis retour à l'écran de connexion ; au rechargement, on y reste ;
 *   - hors ligne (appli servie par le service worker, API et PowerSync injoignables), pareil :
 *     on rend le téléphone sans réseau ;
 *   - aucune violation de la CSP pendant tout cela (PowerSync compris, s'il est chargé).
 *
 * L'API est simulée (page.route), comme dans connexion.e2e.ts.
 */

const CIBLE_MIN_PX = 48;
/** Effacer la base locale peut charger PowerSync (WASM) : on laisse le temps. */
const DELAI_EFFACEMENT_MS = 15_000;

const SESSION = {
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
};

// Le service worker intercepterait les requêtes avant page.route.
test.use({ serviceWorkers: 'block' });

async function ouvrirConnecte(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(([cle, valeur]) => {
    localStorage.setItem(cle, valeur);
  }, [CLE_SESSION, JSON.stringify(SESSION)] as const);
  await page.reload();
  await expect(page.getByTestId('app')).toBeVisible();
}

function sessionRangee(page: Page): Promise<string | null> {
  return page.evaluate((cle) => localStorage.getItem(cle), CLE_SESSION);
}

test('se déconnecter : jeton révoqué auprès de l’API, session effacée, retour à l’écran de connexion', async ({ page }) => {
  const requetes: { corps: unknown; autorisation: string | undefined }[] = [];
  await page.route('**/auth/deconnexion', async (route) => {
    requetes.push({ corps: route.request().postDataJSON(), autorisation: route.request().headers().authorization });
    await route.fulfill({ status: 204 });
  });
  const violations = await surveillerCsp(page);
  await ouvrirConnecte(page);

  const bouton = page.getByRole('button', { name: /se déconnecter/i });
  await expect(bouton).toBeVisible();
  const boite = await bouton.boundingBox();
  expect(boite?.height ?? 0).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
  expect(boite?.width ?? 0).toBeGreaterThanOrEqual(CIBLE_MIN_PX);

  await bouton.click();
  await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: DELAI_EFFACEMENT_MS });
  expect(requetes).toEqual([{ corps: { jetonRenouvellement: SESSION.jetonRenouvellement }, autorisation: undefined }]);
  expect(await sessionRangee(page)).toBeNull();

  await page.reload();
  await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /se déconnecter/i })).toHaveCount(0);
  expect(await violations()).toEqual([]);
});

test.describe('hors ligne, appli servie par le service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  // Au champ, sans réseau : l'appli vient du service worker, l'API et les fichiers hors
  // précache (PowerSync : assets/sqlite/) sont injoignables. La déconnexion doit aboutir quand
  // même (effacer la base locale sans télécharger PowerSync, ou avec ce qui est en cache).
  test('se déconnecter hors ligne : session effacée, retour à l’écran de connexion', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.evaluate(([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    }, [CLE_SESSION, JSON.stringify(SESSION)] as const);

    await context.setOffline(true);
    await page.reload();
    await page.getByRole('button', { name: /se déconnecter/i }).click();
    await expect(page.getByLabel(/adresse e-mail/i)).toBeVisible({ timeout: DELAI_EFFACEMENT_MS });
    expect(await sessionRangee(page)).toBeNull();
  });
});

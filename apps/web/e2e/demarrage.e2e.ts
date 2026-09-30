import { expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { decrireSerie, ralentirCpu, repeterMesure, REPETITIONS_MESURE, tempsAppPrete } from './outils.ts';

/**
 * Contrat (T16, relecture, point 3) : deux réouvertures hors ligne, CPU ralenti ×4, sous 300 ms
 * chacune : sans session (écran de connexion) et connecté (la coquille, Aujourd'hui : le cas de
 * tous les jours). Démarrage à froid (première visite) sous 1000 ms.
 *
 * T20 : chaque temps est mesuré REPETITIONS_MESURE (5) fois, et c'est la MÉDIANE qui est comparée
 * au budget (budgets inchangés) ; le journal donne les 5 valeurs. Chaque répétition repart du même
 * état : première visite = contexte de navigateur neuf (ni service worker, ni cache, ni stockage) ;
 * réouverture = rechargement hors ligne d'une page contrôlée par le service worker, CPU ×4.
 */

/**
 * Première visite : l'appli se télécharge une fois, avant installation.
 * Budget plus large que celui des écrans courants.
 */
const DEMARRAGE_FROID_MAX_MS = 1000;

/**
 * Principe 1 : tout écran courant s'affiche en moins de 300 ms.
 * Rouvrir l'appli au champ, sans réseau, est le cas le plus courant.
 */
const ECRAN_COURANT_MAX_MS = 300;

const SESSION = JSON.stringify({
  utilisateurId: '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b10',
  email: 'theophane@ferme.fr',
  jetonAcces: 'aaa.bbb.ccc',
  jetonRenouvellement: 'r'.repeat(43),
});

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });

/** La page est bien servie par le service worker (réouverture depuis le cache, pas depuis le réseau). */
async function controleeParLeServiceWorker(page: Page): Promise<boolean> {
  return page.evaluate(() => navigator.serviceWorker.controller !== null);
}

test('démarrage à froid sous le budget, CPU ralenti', async ({ browser }) => {
  // Contexte neuf à chaque répétition (options du projet reprises par Playwright) : une vraie
  // première visite, sans service worker ni cache laissés par la précédente.
  const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
    const contexte = await browser.newContext();
    try {
      const page = await contexte.newPage();
      await ralentirCpu(page);
      await page.goto('/');
      const ms = await tempsAppPrete(page);
      expect(await controleeParLeServiceWorker(page), 'première visite : aucun service worker ne sert la page').toBe(false);
      return ms;
    } finally {
      await contexte.close();
    }
  });
  console.log(decrireSerie('démarrage à froid', serie, DEMARRAGE_FROID_MAX_MS));
  expect(serie.mediane).toBeLessThan(DEMARRAGE_FROID_MAX_MS);
});

test('réouverture hors ligne sous 300 ms, CPU ralenti', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await ralentirCpu(page);
  const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
    await page.reload();
    const ms = await tempsAppPrete(page);
    expect(await controleeParLeServiceWorker(page), 'réouverture servie par le service worker').toBe(true);
    return ms;
  });
  console.log(decrireSerie('réouverture hors ligne', serie, ECRAN_COURANT_MAX_MS));
  expect(serie.mediane).toBeLessThan(ECRAN_COURANT_MAX_MS);
});

test('réouverture hors ligne, connecté, sous 300 ms, CPU ralenti', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, SESSION] as const,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(navigation(page)).toBeVisible();

  await context.setOffline(true);
  await ralentirCpu(page);
  const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
    await page.reload();
    const ms = await tempsAppPrete(page);
    await expect(navigation(page)).toBeVisible();
    expect(await controleeParLeServiceWorker(page), 'réouverture servie par le service worker').toBe(true);
    // Même état au départ de chaque répétition : la base locale a fini de s'ouvrir avant le
    // rechargement suivant (qui la rouvre à froid : worker dédié, recréé à chaque page).
    await expect(page.getByTestId('app')).not.toHaveAttribute('data-base', 'ouverture', { timeout: 15_000 });
    return ms;
  });
  console.log(decrireSerie('réouverture hors ligne, connecté', serie, ECRAN_COURANT_MAX_MS));
  expect(serie.mediane).toBeLessThan(ECRAN_COURANT_MAX_MS);
});

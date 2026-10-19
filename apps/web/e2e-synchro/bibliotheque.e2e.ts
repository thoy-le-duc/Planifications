/**
 * T41 — de bout en bout, avec la vraie API, le vrai service PowerSync et la base migrée
 * (`pnpm e2e:synchro`, lancement et règles : en-tête de synchro.e2e.ts) : une ferme NEUVE reçoit
 * la bibliothèque commune de départ par la synchro (migration 0032 de @planif/db, flux
 * *_reference de powersync/sync-config.yaml), et l'adapte.
 *
 * Session : un compte neuf, membre d'aucune ferme (amorcer-e2e.ts --compte-neuf), qui crée sa
 * ferme depuis l'appli (comme creer-ferme.e2e.ts).
 *
 * Attendu :
 *   1. Ferme → « Mes itinéraires » : les 47 itinéraires de la bibliothèque (data-origine
 *      "bibliotheque"), dont « Tomate sous serre, plant greffé deux têtes » ;
 *   2. « Adapter pour ma ferme » sur cet itinéraire puis « Enregistrer » : la copie apparaît côté
 *      ferme ; une fois la synchro faite (« À jour » : plus rien en attente), elle est toujours là après rechargement (le serveur
 *      l'a acceptée : une écriture refusée disparaîtrait du téléphone), et la bibliothèque compte
 *      toujours 47 itinéraires.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { CLE_SESSION, type SessionConnexion } from '../src/connexion/session.ts';

const DELAI_SYNCHRO_MS = 30_000;
const API_URL = process.env.API_URL ?? '';
const SERVICES = API_URL !== '' && (process.env.POWERSYNC_URL ?? '') !== '';
const EN_CI = Boolean(process.env.CI);
const SCRIPT_AMORCAGE = fileURLToPath(new URL('../../api/src/sync/test/amorcer-e2e.ts', import.meta.url));

const ITINERAIRES_DE_DEPART = 47;
const TOMATE_SERRE = 'Tomate sous serre, plant greffé deux têtes';

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const ecranItineraires = (page: Page) => page.getByRole('dialog', { name: 'Mes itinéraires' });
const deLaBibliotheque = (page: Page) => ecranItineraires(page).locator('[data-testid="itineraire"][data-origine="bibliotheque"]');
const deLaFerme = (page: Page) => ecranItineraires(page).locator('[data-testid="itineraire"][data-origine="ferme"]');

async function ouvrirItineraires(page: Page): Promise<void> {
  await navigation(page).locator('button').filter({ hasText: 'Ferme' }).click();
  await page.getByRole('button', { name: 'Mes itinéraires' }).click();
  await expect(ecranItineraires(page)).toBeVisible();
}

test.describe('T41 : la bibliothèque de départ arrive sur une ferme neuve, de bout en bout', () => {
  test.skip(!SERVICES && !EN_CI, 'API_URL et POWERSYNC_URL requises (pnpm e2e:synchro)');

  let compteNeuf: SessionConnexion;

  test.beforeAll(() => {
    if (!SERVICES) throw new Error('API_URL et POWERSYNC_URL sont obligatoires en CI : lancer les e2e par pnpm e2e:synchro.');
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE, '--compte-neuf'], { encoding: 'utf8', env: process.env });
    compteNeuf = (JSON.parse(sortie) as { compteNeuf: SessionConnexion }).compteNeuf;
  });

  test('ferme neuve → 47 itinéraires de la bibliothèque ; « Adapter pour ma ferme » → copie acceptée par le serveur', async ({ browser }) => {
    const contexte = await browser.newContext();
    try {
      await contexte.addInitScript(
        ([cle, valeur]) => {
          if (localStorage.getItem(cle) === null) localStorage.setItem(cle, valeur);
        },
        [CLE_SESSION, JSON.stringify(compteNeuf)] as const,
      );
      const page = await contexte.newPage();
      await page.goto('/');
      await expect(page.getByTestId('creer-ferme')).toHaveAttribute('data-etat', 'formulaire', { timeout: DELAI_SYNCHRO_MS });
      await page.getByLabel('Nom de la ferme').fill('Ferme e2e T41');
      await page.getByRole('button', { name: 'Créer ma ferme' }).click();
      await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_SYNCHRO_MS });

      await ouvrirItineraires(page);
      await expect(deLaBibliotheque(page)).toHaveCount(ITINERAIRES_DE_DEPART, { timeout: DELAI_SYNCHRO_MS });
      await expect(deLaFerme(page)).toHaveCount(0);
      const tomate = deLaBibliotheque(page).filter({ hasText: TOMATE_SERRE });
      await expect(tomate).toHaveCount(1);

      await tomate.getByRole('button', { name: /^Adapter pour ma ferme/ }).click();
      const formulaire = page.getByTestId('formulaire-itineraire');
      await expect(formulaire).toBeVisible();
      await formulaire.getByRole('button', { name: 'Enregistrer' }).click();
      await expect(formulaire).toHaveCount(0);
      await expect(deLaFerme(page)).toHaveCount(1);
      await expect(deLaFerme(page)).toContainText(`${TOMATE_SERRE} (ma ferme)`);

      await expect(page.getByTestId('etat-synchro')).toHaveText('À jour', { timeout: DELAI_SYNCHRO_MS });
      await page.reload();
      await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_SYNCHRO_MS });
      await expect(page.getByTestId('etat-synchro')).toHaveText('À jour', { timeout: DELAI_SYNCHRO_MS });
      await ouvrirItineraires(page);
      await expect(deLaFerme(page), 'la copie, acceptée par le serveur, est revenue par la synchro').toHaveCount(1);
      await expect(deLaFerme(page)).toContainText(`${TOMATE_SERRE} (ma ferme)`);
      await expect(deLaBibliotheque(page)).toHaveCount(ITINERAIRES_DE_DEPART);
    } finally {
      await contexte.close();
    }
  });
});

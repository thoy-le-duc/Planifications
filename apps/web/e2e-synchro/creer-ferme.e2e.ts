/**
 * T39 — de bout en bout, avec la vraie API et le vrai service PowerSync (`pnpm e2e:synchro`,
 * lancement et règles : en-tête de synchro.e2e.ts) : un compte neuf crée sa ferme depuis
 * l'appli, et la ferme arrive par la synchro.
 *
 * Ici, c'est l'APPLI elle-même (`/` de dist-synchro, construite avec VITE_API_URL et
 * VITE_POWERSYNC_URL), pas la page de diagnostic. Session : un compte créé par sa première
 * connexion, membre d'aucune ferme (amorcer-e2e.ts --compte-neuf).
 *
 * Attendu :
 *   1. après la première synchro (vide), l'écran « Créer ma ferme » (data-etat="formulaire") ;
 *   2. un tap → POST /fermes ; « Ferme créée, synchronisation… » au plus jusqu'à l'arrivée de
 *      la ferme ;
 *   3. la synchro apporte membre et ferme : la base passe à 'prete' sur la ferme créée
 *      (mémorisée comme ferme choisie), l'écran de création disparaît, Aujourd'hui s'affiche ;
 *   4. l'API connaît la ferme, avec ce compte pour gérant (GET /moi).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { CLE_SESSION, type SessionConnexion } from '../src/connexion/session.ts';
import { cleChoix } from '../src/donnees/ferme-memorisee.ts';

const DELAI_SYNCHRO_MS = 20_000;

const API_URL = process.env.API_URL ?? '';
const SERVICES = API_URL !== '' && (process.env.POWERSYNC_URL ?? '') !== '';
const EN_CI = Boolean(process.env.CI);

const SCRIPT_AMORCAGE = fileURLToPath(new URL('../../api/src/sync/test/amorcer-e2e.ts', import.meta.url));

test.describe('T39 : créer sa ferme depuis l’appli, de bout en bout', () => {
  test.skip(!SERVICES && !EN_CI, 'API_URL et POWERSYNC_URL requises (pnpm e2e:synchro)');

  let compteNeuf: SessionConnexion;

  test.beforeAll(() => {
    if (!SERVICES) throw new Error('API_URL et POWERSYNC_URL sont obligatoires en CI : lancer les e2e par pnpm e2e:synchro.');
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE, '--compte-neuf'], { encoding: 'utf8', env: process.env });
    compteNeuf = (JSON.parse(sortie) as { compteNeuf: SessionConnexion }).compteNeuf;
  });

  test('compte neuf → « Créer ma ferme » → la ferme arrive par la synchro et devient active', async ({ browser }) => {
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
      const ecran = page.getByTestId('creer-ferme');
      await expect(ecran).toHaveAttribute('data-etat', 'formulaire', { timeout: DELAI_SYNCHRO_MS });
      await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'sans-ferme');

      await page.getByLabel('Nom de la ferme').fill('Ferme e2e T39');
      const envoi = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/fermes'));
      await page.getByRole('button', { name: 'Créer ma ferme' }).click();
      const fermeId = ((await envoi).postDataJSON() as { id: string }).id;

      await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: DELAI_SYNCHRO_MS });
      await expect(ecran).toHaveCount(0);
      await expect(page.getByTestId('aujourdhui')).toBeVisible({ timeout: DELAI_SYNCHRO_MS });
      expect(await page.evaluate((cle) => localStorage.getItem(cle), cleChoix(compteNeuf.utilisateurId))).toBe(fermeId);

      // Le jeton a pu tourner pendant le test : celui rangé par l'appli fait foi.
      const rangee = JSON.parse((await page.evaluate((cle) => localStorage.getItem(cle), CLE_SESSION)) ?? '{}') as SessionConnexion;
      const moi = await fetch(`${API_URL.replace(/\/+$/, '')}/moi`, { headers: { authorization: `Bearer ${rangee.jetonAcces}` } });
      expect(moi.status).toBe(200);
      const corps = (await moi.json()) as { fermes: { id: string; nom: string; role: string }[] };
      expect(corps.fermes).toEqual([{ id: fermeId, nom: 'Ferme e2e T39', role: 'gerant' }]);
    } finally {
      await contexte.close();
    }
  });
});

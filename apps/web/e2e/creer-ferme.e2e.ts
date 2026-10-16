import { expect, test, type Page, type Route } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { cleChoix } from '../src/donnees/ferme-memorisee.ts';

/**
 * T39 — compte neuf : « Créer ma ferme » (docs/backlog/T39-creer-sa-ferme.md), build des essais.
 *
 * Ce build n'a pas de service de synchro : connecté sans base locale, l'appli est en
 * 'sans-ferme'. L'API est simulée (page.route, comme connexion.e2e.ts) : on vérifie le parcours
 * au doigt, la requête envoyée, les messages, et le cas hors ligne. L'arrivée de la ferme par la
 * synchro se vérifie de bout en bout dans e2e-synchro/creer-ferme.e2e.ts (`pnpm e2e:synchro`).
 */

const CIBLE_MIN_PX = 48;
const UTILISATEUR = '0192f0c1-7a6e-7cc3-9b1e-3f6a2d4c5b39';

// Le service worker intercepterait les requêtes avant page.route.
test.use({ serviceWorkers: 'block' });

function jetonValableUneHeure(): string {
  const maintenant = Math.floor(Date.now() / 1000);
  return `e30.${Buffer.from(JSON.stringify({ sub: UTILISATEUR, iat: maintenant, exp: maintenant + 3600 })).toString('base64url')}.x`;
}

interface Requete {
  readonly autorisation: string | null;
  readonly corps: { id: string; nom: string; fuseauHoraire: string };
}

/** Ouvre l'appli connectée (compte neuf, aucune base sur le téléphone) ; `repondre` sert POST /fermes. */
async function ouvrirCompteNeuf(page: Page, repondre: (route: Route, r: Requete) => Promise<void>): Promise<Requete[]> {
  const requetes: Requete[] = [];
  await page.route('**/fermes', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    const r: Requete = { autorisation: await req.headerValue('authorization'), corps: req.postDataJSON() as Requete['corps'] };
    requetes.push(r);
    return repondre(route, r);
  });
  const session = { utilisateurId: UTILISATEUR, email: 'nouveau@ferme.fr', jetonAcces: jetonValableUneHeure(), jetonRenouvellement: 'r'.repeat(43) };
  await page.addInitScript(
    ([cle, valeur]) => {
      if (sessionStorage.getItem('e2e.t39.pose') === null) {
        localStorage.setItem(cle, valeur);
        sessionStorage.setItem('e2e.t39.pose', '1');
      }
    },
    [CLE_SESSION, JSON.stringify(session)] as const,
  );
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'sans-ferme');
  return requetes;
}

const ecran = (page: Page) => page.getByTestId('creer-ferme');
const champ = (page: Page) => page.getByLabel('Nom de la ferme');
const bouton = (page: Page) => page.getByRole('button', { name: 'Créer ma ferme' });

test('T39 : compte neuf → « Créer ma ferme » → ferme créée, mémorisée, en attente de la synchro', async ({ page }) => {
  const requetes = await ouvrirCompteNeuf(page, async (route, r) => {
    // Un peu de latence : le double tap tombe pendant l'envoi.
    await new Promise((f) => setTimeout(f, 300));
    await route.fulfill({ status: 201, json: { id: r.corps.id, nom: r.corps.nom, fuseauHoraire: r.corps.fuseauHoraire, role: 'gerant' } });
  });
  await expect(ecran(page)).toHaveAttribute('data-etat', 'formulaire');
  await expect(bouton(page)).toBeVisible();
  const boite = await bouton(page).boundingBox();
  expect(boite?.height ?? 0).toBeGreaterThanOrEqual(CIBLE_MIN_PX);

  await champ(page).fill('Ferme de Benoît');
  await bouton(page).dblclick();
  await expect(ecran(page)).toHaveAttribute('data-etat', 'creee');
  await expect(ecran(page)).toContainText('Ferme créée, synchronisation…');

  expect(requetes).toHaveLength(1);
  const [r] = requetes;
  expect(r?.autorisation).toMatch(/^Bearer e30\./);
  expect(r?.corps.nom).toBe('Ferme de Benoît');
  expect(r?.corps.fuseauHoraire).toBe('Europe/Paris');
  expect(await page.evaluate((cle) => localStorage.getItem(cle), cleChoix(UTILISATEUR))).toBe(r?.corps.id);

  // Les autres onglets ne reproposent pas le formulaire.
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' });
  await navigation.locator('button').filter({ hasText: 'Planches' }).click();
  await expect(ecran(page)).toHaveAttribute('data-etat', 'creee');
  await navigation.locator('button').filter({ hasText: 'Ferme' }).click();
  await expect(ecran(page)).toHaveAttribute('data-etat', 'creee');
  expect(requetes).toHaveLength(1);
});

test('T39 : nom refusé par le serveur → message en français, le nom reste dans le champ', async ({ page }) => {
  await ouvrirCompteNeuf(page, (route) => route.fulfill({ status: 400, json: { erreur: 'requete_invalide' } }));
  await champ(page).fill('Les Prés');
  await bouton(page).click();
  await expect(page.getByRole('alert')).toContainText(/nom/i);
  await expect(champ(page)).toHaveValue('Les Prés');
  await expect(bouton(page)).toBeEnabled();
});

test('T39 : hors ligne → pas de bouton, on dit qu’il faut du réseau ; le réseau revenu, le formulaire', async ({ page, context }) => {
  await ouvrirCompteNeuf(page, (route) => route.fulfill({ status: 201, json: {} }));
  await expect(bouton(page)).toBeVisible();
  await context.setOffline(true);
  await expect(ecran(page)).toHaveAttribute('data-etat', 'hors-ligne');
  await expect(bouton(page)).toHaveCount(0);
  await expect(ecran(page)).toContainText(/réseau/i);
  await context.setOffline(false);
  await expect(ecran(page)).toHaveAttribute('data-etat', 'formulaire');
});

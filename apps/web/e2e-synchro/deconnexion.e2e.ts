/**
 * T09b — de bout en bout, avec la vraie API et le vrai service PowerSync (`pnpm e2e:synchro`,
 * lancement et règles : en-tête de synchro.e2e.ts). Sessions : vraies sessions de l'API
 * (apps/api/src/sync/test/amorcer-e2e.ts, API_URL posée).
 *
 * ── Page de diagnostic : ajouts attendus ────────────────────────────────────────────────────
 *
 *   bouton « Se déconnecter » : deconnecterAvecConfirmation(session, { urlApi, fetch, stockage,
 *       effacerBaseLocale: () => donnees.effacer(), compterEnAttente: () =>
 *       donnees.ecrituresEnAttente(), confirmer }) (contrat : src/connexion/deconnexion.test.ts),
 *       puis affiche [data-testid="deconnecte"] ; en cas d'échec, le message dans #erreur.
 *   relecture sécurité — confirmation : si la file d'envoi n'est pas vide, `confirmer` montre
 *       [data-testid="confirmation-deconnexion"], qui contient messagePerteSaisies(n) (« 3 saisies
 *       pas encore envoyées seront perdues ») et deux boutons (cibles d'au moins 48 px) :
 *       « Se déconnecter quand même » (un tap : déconnexion) et « Annuler » (confirmation
 *       masquée, rien ne change : session, saisies et bouton « Se déconnecter » intacts).
 *       File vide : pas de confirmation.
 *   (le reste de la page est inchangé : voir synchro.e2e.ts)
 *
 * ── Attendu ─────────────────────────────────────────────────────────────────────────────────
 *
 * 1. Déconnexion en ligne : jeton de renouvellement révoqué par l'API (renouveler → 401),
 *    session effacée, base locale vidée : rouverte pour le même utilisateur (sans synchro
 *    possible), elle ne contient plus rien du compte, pas même ce qui était déjà synchronisé.
 * 2. Déconnexion hors ligne avec 3 saisies en attente : confirmation qui les compte ; annuler ne
 *    déconnecte pas ; confirmer efface session et base locale, écritures en attente comprises
 *    (téléphone partagé : rien du compte précédent ne reste lisible). Adapté (relecture
 *    sécurité) : avant, la déconnexion effaçait les écritures en attente sans rien demander.
 * 3. Critère du ticket : renouvellement impossible (réseau coupé vers l'API) puis possible, avec
 *    rotation du jeton de renouvellement : l'écriture faite entre-temps arrive chez l'autre, une
 *    seule fois, et le jeton rangé sur le téléphone est le nouveau.
 *
 * Pour « rouvrir sans synchro », la page reçoit une session au jeton d'accès périmé et au jeton
 * de renouvellement inconnu : le renouvellement est refusé (401), la synchro s'arrête
 * (session-expiree), la base locale reste lisible et inscriptible.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION, type SessionConnexion } from '../src/connexion/session.ts';

const DELAI_SYNCHRO_MS = 20_000;
const PAUSE_HORS_LIGNE_MS = 3_000;

const API_URL = process.env.API_URL ?? '';
const SERVICES = API_URL !== '' && (process.env.POWERSYNC_URL ?? '') !== '';
const EN_CI = Boolean(process.env.CI);

const SCRIPT_AMORCAGE = fileURLToPath(new URL('../../api/src/sync/test/amorcer-e2e.ts', import.meta.url));

interface Amorcage {
  readonly fermeId: string;
  readonly sessions: readonly [SessionConnexion, SessionConnexion];
}

interface Telephone {
  readonly contexte: BrowserContext;
  readonly page: Page;
}

/** JWT illisible pour le serveur mais périmé pour le téléphone : force un renouvellement. */
const JETON_ACCES_PERIME = `e30.${Buffer.from(JSON.stringify({ sub: 'x', iat: 1, exp: 2 })).toString('base64url')}.x`;

test.describe('T09b : déconnexion et rotation de bout en bout', () => {
  test.skip(!SERVICES && !EN_CI, 'API_URL et POWERSYNC_URL requises (pnpm e2e:synchro)');

  let amorcage: Amorcage;

  test.beforeAll(() => {
    if (!SERVICES) throw new Error('API_URL et POWERSYNC_URL sont obligatoires en CI : lancer les e2e par pnpm e2e:synchro.');
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE], { encoding: 'utf8', env: process.env });
    amorcage = JSON.parse(sortie) as Amorcage;
  });

  const urlPage = () => `/diagnostic/synchro.html?ferme=${amorcage.fermeId}`;

  async function ouvrir(browser: Browser, session: SessionConnexion, attendreSynchro = true): Promise<Telephone> {
    const contexte = await browser.newContext();
    const page = await contexte.newPage();
    await page.goto(urlPage());
    await ranger(page, session);
    await page.reload();
    if (attendreSynchro) {
      await expect(page.getByTestId('etat-synchro')).toHaveAttribute('data-etat', 'synchronise', { timeout: DELAI_SYNCHRO_MS });
    }
    return { contexte, page };
  }

  async function ranger(page: Page, session: SessionConnexion): Promise<void> {
    await page.evaluate(([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    }, [CLE_SESSION, JSON.stringify(session)] as const);
  }

  async function sessionRangee(page: Page): Promise<SessionConnexion | null> {
    const brut = await page.evaluate((cle) => localStorage.getItem(cle), CLE_SESSION);
    return brut === null ? null : (JSON.parse(brut) as SessionConnexion);
  }

  async function saisirRecolte(page: Page, quantite: string): Promise<void> {
    await page.getByLabel('Quantité (kg)').fill(quantite);
    await page.getByRole('button', { name: 'Enregistrer la récolte' }).click();
  }

  const recolte = (page: Page, quantite: string) => page.locator(`[data-testid="recolte"][data-quantite="${quantite}"]`);
  const evenementsLocaux = (page: Page) => page.getByTestId('evenement-local');

  const confirmation = (page: Page) => page.getByTestId('confirmation-deconnexion');

  /** File d'envoi vide : un tap, aucune confirmation. */
  async function seDeconnecter(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await expect(page.getByTestId('deconnecte')).toBeVisible({ timeout: DELAI_SYNCHRO_MS });
    await expect(confirmation(page)).toBeHidden();
  }

  /** Rouvre la base locale du même utilisateur, synchro impossible, et y saisit un témoin (99,5 kg). */
  async function rouvrirSansSynchro(page: Page, utilisateur: SessionConnexion): Promise<void> {
    await ranger(page, { ...utilisateur, jetonAcces: JETON_ACCES_PERIME, jetonRenouvellement: 'inconnu-'.padEnd(43, 'x') });
    await page.reload();
    await expect(page.getByTestId('etat-synchro')).toHaveAttribute('data-etat', 'session-expiree', { timeout: DELAI_SYNCHRO_MS });
    // Témoin : la base locale est bien ouverte et lisible.
    await saisirRecolte(page, '99.5');
    await expect(recolte(page, '99.5')).toHaveCount(1, { timeout: 5_000 });
  }

  async function renouvelerDepuisNode(jetonRenouvellement: string): Promise<number> {
    const res = await fetch(`${API_URL}/auth/renouveler`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jetonRenouvellement }),
    });
    return res.status;
  }

  test('déconnexion en ligne : jeton révoqué, session effacée, base locale vidée', async ({ browser }) => {
    const [sessionA, sessionB] = amorcage.sessions;
    const a = await ouvrir(browser, sessionA);
    const b = await ouvrir(browser, sessionB);
    try {
      await saisirRecolte(a.page, '7');
      await expect(recolte(b.page, '7')).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
      await expect(recolte(a.page, '7')).toHaveCount(1);
      const avant = await sessionRangee(a.page);
      expect(avant).not.toBeNull();

      await seDeconnecter(a.page);
      expect(await sessionRangee(a.page)).toBeNull();
      expect(await renouvelerDepuisNode(avant?.jetonRenouvellement ?? '')).toBe(401);

      await rouvrirSansSynchro(a.page, sessionA);
      await expect(recolte(a.page, '7')).toHaveCount(0);
      await expect(evenementsLocaux(a.page)).toHaveCount(1); // le témoin seul
    } finally {
      await a.contexte.close();
      await b.contexte.close();
    }
  });

  test('déconnexion hors ligne avec 3 saisies en attente : confirmation, annuler garde tout, confirmer efface tout', async ({ browser }) => {
    const [, sessionB] = amorcage.sessions;
    const b = await ouvrir(browser, sessionB);
    try {
      await b.contexte.setOffline(true);
      for (const quantite of ['8', '8.25', '8.5']) {
        await saisirRecolte(b.page, quantite);
        await expect(recolte(b.page, quantite)).toHaveCount(1, { timeout: 2_000 });
      }

      // Un tap sur « Se déconnecter » : la confirmation compte les saisies qui seraient perdues.
      await b.page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
      await expect(confirmation(b.page)).toBeVisible();
      await expect(confirmation(b.page)).toContainText('3 saisies pas encore envoyées seront perdues');
      const quandMeme = confirmation(b.page).getByRole('button', { name: 'Se déconnecter quand même' });
      const annuler = confirmation(b.page).getByRole('button', { name: 'Annuler' });
      for (const bouton of [quandMeme, annuler]) {
        const boite = await bouton.boundingBox();
        expect(boite?.height ?? 0).toBeGreaterThanOrEqual(48);
      }

      // Annuler : rien ne change.
      await annuler.click();
      await expect(confirmation(b.page)).toBeHidden();
      await expect(b.page.getByTestId('deconnecte')).toBeHidden();
      expect(await sessionRangee(b.page)).not.toBeNull();
      await expect(recolte(b.page, '8.5')).toHaveCount(1);
      await expect(b.page.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeEnabled();

      // Confirmer en un tap : déconnecté, tout effacé.
      await b.page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
      await expect(confirmation(b.page)).toContainText('3 saisies pas encore envoyées seront perdues');
      await confirmation(b.page).getByRole('button', { name: 'Se déconnecter quand même' }).click();
      await expect(b.page.getByTestId('deconnecte')).toBeVisible({ timeout: DELAI_SYNCHRO_MS });
      expect(await sessionRangee(b.page)).toBeNull();

      await b.contexte.setOffline(false);
      await rouvrirSansSynchro(b.page, sessionB);
      for (const quantite of ['8', '8.25', '8.5']) await expect(recolte(b.page, quantite)).toHaveCount(0);
      await expect(evenementsLocaux(b.page)).toHaveCount(1);
    } finally {
      await b.contexte.close();
    }
  });

  test('renouvellement impossible puis possible, avec rotation : l’écriture faite entre-temps arrive, une seule fois', async ({ browser }) => {
    // Nouvelles sessions : les deux premiers tests ont déconnecté A et B.
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE], { encoding: 'utf8', env: process.env });
    const frais = JSON.parse(sortie) as Amorcage;
    const [sessionA, sessionB] = frais.sessions;
    const pageFerme = `/diagnostic/synchro.html?ferme=${frais.fermeId}`;

    const contexteB = await browser.newContext();
    const pageB = await contexteB.newPage();
    const contexteA = await browser.newContext();
    try {
      await pageB.goto(pageFerme);
      await ranger(pageB, sessionB);
      await pageB.reload();
      await expect(pageB.getByTestId('etat-synchro')).toHaveAttribute('data-etat', 'synchronise', { timeout: DELAI_SYNCHRO_MS });

      // Téléphone A : jeton d'accès périmé, API injoignable pour le renouvellement.
      let apiCoupee = true;
      await contexteA.route('**/auth/renouveler', (route) => (apiCoupee ? route.abort('internetdisconnected') : route.continue()));
      const pageA = await contexteA.newPage();
      await pageA.goto(pageFerme);
      await ranger(pageA, { ...sessionA, jetonAcces: JETON_ACCES_PERIME });
      await pageA.reload();

      await saisirRecolte(pageA, '31');
      await expect(recolte(pageA, '31')).toHaveCount(1, { timeout: 2_000 });
      await pageB.waitForTimeout(PAUSE_HORS_LIGNE_MS);
      await expect(recolte(pageB, '31')).toHaveCount(0);

      apiCoupee = false;
      await expect(recolte(pageB, '31')).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
      await expect(recolte(pageA, '31')).toHaveCount(1);
      await expect(pageA.getByTestId('etat-synchro')).toHaveAttribute('data-etat', 'synchronise', { timeout: DELAI_SYNCHRO_MS });

      // Rotation : le téléphone a rangé le nouveau jeton de renouvellement, qui fonctionne.
      const rangee = await sessionRangee(pageA);
      expect(rangee?.jetonRenouvellement).toBeTruthy();
      expect(rangee?.jetonRenouvellement).not.toBe(sessionA.jetonRenouvellement);
    } finally {
      await contexteA.close();
      await contexteB.close();
    }
  });
});

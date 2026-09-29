/**
 * T10 — synchro de bout en bout : deux téléphones de la même ferme, une saisie faite hors ligne,
 * un refus du serveur qui ne bloque pas la file.
 *
 * ── Lancement ───────────────────────────────────────────────────────────────────────────────
 *
 *   pnpm e2e:synchro      (racine ; à écrire par T10, voir ci-dessous)
 *
 * Ce script démarre ce qu'il faut, puis lance `playwright test -c playwright.synchro.config.ts`
 * dans apps/web :
 *   1. `docker compose up -d --wait postgres powersync` : Postgres (wal_level=logical) et le
 *      service PowerSync (configuration `powersync/`) qui réplique la base de l'API ;
 *   2. migrations de @planif/db sur DATABASE_URL ;
 *   3. l'API (apps/api, `node src/index.ts`) avec DATABASE_URL, JWT_CLES_PRIVEES (générées par
 *      `pnpm --filter @planif/api cles` si absentes), JWT_EMETTEUR, JWT_AUDIENCE, PORT, et
 *      COURRIEL_CONSOLE=1 ; elle doit accepter l'origine de la page (CORS_ORIGINES, ex.
 *      http://localhost:4174) ; le service PowerSync lit son JWKS (PS_JWKS_URI) ;
 *   4. playwright avec, dans l'environnement :
 *        API_URL            URL de l'API vue par le navigateur (ex. http://localhost:3100)
 *        POWERSYNC_URL      URL du service vue par le navigateur (ex. http://localhost:8080)
 *        DATABASE_URL, JWT_CLES_PRIVEES, JWT_EMETTEUR, JWT_AUDIENCE : ceux de l'API (amorçage)
 *        SYNCHRO_BASE_URL   facultatif : page déjà servie ailleurs (sinon la configuration
 *                           construit dist-synchro/ et le sert sur http://localhost:4174)
 *   5. arrêt de l'API et des conteneurs, même en cas d'échec.
 *
 * Règle : sans API_URL ou POWERSYNC_URL, ces tests se sautent en local (avec un avertissement)
 * et ÉCHOUENT en CI. En CI, une étape « pnpm e2e:synchro » est donc obligatoire, après
 * `pnpm build`. `pnpm e2e` (budgets, hors-ligne) ne les lance pas.
 *
 * ── Page de diagnostic attendue ─────────────────────────────────────────────────────────────
 *
 * `/diagnostic/synchro.html?ferme=<fermeId>` : seconde entrée Vite (comme mesures/sqlite.html),
 * hors précache et hors navigation, qui n'utilise QUE @planif/sync (jamais PowerSync
 * directement). Session lue dans localStorage (`planif.session`, comme l'appli) ; API et
 * service PowerSync : VITE_API_URL et VITE_POWERSYNC_URL, figées au build (jamais lues dans
 * l'URL : un lien piégé enverrait le jeton ailleurs).
 *
 *   [data-testid="etat-synchro"][data-etat="synchronise"]  première synchro terminée
 *       (data-etat : 'connexion' | 'synchronise' | 'hors-ligne')
 *   champ « Quantité (kg) » (getByLabel) + bouton « Enregistrer la récolte » : saisit une
 *       récolte (porte.saisirEvenement : type recolte, date du jour, unité kg, source tap)
 *   [data-testid="recolte"][data-id=<id>][data-quantite=<String(quantité)>] : une par récolte
 *       en base locale (porte.surveiller), qu'elle vienne de ce téléphone ou d'un autre
 *   bouton « Modifier la dernière récolte sur place » : porte.ecrire(UPDATE evenement SET
 *       note = … WHERE id = <dernière récolte saisie ici>) — l'écriture interdite que le
 *       serveur doit refuser
 *   [data-testid="refus"][data-motif=<motif>] : un par refus (porte.surveillerRefus), texte =
 *       message du serveur
 *
 * Ajouts de la relecture T10 (M5) :
 *
 *   [data-testid="recolte"] porte aussi data-note = colonne `note` de la ligne locale (chaîne
 *       vide si NULL). Une récolte saisie par la page a une note NULL (data-note="").
 *   bouton « Saisir une récolte pour une autre ferme » : porte.ecrire(INSERT INTO evenement …)
 *       d'une récolte valide en tout point (99 kg, date du jour, horodatage ISO, auteur = la
 *       session, source 'tap', emplacement_ids '[]', photos '[]', note NULL) mais dont ferme_id
 *       est un UUID neuf (crypto.randomUUID()) : une ferme dont l'utilisateur n'est pas membre,
 *       que le serveur refuse ('ferme_interdite'). Son id (UUID) est affiché dans
 *       [data-testid="put-interdit"][data-id=<id>] (vide et sans data-id avant le clic).
 *   [data-testid="evenement-local"][data-id=<id>] : une par ligne de la table locale
 *       `evenement`, TOUTES FERMES CONFONDUES (porte.surveiller, SELECT id FROM evenement,
 *       tables ['evenement']), dans une liste « Événements en base locale ».
 *
 *   Attendu (M5) : une écriture refusée ne reste pas sur le téléphone. Après la synchro qui suit
 *   le refus, la ligne locale revient à la valeur du serveur (modification refusée) ou
 *   disparaît (création refusée). C'est le comportement de PowerSync quand la file est vide et
 *   que le point de contrôle du serveur arrive (vérifié par le testeur avec une maquette de la
 *   page : ces tests passent dès que les éléments ci-dessus existent).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION, type SessionConnexion } from '../src/connexion/session.ts';

/** Délai maximal pour qu'une écriture d'un téléphone apparaisse sur l'autre, réseau revenu. */
const DELAI_SYNCHRO_MS = 20_000;
/** Temps pendant lequel on vérifie que rien ne passe tant que le premier téléphone est hors ligne. */
const PAUSE_HORS_LIGNE_MS = 3_000;

const SERVICES = (process.env.API_URL ?? '') !== '' && (process.env.POWERSYNC_URL ?? '') !== '';
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

if (!SERVICES && !EN_CI) {
  console.warn('[T10] API_URL ou POWERSYNC_URL absente : tests de bout en bout de la synchro sautés.');
}

test.describe('T10 : synchro de bout en bout', () => {
  test.skip(!SERVICES && !EN_CI, 'API_URL et POWERSYNC_URL requises (pnpm e2e:synchro)');

  let amorcage: Amorcage;

  test.beforeAll(() => {
    if (!SERVICES) throw new Error('API_URL et POWERSYNC_URL sont obligatoires en CI : lancer les e2e par pnpm e2e:synchro.');
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE], { encoding: 'utf8', env: process.env });
    amorcage = JSON.parse(sortie) as Amorcage;
  });

  async function ouvrir(browser: Browser, session: SessionConnexion): Promise<Telephone> {
    const contexte = await browser.newContext();
    await contexte.addInitScript(
      ([cle, valeur]) => {
        localStorage.setItem(cle, valeur);
      },
      [CLE_SESSION, JSON.stringify(session)] as const,
    );
    const page = await contexte.newPage();
    await page.goto(`/diagnostic/synchro.html?ferme=${amorcage.fermeId}`);
    await expect(page.getByTestId('etat-synchro')).toHaveAttribute('data-etat', 'synchronise', { timeout: DELAI_SYNCHRO_MS });
    return { contexte, page };
  }

  async function deuxTelephones(browser: Browser): Promise<[Telephone, Telephone]> {
    const [a, b] = amorcage.sessions;
    return [await ouvrir(browser, a), await ouvrir(browser, b)];
  }

  async function saisirRecolte(page: Page, quantite: string): Promise<void> {
    await page.getByLabel('Quantité (kg)').fill(quantite);
    await page.getByRole('button', { name: 'Enregistrer la récolte' }).click();
  }

  function recolte(page: Page, quantite: string) {
    return page.locator(`[data-testid="recolte"][data-quantite="${quantite}"]`);
  }

  test('saisie hors ligne : visible tout de suite sur le téléphone, puis chez l’autre au retour du réseau', async ({ browser }) => {
    const [a, b] = await deuxTelephones(browser);
    try {
      await a.contexte.setOffline(true);
      await saisirRecolte(a.page, '12.5');
      // L'écran change tout de suite, sans réseau.
      await expect(recolte(a.page, '12.5')).toHaveCount(1, { timeout: 2_000 });

      // Rien ne part tant que le téléphone est hors ligne.
      await b.page.waitForTimeout(PAUSE_HORS_LIGNE_MS);
      await expect(recolte(b.page, '12.5')).toHaveCount(0);

      await a.contexte.setOffline(false);
      await expect(recolte(b.page, '12.5')).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
      // Et une seule fois chez le premier : pas de doublon au retour de la synchro.
      await expect(recolte(a.page, '12.5')).toHaveCount(1);
    } finally {
      await a.contexte.close();
      await b.contexte.close();
    }
  });

  test('écriture refusée : le motif s’affiche sur le téléphone et l’écriture suivante passe', async ({ browser }) => {
    const [a, b] = await deuxTelephones(browser);
    try {
      await saisirRecolte(a.page, '3');
      await expect(recolte(b.page, '3')).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });

      // Un événement ne se modifie pas après coup : le serveur refuse (200 + refus enregistré).
      // Hors ligne d'abord, pour voir la modification locale avant qu'elle parte.
      await expect(recolte(a.page, '3')).toHaveAttribute('data-note', '');
      await a.contexte.setOffline(true);
      await a.page.getByRole('button', { name: 'Modifier la dernière récolte sur place' }).click();
      await expect(recolte(a.page, '3')).toHaveAttribute('data-note', 'modifiée sur place', { timeout: 2_000 });
      await a.contexte.setOffline(false);
      const refus = a.page.locator('[data-testid="refus"][data-motif="ajout_seul"]');
      await expect(refus).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
      await expect(refus).toHaveText(/\p{L}{3,}.*\p{L}{3,}/u);

      // M5 (relecture) : la valeur affichée revient à celle du serveur, chez l'auteur comme chez l'autre.
      await expect(recolte(a.page, '3')).toHaveAttribute('data-note', '', { timeout: DELAI_SYNCHRO_MS });
      await expect(recolte(b.page, '3')).toHaveAttribute('data-note', '');

      // La file n'est pas bloquée : la saisie suivante arrive chez l'autre.
      await saisirRecolte(a.page, '4');
      await expect(recolte(b.page, '4')).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });

      // Le refus ne concerne que son auteur.
      await expect(b.page.getByTestId('refus')).toHaveCount(0);
    } finally {
      await a.contexte.close();
      await b.contexte.close();
    }
  });

  test('création refusée (ferme interdite) : la ligne disparaît de la base locale après la synchro (relecture M5)', async ({ browser }) => {
    const [a, b] = await deuxTelephones(browser);
    try {
      await a.page.getByRole('button', { name: 'Saisir une récolte pour une autre ferme' }).click({ timeout: 5_000 });
      const temoin = a.page.getByTestId('put-interdit');
      await expect(temoin).toHaveAttribute('data-id', /^[0-9a-f-]{36}$/, { timeout: 2_000 });
      const id = (await temoin.getAttribute('data-id')) ?? '';
      const locale = a.page.locator(`[data-testid="evenement-local"][data-id="${id}"]`);

      // Le refus redescend chez l'auteur, puis la ligne refusée quitte sa base locale.
      await expect(a.page.locator('[data-testid="refus"][data-motif="ferme_interdite"]')).toHaveCount(1, {
        timeout: DELAI_SYNCHRO_MS,
      });
      await expect(locale).toHaveCount(0, { timeout: DELAI_SYNCHRO_MS });

      // La file n'est pas bloquée, et l'autre téléphone n'a jamais vu la ligne.
      await saisirRecolte(a.page, '5');
      await expect(recolte(b.page, '5')).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
      await expect(b.page.locator(`[data-testid="evenement-local"][data-id="${id}"]`)).toHaveCount(0);
    } finally {
      await a.contexte.close();
      await b.contexte.close();
    }
  });
});

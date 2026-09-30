/**
 * T10c — le stock arrive au serveur et sur l'autre téléphone : une récolte notée hors ligne sur
 * une série de tomates, puis annulée, toujours hors ligne ; au retour du réseau, le second
 * téléphone reçoit la récolte, son annulation, les deux mouvements (+12 et −12) et un stock
 * inchangé. Lancement, services et règle de saut : comme synchro.e2e.ts (`pnpm e2e:synchro`).
 *
 * ── Amorçage attendu (apps/api/src/sync/test/amorcer-e2e.ts) ────────────────────────────────
 *
 *   node apps/api/src/sync/test/amorcer-e2e.ts --serie-tomates
 *
 * Avec l'argument `--serie-tomates`, en plus de la ferme et des deux sessions, la ferme reçoit :
 * une famille et une espèce « Tomate » DE LA FERME (unite_recolte 'kg'), une saison, un itinéraire
 * et une série de tomates en récolte (statut 'en_cours', prevu_debut_recolte ≤ aujourd'hui ≤
 * prevu_fin_recolte, jour à Europe/Paris), sans article de stock. La sortie JSON gagne :
 *
 *   "serieTomates": { "id": "<serie.id>", "especeId": "<espece.id>" }
 *
 * Sans l'argument, la sortie ne change pas (synchro.e2e.ts, deconnexion.e2e.ts).
 *
 * ── Page de diagnostic attendue (apps/web/diagnostic/synchro.html, src/diagnostic/synchro.ts) ─
 *
 * `/diagnostic/synchro.html?ferme=<fermeId>&serie=<serieId>` : la page de T10, plus une section
 * « Récolte d'une série » (paramètre `serie` : UUID ; absent ou invalide → section inerte). Comme
 * le reste de la page, tout passe par la porte de @planif/sync (jamais PowerSync directement) ; ne
 * dépend pas de l'écran « Aujourd'hui » de T13.
 *
 *   champ « Récolte de la série (kg) » (getByLabel) + bouton « Enregistrer la récolte de la série » :
 *       en UNE transaction de la porte (une seule transaction PowerSync, donc un seul envoi) :
 *       - l'article de stock de la ferme pour (espèce de la série, sa variété, unite =
 *         espece.unite_recolte, categorie NULL), créé s'il n'existe pas encore en base locale ;
 *       - l'événement de récolte (type 'recolte', date du jour à Europe/Paris, horodatage ISO,
 *         auteur = la session, source 'tap', serie_id, emplacement_ids '[]', photos '[]', note
 *         NULL, detail { quantite, unite, categorie: null }) ;
 *       - le mouvement de stock : +quantité, motif 'recolte', recolte_id = l'événement, date du jour.
 *   bouton « Annuler la dernière récolte de la série » : en UNE transaction de la porte :
 *       - l'événement d'annulation : mêmes colonnes et même détail que la récolte annulée,
 *         horodatage neuf, remplace_sorte 'annulation', remplace_evenement_id = la récolte ;
 *       - le mouvement inverse : même article, −quantité, motif 'recolte', recolte_id =
 *         l'événement d'ANNULATION (interprétation retenue avec T13).
 *   [data-testid="evenement-serie"] : un par ligne locale de `evenement` de cette série
 *       (annulations comprises), avec data-id, data-quantite (String(detail.quantite)),
 *       data-remplace-sorte et data-remplace-id (chaîne vide si NULL).
 *   [data-testid="mouvement"] : un par ligne locale de `mouvement_stock` de la ferme, avec data-id,
 *       data-article, data-quantite (String(quantite) : '12', '-12'), data-motif, data-recolte.
 *   [data-testid="stock"] : un par ligne locale de `article_stock` de la ferme, avec data-article
 *       et data-quantite = String(somme des quantités de ses mouvements) ('0' sans mouvement).
 *   [data-testid="en-attente"] : data-nombre = String(ecrituresEnAttente()) (transactions pas
 *       encore envoyées), à jour à une seconde près.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION, type SessionConnexion } from '../src/connexion/session.ts';

/** Délai maximal pour qu'une écriture d'un téléphone apparaisse sur l'autre, réseau revenu. */
const DELAI_SYNCHRO_MS = 20_000;
/** Temps pendant lequel on vérifie que rien ne passe tant que le premier téléphone est hors ligne. */
const PAUSE_HORS_LIGNE_MS = 3_000;
/** Délai d'un affichage local (base du téléphone, sans réseau). */
const DELAI_LOCAL_MS = 3_000;

const SERVICES = (process.env.API_URL ?? '') !== '' && (process.env.POWERSYNC_URL ?? '') !== '';
const EN_CI = Boolean(process.env.CI);

const SCRIPT_AMORCAGE = fileURLToPath(new URL('../../api/src/sync/test/amorcer-e2e.ts', import.meta.url));

interface Amorcage {
  readonly fermeId: string;
  readonly sessions: readonly [SessionConnexion, SessionConnexion];
  readonly serieTomates?: { readonly id: string; readonly especeId: string };
}

interface Telephone {
  readonly contexte: BrowserContext;
  readonly page: Page;
}

if (!SERVICES && !EN_CI) {
  console.warn('[T10c] API_URL ou POWERSYNC_URL absente : test de bout en bout du stock sauté.');
}

test.describe('T10c : le stock passe par la synchro', () => {
  test.skip(!SERVICES && !EN_CI, 'API_URL et POWERSYNC_URL requises (pnpm e2e:synchro)');

  let amorcage: Amorcage;
  let serieId: string;

  test.beforeAll(() => {
    if (!SERVICES) throw new Error('API_URL et POWERSYNC_URL sont obligatoires en CI : lancer les e2e par pnpm e2e:synchro.');
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE, '--serie-tomates'], { encoding: 'utf8', env: process.env });
    amorcage = JSON.parse(sortie) as Amorcage;
    if (amorcage.serieTomates === undefined) {
      throw new Error(`amorçage : « serieTomates » absent de la sortie de amorcer-e2e.ts --serie-tomates (clés : ${Object.keys(amorcage).join(', ')})`);
    }
    serieId = amorcage.serieTomates.id;
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
    await page.goto(`/diagnostic/synchro.html?ferme=${amorcage.fermeId}&serie=${serieId}`);
    await expect(page.getByTestId('etat-synchro')).toHaveAttribute('data-etat', 'synchronise', { timeout: DELAI_SYNCHRO_MS });
    return { contexte, page };
  }

  const evenementsSerie = (page: Page) => page.getByTestId('evenement-serie');
  const mouvements = (page: Page) => page.getByTestId('mouvement');
  const mouvement = (page: Page, quantite: string, recolteId: string) =>
    page.locator(`[data-testid="mouvement"][data-quantite="${quantite}"][data-motif="recolte"][data-recolte="${recolteId}"]`);
  const stocks = (page: Page) => page.getByTestId('stock');

  test('A hors ligne note 12 kg de tomates puis les annule ; au retour du réseau, B reçoit tout et le stock est inchangé', async ({ browser }) => {
    const a = await ouvrir(browser, amorcage.sessions[0]);
    const b = await ouvrir(browser, amorcage.sessions[1]);
    try {
      // Au départ : ni récolte, ni mouvement, ni article sur la série.
      for (const t of [a, b]) {
        await expect(evenementsSerie(t.page)).toHaveCount(0);
        await expect(mouvements(t.page)).toHaveCount(0);
        await expect(stocks(t.page)).toHaveCount(0);
      }

      await a.contexte.setOffline(true);

      // 12 kg, hors ligne : événement, article et mouvement +12 dans UNE transaction.
      await a.page.getByLabel('Récolte de la série (kg)').fill('12');
      await a.page.getByRole('button', { name: 'Enregistrer la récolte de la série' }).click();
      const recolte = a.page.locator('[data-testid="evenement-serie"][data-quantite="12"][data-remplace-sorte=""]');
      await expect(recolte).toHaveCount(1, { timeout: DELAI_LOCAL_MS });
      const recolteId = (await recolte.getAttribute('data-id')) ?? '';
      expect(recolteId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(mouvement(a.page, '12', recolteId)).toHaveCount(1, { timeout: DELAI_LOCAL_MS });
      await expect(stocks(a.page)).toHaveCount(1);
      await expect(stocks(a.page)).toHaveAttribute('data-quantite', '12');
      const articleId = (await stocks(a.page).getAttribute('data-article')) ?? '';
      expect(articleId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(mouvement(a.page, '12', recolteId)).toHaveAttribute('data-article', articleId);
      await expect(a.page.getByTestId('en-attente'), 'une saisie = une transaction').toHaveAttribute('data-nombre', '1', {
        timeout: DELAI_LOCAL_MS,
      });

      // Annulation, toujours hors ligne : événement d'annulation et mouvement −12 dans UNE transaction.
      await a.page.getByRole('button', { name: 'Annuler la dernière récolte de la série' }).click();
      const annulation = a.page.locator(
        `[data-testid="evenement-serie"][data-remplace-sorte="annulation"][data-remplace-id="${recolteId}"]`,
      );
      await expect(annulation).toHaveCount(1, { timeout: DELAI_LOCAL_MS });
      const annulationId = (await annulation.getAttribute('data-id')) ?? '';
      expect(annulationId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(mouvement(a.page, '-12', annulationId)).toHaveCount(1, { timeout: DELAI_LOCAL_MS });
      await expect(mouvement(a.page, '-12', annulationId)).toHaveAttribute('data-article', articleId);
      await expect(stocks(a.page)).toHaveAttribute('data-quantite', '0');
      await expect(a.page.getByTestId('en-attente'), 'la récolte et son annulation : deux transactions').toHaveAttribute(
        'data-nombre',
        '2',
        { timeout: DELAI_LOCAL_MS },
      );

      // Rien ne part tant que A est hors ligne.
      await b.page.waitForTimeout(PAUSE_HORS_LIGNE_MS);
      await expect(evenementsSerie(b.page)).toHaveCount(0);
      await expect(mouvements(b.page)).toHaveCount(0);

      await a.contexte.setOffline(false);

      // B reçoit la récolte et son annulation, les deux mouvements, et un stock inchangé.
      await expect(evenementsSerie(b.page)).toHaveCount(2, { timeout: DELAI_SYNCHRO_MS });
      await expect(b.page.locator(`[data-testid="evenement-serie"][data-id="${recolteId}"]`)).toHaveAttribute('data-remplace-sorte', '');
      await expect(b.page.locator(`[data-testid="evenement-serie"][data-id="${annulationId}"]`)).toHaveAttribute(
        'data-remplace-id',
        recolteId,
      );
      await expect(mouvements(b.page)).toHaveCount(2, { timeout: DELAI_SYNCHRO_MS });
      await expect(mouvement(b.page, '12', recolteId)).toHaveAttribute('data-article', articleId);
      await expect(mouvement(b.page, '-12', annulationId)).toHaveAttribute('data-article', articleId);
      await expect(b.page.locator(`[data-testid="stock"][data-article="${articleId}"]`)).toHaveAttribute('data-quantite', '0', {
        timeout: DELAI_SYNCHRO_MS,
      });
      await expect(stocks(b.page)).toHaveCount(1);

      // Chez A : tout est parti, rien n'a été refusé, rien en double.
      await expect(a.page.getByTestId('en-attente')).toHaveAttribute('data-nombre', '0', { timeout: DELAI_SYNCHRO_MS });
      await expect(a.page.getByTestId('refus')).toHaveCount(0);
      await expect(evenementsSerie(a.page)).toHaveCount(2);
      await expect(mouvements(a.page)).toHaveCount(2);
      await expect(stocks(a.page)).toHaveAttribute('data-quantite', '0');
    } finally {
      await a.contexte.close();
      await b.contexte.close();
    }
  });
});

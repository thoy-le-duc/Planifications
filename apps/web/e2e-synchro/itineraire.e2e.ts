/**
 * T23 — un itinéraire et un type d'intervention passent par la synchro : le téléphone A, hors
 * ligne, crée un type d'intervention « binage » propre à la ferme et un itinéraire qui l'utilise
 * avec la grelinette de la liste de départ. Au retour du réseau, le téléphone B reçoit les deux,
 * et l'historique du serveur compte une création pour chacun. A masque ensuite le type : B le voit
 * masqué, l'itinéraire reste intact. Lancement, services et règle de saut : comme serie.e2e.ts
 * (`pnpm e2e:synchro`, banc paramétrable de T10c).
 * Exemple : E2E_PROJET_COMPOSE=t23 E2E_PORT_PAGE=4411 E2E_PORT_POSTGRES=55433
 *           E2E_PORT_POWERSYNC=8181 E2E_PORT_API=3111 pnpm e2e:synchro
 *
 * ── Amorçage (apps/api/src/sync/test/amorcer-e2e.ts) ────────────────────────────────────────
 *
 *   node apps/api/src/sync/test/amorcer-e2e.ts --plan-serie
 *
 * Celui de T10e, sans changement : la ferme, deux sessions, et « planSerie » (espèce « Laitue »
 * de la ferme et son itinéraire « Batavia de printemps », parametres = la batavia de T02). La
 * liste de départ des types d'intervention est en base par les migrations (ferme_id nul).
 *
 * ── Page de diagnostic attendue (apps/web/diagnostic/synchro.html, src/diagnostic/) ─────────
 *
 * `/diagnostic/synchro.html?ferme=<id>&espece=<especeId>` : la page de T10, plus une section
 * « Itinéraires » (paramètre `espece` absent ou pas un UUID → section inerte). Tout passe par la
 * porte de @planif/sync ; « UNE transaction de la porte » = un appel à `porte.ecrireEnsemble`.
 *
 *   champ « Nouveau type d’intervention » (getByLabel) + champ « Nom du nouvel itinéraire »
 *   (getByLabel) + bouton « Créer le type et l’itinéraire » : en UNE transaction de la porte :
 *     - INSERT type_intervention : id neuf, ferme, categorie 'entretien', libelle = le premier
 *       champ, masque 0 ;
 *     - INSERT itineraire : id neuf, ferme, espece_id = `espece`, variete_id NULL, nom = le second
 *       champ, mode et parametres = ceux du premier itinéraire local de l'espèce (DUPLICATION),
 *       auxquels la page ajoute parametres.travauxPrevus = [
 *         { categorie 'travail_sol', type 'grelinette', repere 'mise_en_place', decalageJours -10 },
 *         { categorie 'entretien', type = le premier champ, repere 'mise_en_place',
 *           decalageJours 0, repetition { tousLesJours 14, repereFin 'debut_recolte' } } ]
 *       (parametres en texte JSON).
 *   bouton « Masquer le dernier type créé » : en UNE transaction de la porte, UPDATE
 *     type_intervention SET masque = 1 du dernier type créé par la section.
 *   [data-testid="type-intervention"] : un par ligne locale NON SUPPRIMÉE de `type_intervention`
 *     (de la ferme ou de la liste de départ), avec data-id, data-categorie, data-libelle,
 *     data-ferme (ferme_id, chaîne vide si NULL), data-masque ('0' | '1').
 *   [data-testid="itineraire"] : un par ligne locale de `itineraire` DE LA FERME dont espece_id =
 *     `espece`, avec data-id, data-nom, data-supprime ('oui' | 'non'), data-travaux (JSON d'une
 *     liste de textes « categorie/type », un par travail prévu de parametres.travauxPrevus, dans
 *     l'ordre ; '[]' sans travaux).
 *   [data-testid="historique-itineraire"] : un par ligne locale de `modification` (redescendue du
 *     serveur) dont nom_table est 'Itineraire' ou 'TypeIntervention' et ligne_id l'une de ces
 *     lignes, avec data-table, data-ligne, data-operation.
 *   [data-testid="en-attente"], [data-testid="refus"] : ceux de T10 et T10c.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TYPES_INTERVENTION_PAR_DEFAUT } from '@planif/core';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CLE_SESSION, type SessionConnexion } from '../src/connexion/session.ts';

const DELAI_SYNCHRO_MS = 20_000;
const PAUSE_HORS_LIGNE_MS = 3_000;
const DELAI_LOCAL_MS = 3_000;

const SERVICES = (process.env.API_URL ?? '') !== '' && (process.env.POWERSYNC_URL ?? '') !== '';
const EN_CI = Boolean(process.env.CI);

const SCRIPT_AMORCAGE = fileURLToPath(new URL('../../api/src/sync/test/amorcer-e2e.ts', import.meta.url));

/** Nombre de types de la liste de départ (modèle de données, section 5). */
const TYPES_DE_DEPART = Object.values(TYPES_INTERVENTION_PAR_DEFAUT).reduce((n, l) => n + l.length, 0);

const TYPE = 'binage';
const ITINERAIRE = 'Batavia maison';

interface Amorcage {
  readonly fermeId: string;
  readonly sessions: readonly [SessionConnexion, SessionConnexion];
  readonly planSerie?: { readonly especeId: string };
}

interface Telephone {
  readonly contexte: BrowserContext;
  readonly page: Page;
}

if (!SERVICES && !EN_CI) {
  console.warn('[T23] API_URL ou POWERSYNC_URL absente : test de bout en bout des itinéraires sauté.');
}

test.describe('T23 : un itinéraire et un type d’intervention passent par la synchro', () => {
  test.skip(!SERVICES && !EN_CI, 'API_URL et POWERSYNC_URL requises (pnpm e2e:synchro)');

  let amorcage: Amorcage;
  let especeId: string;

  test.beforeAll(() => {
    if (!SERVICES) throw new Error('API_URL et POWERSYNC_URL sont obligatoires en CI : lancer les e2e par pnpm e2e:synchro.');
    const sortie = execFileSync(process.execPath, [SCRIPT_AMORCAGE, '--plan-serie'], { encoding: 'utf8', env: process.env });
    amorcage = JSON.parse(sortie) as Amorcage;
    if (amorcage.planSerie === undefined) throw new Error('amorçage : « planSerie » absent de la sortie de amorcer-e2e.ts --plan-serie');
    especeId = amorcage.planSerie.especeId;
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
    const parametres = new URLSearchParams({ ferme: amorcage.fermeId, espece: especeId });
    await page.goto(`/diagnostic/synchro.html?${parametres.toString()}`);
    await expect(page.getByTestId('etat-synchro')).toHaveAttribute('data-etat', 'synchronise', { timeout: DELAI_SYNCHRO_MS });
    return { contexte, page };
  }

  const itineraires = (page: Page) => page.getByTestId('itineraire');
  const itineraireNomme = (page: Page) => page.locator(`[data-testid="itineraire"][data-nom="${ITINERAIRE}"]`);
  const typesDeLaFerme = (page: Page) => page.locator(`[data-testid="type-intervention"]:not([data-ferme=""])`);
  const typesDeDepart = (page: Page) => page.locator(`[data-testid="type-intervention"][data-ferme=""]`);
  const typeCree = (page: Page) => page.locator(`[data-testid="type-intervention"][data-libelle="${TYPE}"]:not([data-ferme=""])`);
  const historique = (page: Page) => page.getByTestId('historique-itineraire');

  test('A hors ligne crée un type « binage » et un itinéraire qui l’utilise ; au retour du réseau, B reçoit les deux, puis voit le type masqué', async ({
    browser,
  }) => {
    const a = await ouvrir(browser, amorcage.sessions[0]);
    const b = await ouvrir(browser, amorcage.sessions[1]);
    try {
      // Au départ : la liste de départ est descendue sur les deux téléphones (flux de référence),
      // aucun type propre à la ferme, un seul itinéraire de l'espèce (celui de l'amorçage).
      for (const t of [a, b]) {
        await expect(typesDeDepart(t.page)).toHaveCount(TYPES_DE_DEPART, { timeout: DELAI_SYNCHRO_MS });
        await expect(t.page.locator('[data-testid="type-intervention"][data-ferme=""][data-libelle="grelinette"]')).toHaveAttribute(
          'data-categorie',
          'travail_sol',
        );
        await expect(typesDeLaFerme(t.page)).toHaveCount(0);
        await expect(itineraires(t.page)).toHaveCount(1);
        await expect(historique(t.page)).toHaveCount(0);
      }

      await a.contexte.setOffline(true);

      // Hors ligne : le type et l'itinéraire dans UNE transaction.
      await a.page.getByLabel('Nouveau type d’intervention').fill(TYPE);
      await a.page.getByLabel('Nom du nouvel itinéraire').fill(ITINERAIRE);
      await a.page.getByRole('button', { name: 'Créer le type et l’itinéraire' }).click();
      await expect(typeCree(a.page)).toHaveCount(1, { timeout: DELAI_LOCAL_MS });
      await expect(typeCree(a.page)).toHaveAttribute('data-categorie', 'entretien');
      await expect(typeCree(a.page)).toHaveAttribute('data-masque', '0');
      await expect(itineraireNomme(a.page)).toHaveCount(1, { timeout: DELAI_LOCAL_MS });
      await expect(itineraireNomme(a.page)).toHaveAttribute('data-travaux', JSON.stringify(['travail_sol/grelinette', `entretien/${TYPE}`]));
      await expect(a.page.getByTestId('en-attente'), 'type + itinéraire = une transaction').toHaveAttribute('data-nombre', '1', {
        timeout: DELAI_LOCAL_MS,
      });
      const typeId = (await typeCree(a.page).getAttribute('data-id')) ?? '';
      const itineraireId = (await itineraireNomme(a.page).getAttribute('data-id')) ?? '';
      expect(typeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(itineraireId).toMatch(/^[0-9a-f-]{36}$/);

      // Rien ne part tant que A est hors ligne.
      await b.page.waitForTimeout(PAUSE_HORS_LIGNE_MS);
      await expect(typesDeLaFerme(b.page)).toHaveCount(0);
      await expect(itineraires(b.page)).toHaveCount(1);

      await a.contexte.setOffline(false);

      // B reçoit le type et l'itinéraire, avec ses deux travaux.
      await expect(typeCree(b.page)).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
      await expect(typeCree(b.page)).toHaveAttribute('data-id', typeId);
      await expect(typeCree(b.page)).toHaveAttribute('data-ferme', amorcage.fermeId);
      await expect(itineraireNomme(b.page)).toHaveCount(1, { timeout: DELAI_SYNCHRO_MS });
      await expect(itineraireNomme(b.page)).toHaveAttribute('data-id', itineraireId);
      await expect(itineraireNomme(b.page)).toHaveAttribute('data-supprime', 'non');
      await expect(itineraireNomme(b.page)).toHaveAttribute('data-travaux', JSON.stringify(['travail_sol/grelinette', `entretien/${TYPE}`]));
      // La liste de départ n'a pas bougé.
      await expect(typesDeDepart(b.page)).toHaveCount(TYPES_DE_DEPART);

      // L'historique du serveur, redescendu : une création pour chacun.
      await expect(historique(b.page)).toHaveCount(2, { timeout: DELAI_SYNCHRO_MS });
      await expect(b.page.locator(`[data-testid="historique-itineraire"][data-ligne="${typeId}"]`)).toHaveAttribute('data-table', 'TypeIntervention');
      await expect(b.page.locator(`[data-testid="historique-itineraire"][data-ligne="${typeId}"]`)).toHaveAttribute('data-operation', 'creation');
      await expect(b.page.locator(`[data-testid="historique-itineraire"][data-ligne="${itineraireId}"]`)).toHaveAttribute('data-table', 'Itineraire');
      await expect(b.page.locator(`[data-testid="historique-itineraire"][data-ligne="${itineraireId}"]`)).toHaveAttribute('data-operation', 'creation');

      // Chez A : tout est parti, rien n'a été refusé.
      await expect(a.page.getByTestId('en-attente')).toHaveAttribute('data-nombre', '0', { timeout: DELAI_SYNCHRO_MS });
      await expect(a.page.getByTestId('refus')).toHaveCount(0);

      // A masque le type (un type utilisé ne se supprime pas, il se masque) : B le voit masqué,
      // l'itinéraire qui l'utilise reste intact.
      await a.page.getByRole('button', { name: 'Masquer le dernier type créé' }).click();
      await expect(typeCree(b.page)).toHaveAttribute('data-masque', '1', { timeout: DELAI_SYNCHRO_MS });
      await expect(itineraireNomme(b.page)).toHaveAttribute('data-travaux', JSON.stringify(['travail_sol/grelinette', `entretien/${TYPE}`]));
      await expect(historique(b.page)).toHaveCount(3, { timeout: DELAI_SYNCHRO_MS });
      await expect(a.page.getByTestId('en-attente')).toHaveAttribute('data-nombre', '0', { timeout: DELAI_SYNCHRO_MS });
      await expect(a.page.getByTestId('refus')).toHaveCount(0);
    } finally {
      await a.contexte.close();
      await b.contexte.close();
    }
  });
});

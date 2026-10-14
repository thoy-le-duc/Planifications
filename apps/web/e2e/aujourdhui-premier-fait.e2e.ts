import { expect, test, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { grandeFerme } from '../src/ecrans/aujourdhui/test/grande-ferme.ts';
import { decrireSerie, jugerSerie, ralentirCpu, REPETITIONS_MESURE, repeterMesures } from './outils.ts';

/**
 * T13u — le tout premier « Fait » d'un lancement à froid, sur la grande ferme de T13b (3 000
 * séries actives, ≈ 51 000 événements), build des essais, CPU ×4, hors ligne.
 *
 * Chaque répétition est un lancement à froid (rechargement) AVEC instantané : l'écran dessine
 * l'instantané, la base s'ouvre (data-base="prete"), la relecture complète de la journée démarre
 * (pages froides). « Marquer fait » est tapé sur la première tâche dans la seconde qui suit
 * l'ouverture de la base : 0, 200, 400, 600 puis 800 ms après data-base="prete" (un délai par
 * répétition, toute la seconde est couverte). Le tap est fait par la page elle-même (script
 * d'initialisation), à l'instant voulu, sans l'aller-retour de Playwright.
 *
 * Mesure : du tap à l'arrivée de la saisie en tête de l'historique (première ligne
 * data-testid="saisie-historique" dont l'événement n'est pas celui qui était en tête avant le
 * rechargement : la dernière journée relue, que l'instantané reprend).
 *
 * Critère (BLOQUANT) : médiane de 5 sous 500 ms et plus haute valeur au plus 1,5 fois
 * (`jugerSerie`). Constat de T13t (`docs/mesures/T13t-apres.md`) : ≈ 1,0 à 1,2 s.
 */

const BUDGET_PREMIER_FAIT_MS = 500;
/** Délais du tap après l'ouverture de la base, un par répétition (ms). */
const DELAIS_TAP_MS = [0, 200, 400, 600, 800] as const;
/** Laissé à l'appli pour garder l'instantané de la journée relue (comme aujourdhui-grande-ferme.e2e.ts). */
const DELAI_ECRITURE_INSTANTANE_MS = 1_500;
const DELAI_AMORCAGE_MS = 240_000;
/** Drapeau (sessionStorage) : délai du tap du prochain chargement, consommé par lui. */
const DRAPEAU = 'e2e.t13u.premier-fait';

test.use({ actionTimeout: 15_000 });

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

/** Relevé de la page (window.__premierFait). */
interface Releve {
  readonly avant: string | null;
  basePrete?: number;
  tap?: number;
  /** Clé de la tâche touchée. */
  cle?: string;
  /** La tâche touchée était sur l'instantané (aucun bouton de l'historique actif, ou historique pas encore dessiné). */
  surInstantane?: boolean;
  saisie?: number;
  evenement?: string;
  erreur?: string;
}

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

const ecran = (page: Page) => page.getByTestId('aujourdhui');
const taches = (page: Page) => page.getByTestId('tache');
const enTete = (page: Page) => page.getByTestId('saisie-historique').first();

/**
 * Au chargement armé par DRAPEAU ({ delai, avant }) : dès data-base="prete", attend `delai` ms,
 * tape « Marquer fait » sur la première tâche qui en a un, puis relève l'arrivée d'une saisie en
 * tête de l'historique autre que `avant`.
 */
async function armer(page: Page): Promise<void> {
  await page.addInitScript((drapeau) => {
    const texte = sessionStorage.getItem(drapeau);
    if (texte === null) return;
    sessionStorage.removeItem(drapeau);
    const { delai, avant } = JSON.parse(texte) as { delai: number; avant: string | null };
    const releve: { avant: string | null; basePrete?: number; tap?: number; cle?: string; surInstantane?: boolean; saisie?: number; evenement?: string; erreur?: string } = { avant };
    (window as unknown as { __premierFait?: unknown }).__premierFait = releve;
    const enTete = () => document.querySelector<HTMLElement>('[data-testid="saisie-historique"]');
    const suivreSaisie = () => {
      const voir = () => {
        const e = enTete()?.getAttribute('data-evenement') ?? null;
        if (releve.saisie === undefined && e !== null && e !== avant) {
          releve.saisie = performance.now();
          releve.evenement = e;
          observateur.disconnect();
        }
      };
      const observateur = new MutationObserver(voir);
      observateur.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-evenement'] });
      voir();
    };
    const taper = () => {
      const bouton = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="tache"] button')].find(
        (b) => (b.getAttribute('aria-label') ?? '').startsWith('Marquer fait') && !b.disabled && b.getAttribute('aria-disabled') !== 'true',
      );
      if (bouton === undefined) {
        releve.erreur = 'aucun « Marquer fait » actif';
        return;
      }
      const boutonsHistorique = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="saisie-historique"] button')];
      // Instantané : aucun bouton de l'historique actif (T13g), ou historique pas encore dessiné.
      releve.surInstantane = boutonsHistorique.every((b) => b.disabled || b.getAttribute('aria-disabled') === 'true');
      releve.cle = bouton.closest<HTMLElement>('[data-testid="tache"]')?.getAttribute('data-cle') ?? '';
      suivreSaisie();
      releve.tap = performance.now();
      bouton.click();
    };
    const observateurBase = new MutationObserver(() => {
      if (document.querySelector('[data-testid="app"]')?.getAttribute('data-base') !== 'prete') return;
      observateurBase.disconnect();
      releve.basePrete = performance.now();
      setTimeout(taper, delai);
    });
    observateurBase.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-base'] });
  }, DRAPEAU);
}

test('T13u : premier « Fait » d’un lancement à froid, grande ferme, dans la seconde après l’ouverture de la base', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 300_000);
  const aujourdhui = jourLocal(new Date());
  const ferme = grandeFerme(aujourdhui);

  await test.step('amorcer la base locale avec la grande ferme (page de diagnostic)', async () => {
    await page.goto(`/diagnostic/amorcer.html?jeu=aujourdhui-grande-ferme&date=${aujourdhui}`);
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(ferme.utilisateurId);
    expect(a.fermeId).toBe(ferme.fermeId);
    expect(a.lignes, 'lignes insérées : exactement la grande ferme').toBe(ferme.total);
  });

  await test.step('connexion (session rangée), installation du service worker', async () => {
    await page.goto('/');
    await page.evaluate(
      ([cle, valeur]) => {
        localStorage.setItem(cle, valeur);
      },
      [
        CLE_SESSION,
        JSON.stringify({ utilisateurId: ferme.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }),
      ] as const,
    );
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 60_000 });
    await expect(taches(page).first()).toBeVisible({ timeout: 60_000 });
  });

  await context.setOffline(true);
  await ralentirCpu(page);
  await armer(page);

  await test.step(`premier « Fait » à froid, tapé 0 à 800 ms après l’ouverture de la base : saisie dans l’historique en moins de ${String(BUDGET_PREMIER_FAIT_MS)} ms, médiane de 5, maximum 1,5 fois`, async () => {
    const releves: Releve[] = [];
    const series = await repeterMesures(REPETITIONS_MESURE, async (i) => {
      // La journée relue est affichée (boutons de l'historique actifs) : son instantané est gardé
      // avant le rechargement ; sa saisie de tête est celle que l'instantané reprendra.
      await expect(ecran(page).getByTestId('saisie-historique').first().getByRole('button').first()).toBeEnabled({ timeout: 30_000 });
      await page.waitForTimeout(DELAI_ECRITURE_INSTANTANE_MS);
      const avant = await enTete(page).getAttribute('data-evenement');
      const delai = DELAIS_TAP_MS[i % DELAIS_TAP_MS.length] ?? 0;
      await page.evaluate(([drapeau, valeur]) => {
        sessionStorage.setItem(drapeau, valeur);
      }, [DRAPEAU, JSON.stringify({ delai, avant })] as const);
      await page.reload();
      const poignee = await page.waitForFunction(
        () => {
          const r = (window as unknown as { __premierFait?: { saisie?: number; erreur?: string } }).__premierFait;
          return r !== undefined && (r.saisie !== undefined || r.erreur !== undefined) ? r : undefined;
        },
        undefined,
        { timeout: 30_000 },
      );
      const r = (await poignee.jsonValue()) as Releve;
      releves.push(r);
      expect(r.erreur, `répétition ${String(i + 1)} : tap fait`).toBeUndefined();
      // La tâche touchée ne revient pas, et la saisie reste en tête une fois la journée relue.
      await expect(page.locator(`[data-testid="tache"][data-cle="${r.cle ?? ''}"]`)).toHaveCount(0);
      await expect(enTete(page)).toHaveAttribute('data-evenement', r.evenement ?? '', { timeout: 30_000 });
      return { premierFait: (r.saisie ?? Number.NaN) - (r.tap ?? Number.NaN), tapApresBase: (r.tap ?? Number.NaN) - (r.basePrete ?? Number.NaN) };
    });
    console.log(decrireSerie('T13u, grande ferme, premier « Fait » à froid (tap → saisie dans l’historique)', series.premierFait, BUDGET_PREMIER_FAIT_MS));
    console.log(
      `T13u, tap après l’ouverture de la base : ${series.tapApresBase.valeurs.map((v) => v.toFixed(0)).join(', ')} ms ; sur l’instantané : ${releves.map((r) => (r.surInstantane === true ? 'oui' : 'non')).join(', ')}`,
    );
    expect(jugerSerie(series.premierFait, BUDGET_PREMIER_FAIT_MS).raisons).toEqual([]);
  });
});

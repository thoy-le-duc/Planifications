import { expect, test, type Locator, type Page } from '@playwright/test';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { LIBELLES_UNITES, MARQUE_AUJOURDHUI_ATTENDUE } from '../src/ecrans/aujourdhui/test/contrat.ts';
import { cleTache, fermeDuJour, SERIE } from '../src/ecrans/aujourdhui/test/ferme-du-jour.ts';
import { COULEURS } from '../src/ui/jetons.ts';
import { ralentirCpu, surveillerCsp, tempsAppPrete } from './outils.ts';

/**
 * T13 — saisie terrain hors ligne, de bout en bout, sur le build de production servi par
 * `vite preview`, CPU ralenti ×4, réseau coupé. Contrat : src/ecrans/aujourdhui/test/contrat.ts.
 *
 * Amorçage : /diagnostic/amorcer.html?jeu=aujourdhui&date=<jour du téléphone> remplit la base
 * locale de l'utilisateur de test avec la ferme du jour (src/ecrans/aujourdhui/test/
 * ferme-du-jour.ts), datée relativement à aujourd'hui : les mêmes tâches tombent en retard
 * quel que soit le jour du test. Même page et mêmes garde-fous que T11 (e2e/plan.e2e.ts).
 *
 * Critère principal du ticket : marquer une plantation comme faite, noter 12 kg de tomates,
 * recharger l'appli toujours hors ligne, les deux saisies sont là. En plus :
 *   - écran « Aujourd'hui » affiché en moins de 300 ms (tap sur l'onglet, base ouverte : même
 *     méthode que T11) ; le premier affichage après un lancement à froid est mesuré et journalisé ;
 *   - « Annuler » visible 10 s après la saisie, puis annulable depuis l'historique ;
 *   - indicateur des saisies en attente d'envoi (file de PowerSync, ps_crud : une saisie = une
 *     transaction) : 1, 2, puis 3 après l'annulation, et toujours là après rechargement ;
 *   - cibles tactiles ≥ 56 px et contraste AA calculés sur la page réelle, fidélité à la maquette
 *     (bande orange du retard, pavé géant) ; à 360 px, pas de défilement horizontal ; aucune
 *     violation de la CSP.
 */

const BUDGET_MS = 300;
const CIBLE_MIN_PX = 56;
const DELAI_AMORCAGE_MS = 60_000;
const ANNULATION_MS = 10_000;

// Une commande masquée (barre de navigation par-dessus, élément qui se redessine sans fin) doit
// échouer vite et nommée, pas au bout du délai du test entier.
test.use({ actionTimeout: 15_000 });

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

function rgb(hex: string): string {
  const c = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${String(c(1))}, ${String(c(3))}, ${String(c(5))})`;
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const ecran = (page: Page) => page.getByTestId('aujourdhui');
const taches = (page: Page) => page.getByTestId('tache');
const tache = (page: Page, cle: string) => page.locator(`[data-testid="tache"][data-cle="${cle}"]`);
const recolte = (page: Page) => page.getByRole('dialog', { name: /^Récolte/ });
const bandeau = (page: Page) => page.getByTestId('saisie-annulable');
const etatSynchro = (page: Page) => page.getByTestId('etat-synchro');

/** La région « Historique », ouverte par son bouton si elle n'est pas à l'écran. */
async function historique(page: Page): Promise<Locator> {
  const region = page.getByRole('region', { name: 'Historique' });
  if ((await region.count()) === 0) await ecran(page).getByRole('button', { name: 'Historique' }).click();
  await expect(region).toBeVisible();
  return region;
}

/** Temps entre le prochain appui (pointerdown) et la marque de l'écran Aujourd'hui. */
async function tapJusquAAujourdhui(page: Page): Promise<number> {
  await page.evaluate((marque) => {
    performance.clearMarks(marque);
    const f = window as unknown as { __tap?: number };
    delete f.__tap;
    document.addEventListener(
      'pointerdown',
      () => {
        f.__tap = performance.now();
      },
      { capture: true, once: true },
    );
  }, MARQUE_AUJOURDHUI_ATTENDUE);
  await onglet(page, 'Aujourd’hui').click();
  await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_AUJOURDHUI_ATTENDUE);
  return page.evaluate((marque) => {
    const tap = (window as unknown as { __tap?: number }).__tap ?? Number.NaN;
    return (performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN) - tap;
  }, MARQUE_AUJOURDHUI_ATTENDUE);
}

/**
 * Commandes de saisie visibles (écran, récolte, bandeau, dialogues) : taille de la cible
 * (le <label> d'un radio natif) et contraste de leur texte sur leur fond effectif.
 */
async function verifierCommandes(page: Page, ou: string): Promise<void> {
  const mesures = await page.evaluate(() => {
    const selecteur = ['button', '[role="button"]', '[role="radio"]', 'input'].map((s) => `:is([data-testid="aujourdhui"], [role="dialog"], [data-testid="saisie-annulable"]) ${s}`).join(', ');
    const lin = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0] ?? 0) + 0.7152 * lin(rgb[1] ?? 0) + 0.0722 * lin(rgb[2] ?? 0);
    const lire = (s: string): number[] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (m === null) return null;
      const p = (m[1] ?? '').split(/[ ,/]+/).filter((x) => x !== '').map(Number);
      if (p.length === 4 && p[3] === 0) return null;
      return p.slice(0, 3);
    };
    const fond = (el: Element | null): number[] => {
      for (let e = el; e !== null; e = e.parentElement) {
        const c = lire(getComputedStyle(e).backgroundColor);
        if (c !== null) return c;
      }
      return [255, 255, 255];
    };
    return [...document.querySelectorAll<HTMLElement>(selecteur)]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (r.width > 0 && r.height > 0) || (el instanceof HTMLInputElement && el.closest('label') !== null);
      })
      .map((el) => {
        const cible = el instanceof HTMLInputElement ? (el.closest('label') ?? el) : el;
        const r = cible.getBoundingClientRect();
        const s = getComputedStyle(cible);
        const texte = cible.textContent.trim();
        const couleur = lire(s.color) ?? [0, 0, 0];
        const arriere = fond(cible);
        const [a, b] = [lum(couleur), lum(arriere)];
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const taille = parseFloat(s.fontSize);
        const grand = taille >= 24 || (taille >= 18.66 && Number(s.fontWeight) >= 700);
        return {
          nom: el.getAttribute('aria-label') ?? (texte === '' ? el.outerHTML.slice(0, 60) : texte),
          largeur: r.width,
          hauteur: r.height,
          aTexte: texte !== '',
          ratio,
          seuil: grand ? 3 : 4.5,
        };
      });
  });
  expect(mesures.length, `${ou} : des commandes à mesurer`).toBeGreaterThan(0);
  for (const m of mesures) {
    expect(m.largeur, `${ou} : largeur de « ${m.nom} »`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
    expect(m.hauteur, `${ou} : hauteur de « ${m.nom} »`).toBeGreaterThanOrEqual(CIBLE_MIN_PX);
    if (m.aTexte) expect(m.ratio, `${ou} : contraste de « ${m.nom} »`).toBeGreaterThanOrEqual(m.seuil);
  }
}

test('saisie terrain hors ligne : Fait, 12 kg de tomates, rechargement, annulation', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 180_000);
  const aujourdhui = jourLocal(new Date());
  const ferme = fermeDuJour(aujourdhui);
  const chou = cleTache(SERIE.chou, 'plantation');

  await test.step('amorcer la base locale avec la ferme du jour (page de diagnostic)', async () => {
    await page.goto(`/diagnostic/amorcer.html?jeu=aujourdhui&date=${aujourdhui}`);
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(ferme.utilisateurId);
    expect(a.fermeId).toBe(ferme.fermeId);
    expect(a.lignes, 'lignes insérées : exactement la ferme du jour').toBe(ferme.total);
  });

  const violations = await surveillerCsp(page);

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
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
    await expect(ecran(page)).toBeVisible();
  });

  await test.step('réouverture hors ligne, CPU ×4 : appli sous 300 ms, puis les tâches de la semaine, en retard d’abord', async () => {
    await context.setOffline(true);
    await ralentirCpu(page);
    await page.reload();
    const ms = await tempsAppPrete(page);
    console.log(`réouverture hors ligne : appli prête en ${ms.toFixed(0)} ms (budget ${String(BUDGET_MS)} ms)`);
    expect(ms).toBeLessThan(BUDGET_MS);
    await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_AUJOURDHUI_ATTENDUE, { timeout: 15_000 });
    const froid = await page.evaluate((marque) => performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN, MARQUE_AUJOURDHUI_ATTENDUE);
    // Lancement à froid : ouverture de la base comprise (Q8 : 500 ms visés ; Q19 : accepté au-delà pour l'instant, T11b).
    console.log(`lancement à froid hors ligne : tâches affichées à ${froid.toFixed(0)} ms après la navigation`);
    await expect(page.getByRole('heading', { level: 1, name: 'Aujourd’hui' })).toBeVisible();
    await expect(etatSynchro(page)).toHaveText('Hors ligne');
    await expect(taches(page)).toHaveCount(ferme.attendu.taches.length);
    expect(await taches(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-cle')))).toEqual(ferme.attendu.taches);
    await expect(ecran(page)).toContainText('En retard');
    await expect(ecran(page)).toContainText('Cette semaine');
    await expect(tache(page, chou)).toContainText('7 jours de retard');
  });

  await test.step('tap sur « Aujourd’hui » : écran affiché en moins de 300 ms (base ouverte)', async () => {
    for (const tour of ['premier retour', 'second retour']) {
      await onglet(page, 'Planches').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
      const ms = await tapJusquAAujourdhui(page);
      console.log(`Aujourd’hui, ${tour} : ${ms.toFixed(0)} ms (budget ${String(BUDGET_MS)} ms)`);
      expect(ms).toBeLessThan(BUDGET_MS);
      await expect(tache(page, chou)).toBeVisible();
    }
  });

  await test.step('fidélité à la maquette : bande orange du retard, « Fait » sur la forêt', async () => {
    await expect(tache(page, chou).getByTestId('bande-famille')).toHaveCSS('background-color', rgb(COULEURS.orange));
    const fait = tache(page, chou).getByRole('button', { name: /^Marquer fait/ });
    await expect(fait).toHaveCSS('background-color', rgb(COULEURS.foret));
    await expect(fait).toHaveCSS('color', rgb(COULEURS.surForet));
  });

  await page.setViewportSize({ width: 360, height: 780 });

  await test.step('cibles ≥ 56 px et contraste AA sur l’écran (360 px de large)', async () => {
    await verifierCommandes(page, 'écran Aujourd’hui');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  await test.step('« Fait » sur la plantation du chou, hors ligne : un geste, 1 saisie en attente', async () => {
    await tache(page, chou).getByRole('button', { name: /^Marquer fait/ }).click();
    await expect(tache(page, chou)).toHaveCount(0);
    await expect(bandeau(page)).toBeVisible();
    await expect(bandeau(page)).toContainText(/chou pointu/i);
    await expect(bandeau(page).getByRole('button', { name: 'Annuler' })).toBeVisible();
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 1 saisie en attente');
  });

  await test.step('12 kg de tomates en trois gestes : culture, pavé géant, Valider (unité kg préremplie)', async () => {
    await ecran(page).getByRole('button', { name: /^Noter une récolte/ }).click();
    const d = recolte(page);
    await expect(d).toBeVisible();
    const choix = d.getByTestId('choix-recolte');
    expect((await choix.evaluateAll((els) => els.map((e) => e.getAttribute('data-cible')))).sort()).toEqual([...ferme.attendu.recoltesEnCours].sort());
    await verifierCommandes(page, 'récolte, choix de la culture');
    await d.locator(`[data-testid="choix-recolte"][data-cible="${SERIE.tomate}"]`).click();

    const unite = d.getByRole('radiogroup', { name: 'Unité' });
    await expect(unite.getByRole('radio', { name: LIBELLES_UNITES.kg, exact: true })).toBeChecked();
    await expect(d.getByRole('button', { name: /^Valider/ })).toBeDisabled();
    await d.getByRole('button', { name: '1', exact: true }).click();
    await d.getByRole('button', { name: '2', exact: true }).click();
    await expect(d.getByTestId('quantite')).toContainText('12');

    // Pavé géant (maquette Saisie : touches en 30 px, quantité en 84 px), tout tient à 360 px.
    const tailleTouche = await d.getByRole('button', { name: '5', exact: true }).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(tailleTouche).toBeGreaterThanOrEqual(28);
    const tailleQuantite = await d.getByTestId('quantite').evaluate((e) => {
      const tailles = [e, ...e.querySelectorAll('*')].map((x) => parseFloat(getComputedStyle(x).fontSize));
      return Math.max(...tailles);
    });
    expect(tailleQuantite).toBeGreaterThanOrEqual(64);
    for (const c of ['1', '3', '7', '9', '0', 'Effacer']) {
      const b = await d.getByRole('button', { name: c, exact: true }).boundingBox();
      expect(b, c).not.toBeNull();
      expect((b?.x ?? 0) + (b?.width ?? 0), `touche « ${c} » dans l’écran`).toBeLessThanOrEqual(360);
    }
    await verifierCommandes(page, 'récolte, pavé');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await d.getByRole('button', { name: 'Valider 12 kg' }).click();
    await expect(d).toHaveCount(0);
    await expect(bandeau(page)).toContainText('12 kg');
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 2 saisies en attente');
  });

  await test.step('« Annuler » visible 10 s après la saisie, puis plus', async () => {
    const debut = Date.now();
    await expect(bandeau(page).getByRole('button', { name: 'Annuler' })).toBeVisible();
    await verifierCommandes(page, 'bandeau Annuler');
    await expect(bandeau(page)).toHaveCount(0, { timeout: ANNULATION_MS + 4_000 });
    const duree = Date.now() - debut;
    console.log(`bandeau « Annuler » disparu après ${String(duree)} ms`);
    expect(duree).toBeGreaterThanOrEqual(ANNULATION_MS - 1_500);
  });

  await test.step('rechargement toujours hors ligne : les deux saisies sont là', async () => {
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    await expect(taches(page).first()).toBeVisible();
    await expect(tache(page, chou), 'la plantation reste faite').toHaveCount(0);
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 2 saisies en attente');
    const h = await historique(page);
    await expect(h.locator('[data-testid="saisie-historique"][data-type="realise"]').filter({ hasText: /chou pointu/i })).toHaveCount(1);
    const tomates = h.locator('[data-testid="saisie-historique"][data-type="recolte"]').filter({ hasText: /tomate/i }).filter({ hasText: '12 kg' });
    await expect(tomates).toHaveCount(1);
    await verifierCommandes(page, 'historique');
  });

  await test.step('annuler la récolte depuis l’historique, hors ligne : elle disparaît, 3 saisies en attente, même après rechargement', async () => {
    const h = await historique(page);
    const tomates = () => h.locator('[data-testid="saisie-historique"][data-type="recolte"]').filter({ hasText: '12 kg' });
    await tomates().getByRole('button', { name: /^Annuler/ }).click();
    await expect(tomates()).toHaveCount(0);
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 3 saisies en attente');

    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    const apres = await historique(page);
    await expect(apres.locator('[data-testid="saisie-historique"][data-type="realise"]').filter({ hasText: /chou pointu/i })).toHaveCount(1);
    await expect(apres.locator('[data-testid="saisie-historique"][data-type="recolte"]').filter({ hasText: '12 kg' })).toHaveCount(0);
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 3 saisies en attente');
  });

  expect(await violations()).toEqual([]);
});

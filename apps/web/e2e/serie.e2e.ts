import { expect, test, type Locator, type Page } from '@playwright/test';
import { lundiDeSemaine } from '@planif/core';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { DELAI_APPUI_LONG_MS, MARQUE_SERIE_AFFICHEE_ATTENDUE } from '../src/ecrans/serie/test/contrat.ts';
import { ATTENDU, EMPLACEMENT, ESPECE, fermeSerie, ITINERAIRE, SAISON, VARIETE } from '../src/ecrans/serie/test/ferme-serie.ts';
import { decrireSerie, ralentirCpu, REPETITIONS_MESURE, repeterMesure, surveillerCsp } from './outils.ts';

/**
 * T12 — plan de culture, de bout en bout, sur le build des essais servi par `vite preview`
 * (dist-essais/), CPU ralenti ×4, réseau coupé. Contrat : src/ecrans/serie/test/contrat.ts.
 *
 * Amorçage : /diagnostic/amorcer.html?jeu=serie remplit la base locale de l'utilisateur de test
 * avec la ferme du plan (src/ecrans/serie/test/ferme-serie.ts). Mêmes garde-fous que T11 et T13.
 *
 * Critères du ticket :
 *   - formulaire affiché en moins de 300 ms (tap sur « Nouvelle série » → marque
 *     planif:serie-affichee), médiane de 5 (décision T20) ;
 *   - créer la batavia de T02 en moins de 8 gestes depuis la vue 2D (appui long sur T2-P01 en
 *     2027-S14, « bat », Batavia Grenobloise, itinéraire proposé gardé, « Récolte à partir
 *     de », S22, « Planifier la série »), dates affichées conformes à T02 ;
 *   - recalcul en moins de 100 ms après un changement de champ (semaine), médiane de 5 ;
 *   - cibles ≥ 56 px et contraste AA dans le formulaire ; à 360 px, pas de défilement horizontal ;
 *   - hors ligne : la série s'enregistre (1 saisie en attente) et reste après rechargement ;
 *     aucune violation de la CSP.
 */

const BUDGET_AFFICHAGE_MS = 300;
const BUDGET_RECALCUL_MS = 100;
const CIBLE_MIN_PX = 56;
const DELAI_AMORCAGE_MS = 60_000;
const GESTES_MAX = 7;

test.use({ actionTimeout: 15_000 });

interface Amorcage {
  readonly utilisateurId?: string;
  readonly fermeId?: string;
  readonly lignes?: number;
  readonly erreur?: string;
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const formulaire = (page: Page, nom: 'Nouvelle série' | 'Modifier la série') => page.getByRole('dialog', { name: nom });
const etatSynchro = (page: Page) => page.getByTestId('etat-synchro');
const ligne = (page: Page, emplacementId: string) => page.locator(`[data-testid="ligne-plan"][data-sorte="emplacement"][data-id="${emplacementId}"]`);

async function ouvrirPlanches2027(page: Page): Promise<void> {
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('plan-defilement')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Saison').selectOption(SAISON.s2027);
  await expect(ligne(page, EMPLACEMENT.t2p01)).toBeVisible();
}

/** Temps entre le prochain appui (pointerdown) et la marque du formulaire. */
async function tapJusquAuFormulaire(page: Page, cible: Locator): Promise<number> {
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
  }, MARQUE_SERIE_AFFICHEE_ATTENDUE);
  await cible.click();
  await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_SERIE_AFFICHEE_ATTENDUE);
  return page.evaluate((marque) => {
    const tap = (window as unknown as { __tap?: number }).__tap ?? Number.NaN;
    return (performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN) - tap;
  }, MARQUE_SERIE_AFFICHEE_ATTENDUE);
}

/** Appui long au doigt (événements tactiles de Chromium) au point (x, y). */
async function appuiLong(page: Page, x: number, y: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(DELAI_APPUI_LONG_MS + 250);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Commandes du formulaire : taille de la cible (le <label> d'un radio natif) et contraste AA. */
async function verifierCommandes(page: Page, ou: string): Promise<void> {
  const mesures = await page.evaluate(() => {
    const racine = document.querySelector('[data-testid="formulaire-serie"]');
    if (racine === null) return [];
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
    return [...racine.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], input, select')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return (r.width > 0 && r.height > 0) || (el instanceof HTMLInputElement && el.closest('label') !== null);
      })
      .map((el) => {
        const cible = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox') ? (el.closest('label') ?? el) : el;
        const r = cible.getBoundingClientRect();
        const s = getComputedStyle(cible);
        const texte = el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? '' : cible.textContent.trim();
        const couleur = lire(s.color) ?? [0, 0, 0];
        const [a, b] = [lum(couleur), lum(fond(cible))];
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const taille = parseFloat(s.fontSize);
        const grand = taille >= 24 || (taille >= 18.66 && Number(s.fontWeight) >= 700);
        return {
          nom: el.getAttribute('aria-label') ?? (texte === '' ? el.outerHTML.slice(0, 80) : texte),
          largeur: r.width,
          hauteur: r.height,
          aTexte: texte !== '' || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type !== 'radio'),
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

/** Dates affichées par le formulaire, par étape. */
async function datesAffichees(f: Locator): Promise<Record<string, string>> {
  return Object.fromEntries(
    await f.getByTestId('date-serie').evaluateAll((els) => els.map((e) => [e.getAttribute('data-etape') ?? '?', e.getAttribute('data-date') ?? ''])),
  );
}

/**
 * Pose la semaine `valeur` dans le formulaire ouvert et mesure, dans la page, le temps jusqu'à ce
 * que le début de récolte affiché vaille `attendu` (MutationObserver : pas de latence de Playwright).
 */
async function tempsRecalcul(page: Page, valeur: string, attendu: string): Promise<number> {
  return page.evaluate(
    ({ valeur, attendu }) =>
      new Promise<number>((resolve, reject) => {
        const racine = document.querySelector('[data-testid="formulaire-serie"]');
        const champ = racine === null ? null : racine.querySelector<HTMLInputElement>('input[type="week"]');
        if (racine === null || champ === null) {
          reject(new Error('formulaire ou champ « Semaine » absent'));
          return;
        }
        const lire = () => racine.querySelector('[data-testid="date-serie"][data-etape="debutRecolte"]')?.getAttribute('data-date');
        let t0 = 0;
        const observateur = new MutationObserver(() => {
          if (lire() === attendu) {
            observateur.disconnect();
            resolve(performance.now() - t0);
          }
        });
        observateur.observe(racine, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => {
          observateur.disconnect();
          reject(new Error(`pas de recalcul vers ${attendu} en 5 s`));
        }, 5_000);
        t0 = performance.now();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(champ, valeur);
        champ.dispatchEvent(new Event('input', { bubbles: true }));
        champ.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    { valeur, attendu },
  );
}

test('plan de culture hors ligne : la batavia de T02 en moins de 8 gestes, 300 ms, 100 ms', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 180_000);
  const ferme = fermeSerie();

  await test.step('amorcer la base locale avec la ferme du plan (page de diagnostic)', async () => {
    await page.goto('/diagnostic/amorcer.html?jeu=serie');
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(ferme.utilisateurId);
    expect(a.fermeId).toBe(ferme.fermeId);
    expect(a.lignes, 'lignes insérées : exactement la ferme du plan').toBe(ferme.total);
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
  });

  await test.step('réouverture hors ligne, CPU ×4 : Planches, saison 2027', async () => {
    await context.setOffline(true);
    await ralentirCpu(page);
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    await ouvrirPlanches2027(page);
    await expect(etatSynchro(page)).toHaveText('Hors ligne');
  });

  await test.step('« Nouvelle série » : formulaire affiché en moins de 300 ms, médiane de 5', async () => {
    const serie = await repeterMesure(REPETITIONS_MESURE, async () => {
      const ms = await tapJusquAuFormulaire(page, page.getByRole('button', { name: 'Nouvelle série' }));
      const f = formulaire(page, 'Nouvelle série');
      await expect(f).toBeVisible();
      await f.getByRole('button', { name: 'Fermer' }).click();
      await expect(f).toHaveCount(0);
      return ms;
    });
    console.log(decrireSerie('formulaire d’une série, tap sur « Nouvelle série »', serie, BUDGET_AFFICHAGE_MS));
    expect(serie.mediane).toBeLessThan(BUDGET_AFFICHAGE_MS);
  });

  let gestes = 0;
  const f = formulaire(page, 'Nouvelle série');

  await test.step('appui long sur la case vide T2-P01 × 2027-S14 : planche et semaine préremplies', async () => {
    const entete = page.getByTestId('semaine').filter({ hasText: /^S14$/ });
    await expect(entete).toHaveCount(1);
    await entete.evaluate((e) => {
      e.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
    const colonne = await entete.boundingBox();
    const rangee = await ligne(page, EMPLACEMENT.t2p01).boundingBox();
    expect(colonne, 'en-tête de S14').not.toBeNull();
    expect(rangee, 'ligne de T2-P01').not.toBeNull();
    if (colonne === null || rangee === null) return;
    gestes++;
    await appuiLong(page, colonne.x + colonne.width / 2, rangee.y + rangee.height / 2);
    await expect(f).toBeVisible();
    await expect(f.locator(`[data-testid="emplacement-serie"][data-emplacement="${EMPLACEMENT.t2p01}"]`)).toHaveCount(1);
    await expect(f.getByLabel('Semaine')).toHaveValue('2027-W14');
  });

  await test.step('la batavia de T02 : culture, itinéraire proposé, « récolte à partir de » S22 ; dates de T02', async () => {
    gestes++;
    await f.getByLabel('Culture').fill('bat');
    gestes++;
    await f.locator(`[data-testid="choix-culture"][data-espece="${ESPECE.batavia}"][data-variete="${VARIETE.grenobloise}"]`).click();
    await expect(f.getByLabel('Itinéraire'), 'itinéraire proposé : batavia de printemps').toHaveValue(ITINERAIRE.bataviaPrintemps);
    await expect.poll(() => datesAffichees(f)).toEqual({ ...ATTENDU.bataviaPlantationS14 });
    gestes++;
    await f.getByRole('radio', { name: 'Récolte à partir de' }).click();
    await expect(f.getByLabel('Semaine')).toHaveValue('2027-W21');
    gestes++;
    await f.getByLabel('Semaine').fill('2027-W22');
    await expect.poll(() => datesAffichees(f)).toEqual({ ...ATTENDU.bataviaRecolteS22 });
    await expect(f.getByTestId('date-serie').filter({ hasText: 'S22' })).toHaveCount(1);
  });

  await test.step('cibles ≥ 56 px et contraste AA ; à 360 px, pas de défilement horizontal', async () => {
    const vue = page.viewportSize();
    await verifierCommandes(page, 'formulaire, largeur du téléphone');
    await page.setViewportSize({ width: 360, height: 780 });
    await verifierCommandes(page, 'formulaire, 360 px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const debordement = await f.evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(debordement, 'le formulaire ne défile pas horizontalement').toBeLessThanOrEqual(0);
    if (vue !== null) await page.setViewportSize(vue);
  });

  await test.step('« Planifier la série » : moins de 8 gestes, la barre est sur le plan, 1 saisie en attente', async () => {
    gestes++;
    await f.getByRole('button', { name: 'Planifier la série' }).click();
    await expect(f).toHaveCount(0);
    console.log(`batavia de T02 planifiée en ${String(gestes)} gestes depuis la vue 2D`);
    expect(gestes).toBeLessThanOrEqual(GESTES_MAX);
    await expect(ligne(page, EMPLACEMENT.t2p01).getByTestId('barre')).toHaveCount(1);
    await expect(ligne(page, EMPLACEMENT.t2p01).getByTestId('barre')).toContainText('Batavia');
    await expect(page.getByTestId('saisie-annulable')).toContainText('Batavia');
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 1 saisie en attente');
  });

  await test.step('recalcul en moins de 100 ms après un changement de semaine, médiane de 5', async () => {
    await ligne(page, EMPLACEMENT.t2p01).getByTestId('barre').click();
    await page.getByRole('dialog', { name: 'Détail de la série' }).getByRole('button', { name: 'Modifier la série' }).click();
    const m = formulaire(page, 'Modifier la série');
    await expect(m).toBeVisible();
    await expect(m.getByLabel('Semaine')).toHaveValue('2027-W22');
    const semaines = [23, 24, 25, 26, 27];
    const serie = await repeterMesure(REPETITIONS_MESURE, async (i) => {
      const s = semaines[i] ?? 23;
      return tempsRecalcul(page, `2027-W${String(s)}`, lundiDeSemaine(2027, s));
    });
    console.log(decrireSerie('recalcul du formulaire (semaine changée)', serie, BUDGET_RECALCUL_MS));
    expect(serie.mediane).toBeLessThan(BUDGET_RECALCUL_MS);
    await m.getByRole('button', { name: 'Fermer' }).click();
    await expect(m).toHaveCount(0);
    await expect(etatSynchro(page), 'fermer sans enregistrer n’écrit rien').toHaveText('Hors ligne · 1 saisie en attente');
  });

  await test.step('rechargement toujours hors ligne : la série est là', async () => {
    await page.reload();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    await ouvrirPlanches2027(page);
    await expect(ligne(page, EMPLACEMENT.t2p01).getByTestId('barre')).toHaveCount(1);
    await expect(etatSynchro(page)).toHaveText('Hors ligne · 1 saisie en attente');
  });

  expect(await violations()).toEqual([]);
});

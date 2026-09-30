import { expect, test, type Page } from '@playwright/test';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import { LIBELLES_COURTS_ATTENDUS, type LigneEmplacementPlan, type ModuleCalculsPlan, type Plan } from '../src/ecrans/plan/test/contrat.ts';
import { COULEURS, FAMILLES } from '../src/ui/jetons.ts';
import { decrireSerie, ralentirCpu, repeterMesures, REPETITIONS_MESURE, surveillerCsp, tempsAppPrete } from './outils.ts';

/**
 * T11 — vue 2D planches × semaines, de bout en bout, sur le build de production servi par
 * `vite preview`, avec la ferme de T07 (400 emplacements, 3 000 occupations) dans la base
 * locale de l'appli, hors ligne, CPU ralenti ×4. Contrat de l'écran : src/ecrans/plan/test/contrat.ts.
 *
 * ── Amorçage de la base locale sans serveur ─────────────────────────────────────────────────
 * Page `/diagnostic/amorcer.html` (même régime que /diagnostic/synchro.html : entrée à part du
 * build, hors navigation, hors service worker et hors précache, jamais liée depuis l'appli, CSP
 * de l'appli). Elle :
 *   - ouvre, avec PowerSync, la base locale de l'utilisateur du jeu de T07 (utilisateurId de
 *     remplirJeuT07 : un identifiant de test, jamais un vrai compte) : même nom de fichier que
 *     l'appli (nomBaseLocale), même schéma (SCHEMA_LOCAL), même stockage ; sans jamais appeler
 *     connect() ;
 *   - la remplit par remplirJeuT07(base) (packages/sync/src/test/jeu-t07.ts, graine 7 par
 *     défaut : les mêmes identifiants que ce test recalcule sous Node) ; si la base contient
 *     déjà la ferme du jeu, ne réécrit rien ;
 *   - vide la file d'envoi (ps_crud) : rien de ce jeu ne partira jamais vers un serveur, et
 *     l'appli n'affiche pas de saisies en attente ;
 *   - titre exact « Amorçage de la base locale (tests) » ;
 *   - ferme la base, puis pose window.__amorcage = { utilisateurId, fermeId, lignes } (lignes :
 *     total inséré) ou { erreur: string }.
 * Le test range ensuite une session (jetons factices) de cet utilisateur dans localStorage.
 * Si le chef préfère sortir cette page du build de production, un build dédié aux tests suffit :
 * le test ne dépend que de l'URL.
 *
 * ── Appli ────────────────────────────────────────────────────────────────────────────────────
 *   - connecté, l'appli ouvre la base locale (chargée à la demande, depuis le cache hors ligne :
 *     PowerSync, ses workers et son WASM doivent donc être servis par le service worker) et
 *     choisit la ferme active (src/donnees/ferme-active.ts) ; data-testid="app" porte
 *     data-base="ouverture|sans-ferme|prete|echec" ;
 *   - indicateur data-testid="etat-synchro" (role="status") dans la coquille, sur chaque onglet :
 *     ici « Hors ligne » (libelleSynchro, src/donnees/ferme-active.test.ts) ;
 *   - onglet « Planches » : l'écran de la vue 2D (h1 « Planches »).
 *
 * ── Ce que mesure ce test (CPU ×4, hors ligne, appli servie par le service worker) ──────────
 *   1. réouverture hors ligne sous 300 ms (marque app-prete) malgré l'ouverture de la base ;
 *   2. tap sur « Planches » → marque 'planif:plan-affiche' en moins de 300 ms (base déjà ouverte
 *      au démarrage), puis de nouveau après un aller-retour par « Ferme » ;
 *      (T20) 1 et 2 répétés 5 fois (rechargement hors ligne, 1re répétition à froid) : la médiane de
 *      chaque temps est comparée au budget ; le journal donne les 5 valeurs ;
 *   3. un conflit du jeu (le premier du plan, recalculé sous Node par calculs.ts) est visible
 *      sur sa ligne et nommé (libellé court de sa sorte, relecture C1) ; sa barre a la bordure
 *      --couleur-conflit ; le toucher ouvre le détail qui le nomme (nom long) ;
 *   4. réel plein (fond = bande de la famille), prévu hachuré (repeating-linear-gradient) ;
 *   5. semaine courante marquée et visible à l'ouverture (si aujourd'hui est dans la saison) ;
 *   6. changement de saison sans rechargement ;
 *   7. défilement de haut en bas à ~40 px par image : aucun intervalle entre deux images
 *      (requestAnimationFrame) au-delà de 50 ms, jamais 60 lignes ou plus dans le DOM, la
 *      dernière ligne atteinte ;
 *   8. à 360 px de large : pas de défilement horizontal de la page, plan et barre de navigation
 *      visibles ; aucune violation de la CSP.
 */

const BUDGET_MS = 300;
const IMAGE_MAX_MS = 50;
const MARQUE_PLAN = 'planif:plan-affiche';
/** Remplir la base PowerSync (≈ 42 000 lignes, jeu de T07) prend quelques secondes sans ralentissement. */
const DELAI_AMORCAGE_MS = 120_000;

/** Chemin tenu dans une variable : le typage ne dépend pas du module pas encore écrit. */
const CHEMIN_CALCULS = '../src/ecrans/plan/calculs.ts';

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

/** Le plan attendu, recalculé sous Node sur le même jeu (graine 7) par les calculs de l'écran. */
async function planAttendu(): Promise<{ plan: Plan; calculs: ModuleCalculsPlan; utilisateurId: string; fermeId: string; lignes: number }> {
  const calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    const aujourdhui = jourLocal(new Date());
    const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, jeu.principale.fermeId), aujourdhui);
    if (saison === null) throw new Error('jeu de T07 sans saison');
    const plan = await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison, aujourdhui });
    // Total inséré par remplirJeuT07 : la page d'amorçage doit annoncer exactement ce nombre.
    const lignes = Object.values(jeu.lignes).reduce((total, n) => total + n, 0);
    return { plan, calculs, utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId, lignes };
  } finally {
    base.fermer();
  }
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const defilement = (page: Page) => page.getByTestId('plan-defilement');

/** Temps entre le prochain appui (pointerdown) et la marque de l'écran Planches. */
async function tapJusquAuPlan(page: Page, libelle: string): Promise<number> {
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
  }, MARQUE_PLAN);
  await onglet(page, libelle).click();
  await page.waitForFunction((marque) => performance.getEntriesByName(marque, 'mark').length > 0, MARQUE_PLAN);
  return page.evaluate((marque) => {
    const tap = (window as unknown as { __tap?: number }).__tap ?? Number.NaN;
    return (performance.getEntriesByName(marque, 'mark')[0]?.startTime ?? Number.NaN) - tap;
  }, MARQUE_PLAN);
}

test('plan des planches : ferme de T07, hors ligne, CPU ×4', async ({ page, context }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
  const attendu = await planAttendu();
  const { plan, calculs } = attendu;
  const H = calculs.HAUTEUR_LIGNE_PX;

  await test.step('amorcer la base locale (page de diagnostic)', async () => {
    await page.goto('/diagnostic/amorcer.html');
    // Échec rapide si la page n'existe pas (vite preview sert alors l'appli).
    await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
    const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, {
      timeout: DELAI_AMORCAGE_MS,
    });
    const a = (await poignee.jsonValue()) as Amorcage;
    expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
    expect(a.utilisateurId).toBe(attendu.utilisateurId);
    expect(a.fermeId).toBe(attendu.fermeId);
    expect(attendu.lignes, 'le jeu de T07 insère des lignes').toBeGreaterThan(0);
    expect(a.lignes, 'lignes insérées : exactement le jeu de T07').toBe(attendu.lignes);
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
        JSON.stringify({ utilisateurId: attendu.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) }),
      ] as const,
    );
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(navigation(page)).toBeVisible();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  });

  await test.step('réouverture hors ligne puis tap sur « Planches », CPU ×4, 5 fois : médianes sous 300 ms', async () => {
    await context.setOffline(true);
    await ralentirCpu(page);
    // T20 : 5 répétitions, médiane comparée au budget (inchangé). Chaque répétition part d'un
    // rechargement hors ligne (appli servie par le service worker), base locale rouverte (worker
    // dédié, recréé à chaque page), écran Aujourd'hui, module Planches pas encore chargé dans la
    // page. La 1re suit l'installation, caches froids, et est comptée exprès (voir outils.ts).
    const series = await repeterMesures(REPETITIONS_MESURE, async () => {
      await page.reload();
      const reouverture = await tempsAppPrete(page);
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), 'servie par le service worker').toBe(true);
      await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
      const base = await page.evaluate(() => performance.now());
      console.log(`base locale prête vers ${base.toFixed(0)} ms après la navigation`);
      const etat = page.getByTestId('etat-synchro');
      await expect(etat).toBeVisible();
      await expect(etat).toHaveText('Hors ligne');
      await expect(etat).toHaveAttribute('role', 'status');

      await expect(page.getByRole('heading', { level: 1, name: 'Planches' }), 'la répétition part d’Aujourd’hui').toHaveCount(0);
      const planches = await tapJusquAuPlan(page, 'Planches');
      await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
      await expect(page.getByTestId('barre').first()).toBeVisible();
      await expect(page.getByTestId('etat-synchro')).toHaveText('Hors ligne');

      await onglet(page, 'Ferme').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Ferme' })).toBeVisible();
      const retour = await tapJusquAuPlan(page, 'Planches');
      return { reouverture, planches, retour };
    });
    console.log(decrireSerie('réouverture hors ligne, base locale remplie', series.reouverture, BUDGET_MS));
    console.log(decrireSerie('Planches, premier affichage', series.planches, BUDGET_MS));
    console.log(decrireSerie('Planches, retour', series.retour, BUDGET_MS));
    expect(series.reouverture.mediane, 'réouverture hors ligne (médiane)').toBeLessThan(BUDGET_MS);
    expect(series.planches.mediane, 'Planches, premier affichage (médiane)').toBeLessThan(BUDGET_MS);
    expect(series.retour.mediane, 'Planches, retour (médiane)').toBeLessThan(BUDGET_MS);
    await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
  });

  await test.step('semaine courante marquée et visible à l’ouverture', async () => {
    const reperes = page.getByTestId('semaine-courante');
    if (plan.semaineCourante === null) {
      await expect(reperes).toHaveCount(0);
      return;
    }
    await expect(reperes).toHaveCount(1);
    await expect(page.locator('[data-testid="semaine"][data-courante="oui"]')).toHaveText(plan.semaines[plan.semaineCourante]?.libelle ?? '');
    const repere = await reperes.boundingBox();
    const vue = await defilement(page).boundingBox();
    expect(repere).not.toBeNull();
    expect(vue).not.toBeNull();
    if (repere === null || vue === null) return;
    expect(repere.x, 'repère dans la vue (gauche)').toBeGreaterThanOrEqual(vue.x);
    expect(repere.x + repere.width, 'repère dans la vue (droite)').toBeLessThanOrEqual(vue.x + vue.width);
  });

  await test.step('un conflit du jeu, visible et nommé ; détail en lecture seule', async () => {
    const index = plan.lignes.findIndex((l) => l.sorte === 'emplacement' && l.conflits.length > 0);
    expect(index, 'le jeu de T07 a un conflit dans la saison affichée').toBeGreaterThanOrEqual(0);
    const ligne = plan.lignes[index] as LigneEmplacementPlan;
    await defilement(page).evaluate((el, y) => {
      el.scrollTop = y;
    }, Math.max(0, index - 2) * H);
    const el = page.locator(`[data-testid="ligne-plan"][data-id="${ligne.id}"]`);
    await expect(el).toHaveCount(1);
    await el.scrollIntoViewIfNeeded();
    await expect(el).toHaveAttribute('data-conflit', 'oui');
    // Relecture C1 : libellé court de la sorte du premier conflit ; le nom long (cultures en
    // cause) est dans le détail de la barre et dans celui de l'étiquette (plan-relecture.e2e.ts).
    const nom = el.getByTestId('conflit').first();
    await expect(nom).toBeVisible();
    const premier = ligne.conflits[0]?.nom ?? '';
    const sorte = ligne.conflits[0]?.sorte;
    expect(sorte).toBeDefined();
    await expect(nom).toHaveText(sorte === undefined ? '' : LIBELLES_COURTS_ATTENDUS[sorte]);
    const conflit = rgb((COULEURS as Readonly<Record<string, string>>).conflit ?? '#000000');
    expect(await nom.evaluate((e) => getComputedStyle(e).color)).toBe(conflit);

    const cible = ligne.barres.find((b) => b.enConflit);
    expect(cible).toBeDefined();
    const barre = el.locator(`[data-testid="barre"][data-occupation="${cible?.occupationId ?? ''}"]`);
    await expect(barre).toBeVisible();
    const bordure = await barre.evaluate((e) => {
      const s = getComputedStyle(e);
      return { couleur: s.borderTopColor, largeur: parseFloat(s.borderTopWidth) };
    });
    expect(bordure.couleur).toBe(conflit);
    expect(bordure.largeur).toBeGreaterThanOrEqual(2);

    await barre.click();
    const detail = page.getByRole('dialog', { name: 'Détail de la série' });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(cible?.libelle ?? '');
    await expect(detail).toContainText(ligne.code);
    await expect(detail).toContainText(premier);
    const fermer = detail.getByRole('button', { name: 'Fermer' });
    const boite = await fermer.boundingBox();
    expect(boite?.height ?? 0).toBeGreaterThanOrEqual(48);
    await fermer.click();
    await expect(detail).toHaveCount(0);
  });

  await test.step('réel plein, prévu hachuré, couleur de la famille', async () => {
    const barres = await page.getByTestId('barre').evaluateAll((els) =>
      els.map((e) => {
        const s = getComputedStyle(e);
        return { etat: e.getAttribute('data-etat'), famille: e.getAttribute('data-famille') ?? '', fond: s.backgroundColor, image: s.backgroundImage };
      }),
    );
    const reelles = barres.filter((b) => b.etat === 'reel' && b.famille !== '');
    const prevues = barres.filter((b) => b.etat === 'prevu');
    expect(reelles.length, 'barres réelles d’une famille attitrée à l’écran').toBeGreaterThan(0);
    expect(prevues.length, 'barres prévues à l’écran').toBeGreaterThan(0);
    const bandes = FAMILLES as Readonly<Record<string, { readonly bande: string }>>;
    for (const b of reelles) {
      expect(b.image, 'réel : plein').toBe('none');
      expect(b.fond).toBe(rgb(bandes[b.famille]?.bande ?? '#000000'));
    }
    for (const b of prevues) expect(b.image, 'prévu : hachuré').toContain('repeating-linear-gradient');
  });

  await test.step('changement de saison sans rechargement', async () => {
    await page.evaluate(() => {
      (window as unknown as { __memePage?: boolean }).__memePage = true;
    });
    const choix = page.getByLabel('Saison', { exact: true });
    const avant = await page.getByTestId('barre').first().getAttribute('data-occupation');
    await choix.selectOption({ label: '2024' });
    await expect(page.getByTestId('barre').first()).not.toHaveAttribute('data-occupation', avant ?? '');
    expect(await page.evaluate(() => (window as unknown as { __memePage?: boolean }).__memePage)).toBe(true);
    await choix.selectOption({ label: plan.saison.nom });
    await expect(page.getByTestId('barre').first()).toBeVisible();
  });

  await test.step('défilement de haut en bas : aucune image au-delà de 50 ms, < 60 lignes dans le DOM', async () => {
    await defilement(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(200);
    const mesure = await defilement(page).evaluate(
      (el, pas) =>
        new Promise<{ pireMs: number; images: number; lignesMax: number; bas: boolean; derniere: string | null }>((fini) => {
          const intervalles: number[] = [];
          let lignesMax = 0;
          let precedent = -1;
          const image = (t: number) => {
            if (precedent >= 0) intervalles.push(t - precedent);
            precedent = t;
            lignesMax = Math.max(lignesMax, el.querySelectorAll('[data-testid="ligne-plan"]').length);
            const max = el.scrollHeight - el.clientHeight;
            if (el.scrollTop >= max - 1) {
              requestAnimationFrame(() => {
                const lignes = el.querySelectorAll('[data-testid="ligne-plan"]');
                fini({
                  // Les deux premiers intervalles comptent le démarrage de la mesure, pas le défilement.
                  pireMs: Math.max(0, ...intervalles.slice(2)),
                  images: intervalles.length,
                  lignesMax,
                  bas: true,
                  derniere: lignes[lignes.length - 1]?.getAttribute('data-id') ?? null,
                });
              });
              return;
            }
            el.scrollTop = Math.min(max, el.scrollTop + pas);
            requestAnimationFrame(image);
          };
          requestAnimationFrame(image);
        }),
      40,
    );
    console.log(`défilement : ${String(mesure.images)} images, pire intervalle ${mesure.pireMs.toFixed(1)} ms (limite ${String(IMAGE_MAX_MS)} ms), ${String(mesure.lignesMax)} lignes au plus dans le DOM`);
    expect(mesure.bas).toBe(true);
    expect(mesure.images).toBeGreaterThan((plan.lignes.length * H) / 40 / 2);
    expect(mesure.pireMs).toBeLessThanOrEqual(IMAGE_MAX_MS);
    expect(mesure.lignesMax).toBeLessThan(60);
    expect(mesure.derniere).toBe(plan.lignes.at(-1)?.id ?? '');
  });

  await test.step('à 360 px de large : pas de défilement horizontal, plan et navigation visibles', async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    await defilement(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(defilement(page)).toBeVisible();
    await expect(page.getByTestId('barre').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const vue = await defilement(page).boundingBox();
    expect((vue?.x ?? 0) + (vue?.width ?? 0)).toBeLessThanOrEqual(360);
    for (const libelle of ['Planches', 'Ferme']) {
      const b = await onglet(page, libelle).boundingBox();
      expect(b, libelle).not.toBeNull();
      expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(360);
    }
    await expect(page.getByTestId('etat-synchro')).toBeVisible();
  });

  expect(await violations()).toEqual([]);
});

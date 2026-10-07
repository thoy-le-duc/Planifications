import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import type { ModuleCalculsPlan } from '../src/ecrans/plan/test/contrat.ts';
import { MARQUES_3D, TESTID_3D, type ModuleScene, type Plan3d } from '../src/ecrans/plan3d/test/contrat.ts';
import { MARQUES_3D_FILTRES, TESTID_3D_FILTRES as T, type DimensionFiltre, type FiltresScene, type ModuleFiltres } from '../src/ecrans/plan3d/test/contrat-filtres.ts';
import { decrireSerie, repeterMesures, REPETITIONS_MESURE, surveillerCsp } from './outils.ts';

/**
 * T27b — vue 3D : filtres et légende, de bout en bout, sur ordinateur (Chromium 1280 × 800, WebGL
 * logiciel), avec la grande ferme de T07 (400 emplacements). Contrat du DOM et des marques :
 * src/ecrans/plan3d/test/contrat-filtres.ts. Les mesures de T27 (ouverture, changement de semaine,
 * navigation) restent celles de vue-3d.e2e.ts, qui ne change pas et doit rester vert.
 *
 * ── Ce que vérifie ce test ───────────────────────────────────────────────────────────────────
 *   1. la légende et les filtres sont dans un panneau À CÔTÉ de la scène : aucune légende ne
 *      recouvre un pixel de la scène (boîtes disjointes) ;
 *   2. la légende liste les familles présentes la semaine affichée, toutes cochées au départ ;
 *   3. cocher / décocher une famille change les couleurs en moins de 100 ms (médiane de 5, aucune
 *      au-delà de 150 ms), sans reconstruire la géométrie, et l'état estompé suit exactement
 *      `appliquerFiltres` (scene.ts) pour la même semaine ;
 *   4. « tout » / « rien », filtres par culture et par zone, et leur combinaison ;
 *   5. l'alternative texte garde toutes les planches et marque les estompées ;
 *   6. l'état est local : retour au plan puis nouvelle ouverture → tout est coché.
 */

const CHEMIN_CALCULS = '../src/ecrans/plan/calculs.ts';
const CHEMIN_SCENE = '../src/ecrans/plan3d/scene.ts';
const DELAI_AMORCAGE_MS = 120_000;
const BUDGET_FILTRE_MS = 100;
const FACTEUR_MAXIMUM = 1.5;

const executablePath = process.env.CHROMIUM_PATH;

test.use({
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
});

function jourLocal(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

interface Attendu {
  readonly plan: Plan3d;
  readonly m: ModuleScene & ModuleFiltres;
  readonly utilisateurId: string;
  readonly fermeId: string;
}

async function planAttendu(): Promise<Attendu> {
  const calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  const m = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleScene & ModuleFiltres;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    const aujourdhui = jourLocal(new Date());
    const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, jeu.principale.fermeId), aujourdhui);
    if (saison === null) throw new Error('jeu de T07 sans saison');
    const plan = (await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison, aujourdhui })) as unknown as Plan3d;
    return { plan, m, utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId };
  } finally {
    base.fermer();
  }
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const vue = (page: Page) => page.getByTestId(TESTID_3D.vue);
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
const panneau = (page: Page) => page.getByTestId(T.panneau);
const cases = (page: Page, testid: string) => page.getByTestId(testid);
const caseDe = (page: Page, testid: string, valeur: string): Locator => page.locator(`[data-testid="${testid}"][data-valeur="${valeur.replace(/"/g, '\\"')}"]`);
const boutonTout = (page: Page, dimension: DimensionFiltre) => page.locator(`[data-testid="${T.tout}"][data-dimension="${dimension}"]`);
const boutonRien = (page: Page, dimension: DimensionFiltre) => page.locator(`[data-testid="${T.rien}"][data-dimension="${dimension}"]`);

async function ouvrirPlanches(page: Page, attendu: Attendu): Promise<void> {
  await page.goto('/diagnostic/amorcer.html');
  await expect(page).toHaveTitle('Amorçage de la base locale (tests)');
  const poignee = await page.waitForFunction(() => (window as unknown as { __amorcage?: unknown }).__amorcage, undefined, { timeout: DELAI_AMORCAGE_MS });
  const a = (await poignee.jsonValue()) as { erreur?: string; fermeId?: string };
  expect(a.erreur, 'la page d’amorçage a signalé une erreur').toBeUndefined();
  expect(a.fermeId).toBe(attendu.fermeId);

  await page.goto('/');
  await page.evaluate(
    ([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    },
    [CLE_SESSION, JSON.stringify({ utilisateurId: attendu.utilisateurId, email: 'theophane@ferme.fr', jetonAcces: 'aaa.bbb.ccc', jetonRenouvellement: 'r'.repeat(43) })] as const,
  );
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  await onglet(page, 'Planches').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
  await expect(page.getByTestId('barre').first()).toBeVisible();
}

async function ouvrirEn3d(page: Page, nbPlanches: number): Promise<void> {
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: 30_000 });
  await expect(toile(page)).toHaveAttribute('data-volumes', String(nbPlanches));
}

const nombreAttr = async (l: Locator, nom: string): Promise<number> => Number(await l.getAttribute(nom));

/** Planches estompées selon la vue : ids, dans l'ordre de la liste texte. */
async function estompeesDansLaListe(page: Page): Promise<{ tous: string[]; estompes: string[] }> {
  const lignes = await page.getByTestId(TESTID_3D.elementListe).evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-id') ?? '', estompe: e.getAttribute('data-estompe') ?? '' })));
  for (const l of lignes) expect(['oui', 'non'], `data-estompe de ${l.id}`).toContain(l.estompe);
  return { tous: lignes.map((l) => l.id), estompes: lignes.filter((l) => l.estompe === 'oui').map((l) => l.id) };
}

/** Clique `cible` et renvoie le temps (ms) entre le clic et la marque « image dessinée avec les nouveaux filtres ». */
async function cliquerEtMesurer(page: Page, cible: Locator): Promise<{ ms: number; estompes: number }> {
  await page.evaluate((marque) => {
    performance.clearMarks(marque);
    const f = window as unknown as { __clic?: number };
    delete f.__clic;
    document.addEventListener(
      'click',
      (e) => {
        f.__clic = e.timeStamp;
      },
      { capture: true, once: true },
    );
  }, MARQUES_3D_FILTRES.filtre);
  await cible.click();
  await page.waitForFunction((m) => performance.getEntriesByName(m, 'mark').length > 0, MARQUES_3D_FILTRES.filtre, { timeout: 10_000 });
  return page.evaluate((marque) => {
    const clic = (window as unknown as { __clic?: number }).__clic ?? Number.NaN;
    const m = performance.getEntriesByName(marque, 'mark').at(-1) as PerformanceMark | undefined;
    const detail = m?.detail as { estompes?: number } | null | undefined;
    return { ms: (m?.startTime ?? Number.NaN) - clic, estompes: detail?.estompes ?? -1 };
  }, MARQUES_3D_FILTRES.filtre);
}

function boitesDisjointes(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  const e = 0.5;
  return a.x + a.width <= b.x + e || b.x + b.width <= a.x + e || a.y + a.height <= b.y + e || b.y + b.height <= a.y + e;
}

test('vue 3D : filtres et légende, grande ferme de T07, ordinateur', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 240_000);
  const attendu = await planAttendu();
  const { plan, m } = attendu;
  const nbPlanches = plan.lignes.filter((l) => l.sorte === 'emplacement').length;
  expect(nbPlanches, 'grande ferme').toBeGreaterThanOrEqual(400);
  const semaine = plan.semaineCourante ?? 0;
  const scene = m.versScene(plan, semaine);
  const options = m.optionsFiltres(scene);
  expect(options.familles.length, 'la grande ferme a au moins 3 familles cette semaine').toBeGreaterThanOrEqual(3);
  expect(options.zones.length, 'et au moins 2 zones').toBeGreaterThanOrEqual(2);
  const violations = await surveillerCsp(page);

  await ouvrirPlanches(page, attendu);
  await ouvrirEn3d(page, nbPlanches);
  await expect(vue(page)).toHaveAttribute('data-semaine', String(semaine));

  /** Filtres tels que l'écran doit les avoir, tenus ici avec les fonctions pures du module. */
  let filtres: FiltresScene = m.FILTRES_TOUT;

  /** Compare l'écran à `appliquerFiltres(scene, filtres)`. */
  async function verifierEtat(contexte: string): Promise<void> {
    const attendue = m.appliquerFiltres(scene, filtres);
    const idsEstompes = attendue.volumes.filter((v) => v.estompe).map((v) => v.id);
    await expect(toile(page), `${contexte} : data-estompes`).toHaveAttribute('data-estompes', String(idsEstompes.length));
    await expect(toile(page), `${contexte} : data-volumes`).toHaveAttribute('data-volumes', String(nbPlanches));
    const liste = await estompeesDansLaListe(page);
    expect(liste.tous, `${contexte} : la liste garde toutes les planches, dans l’ordre du plan`).toEqual(attendue.volumes.map((v) => v.id));
    expect(liste.estompes, `${contexte} : planches estompées`).toEqual(idsEstompes);
  }

  await test.step('le panneau est à côté de la scène : la légende ne recouvre aucun pixel de la scène', async () => {
    await expect(panneau(page)).toBeVisible();
    const legende = page.getByTestId(T.legende);
    await expect(legende).toBeVisible();
    const [bp, bt, bl] = [await panneau(page).boundingBox(), await toile(page).boundingBox(), await legende.boundingBox()];
    if (bp === null || bt === null || bl === null) throw new Error('boîtes introuvables');
    expect(boitesDisjointes(bp, bt), `panneau ${JSON.stringify(bp)} et scène ${JSON.stringify(bt)} se recouvrent`).toBe(true);
    expect(boitesDisjointes(bl, bt), `légende ${JSON.stringify(bl)} et scène ${JSON.stringify(bt)} se recouvrent`).toBe(true);
    // La légende est bien dans le panneau, et le panneau dans la fenêtre.
    expect(bl.x).toBeGreaterThanOrEqual(bp.x - 0.5);
    expect(bl.x + bl.width).toBeLessThanOrEqual(bp.x + bp.width + 0.5);
    expect(bp.x + bp.width).toBeLessThanOrEqual(1280 + 0.5);
    // Chaque case de famille est elle aussi hors de la scène.
    for (const c of await cases(page, T.famille).all()) {
      const b = await c.boundingBox();
      if (b !== null) expect(boitesDisjointes(b, bt), 'case de famille sur la scène').toBe(true);
    }
    // La scène reste assez grande pour servir (pas écrasée par le panneau).
    expect(bt.width, 'largeur de la scène').toBeGreaterThan(600);
    expect(bt.height, 'hauteur de la scène').toBeGreaterThan(300);
  });

  await test.step('la légende liste les familles présentes cette semaine, toutes cochées', async () => {
    const familles = await cases(page, T.famille).evaluateAll((els) => els.map((e) => ({ valeur: e.getAttribute('data-valeur') ?? '', type: e.getAttribute('type'), coche: (e as HTMLInputElement).checked })));
    expect(familles.map((f) => f.valeur), 'familles de la légende, ordre canonique').toEqual(options.familles);
    for (const f of familles) {
      expect(f.type).toBe('checkbox');
      expect(f.coche, `${f.valeur} cochée au départ`).toBe(true);
    }
    expect(await cases(page, T.zone).count(), 'une case par zone').toBe(options.zones.length);
    expect(await cases(page, T.culture).count(), 'une case par culture de la semaine').toBe(options.cultures.length);
    for (const dim of ['familles', 'cultures', 'zones'] as const) {
      await expect(boutonTout(page, dim)).toHaveCount(1);
      await expect(boutonRien(page, dim)).toHaveCount(1);
    }
    await verifierEtat('départ');
    expect(await nombreAttr(toile(page), 'data-estompes')).toBe(0);
  });

  await test.step('décocher / cocher une famille : image dessinée en moins de 100 ms (médiane de 5, max 150 ms), géométrie intacte', async () => {
    const geometries = await nombreAttr(toile(page), 'data-geometries');
    expect(geometries, 'la géométrie a été construite au moins une fois').toBeGreaterThanOrEqual(1);
    const famille = options.familles[0] ?? '';
    const caseFamille = caseDe(page, T.famille, famille);
    const series = await repeterMesures(REPETITIONS_MESURE, async (i) => {
      // Décocher aux répétitions paires, recocher aux impaires.
      const { ms, estompes } = await cliquerEtMesurer(page, caseFamille);
      filtres = m.basculerFiltre(filtres, 'familles', famille, options.familles);
      const attendue = m.appliquerFiltres(scene, filtres).volumes.filter((v) => v.estompe).length;
      expect(estompes, `répétition ${String(i + 1)} : la marque nomme le nombre de planches estompées`).toBe(attendue);
      await verifierEtat(`répétition ${String(i + 1)}`);
      return { filtre: ms };
    });
    console.log(decrireSerie('vue 3D, changement de filtre', series.filtre, BUDGET_FILTRE_MS));
    expect(series.filtre.mediane, 'changement de filtre (médiane)').toBeLessThan(BUDGET_FILTRE_MS);
    expect(Math.max(...series.filtre.valeurs), 'changement de filtre (plus haute valeur)').toBeLessThan(BUDGET_FILTRE_MS * FACTEUR_MAXIMUM);
    // 5 bascules depuis « tout » : la famille est décochée, donc des planches sont estompées.
    expect(await caseFamille.isChecked()).toBe(false);
    expect(await nombreAttr(toile(page), 'data-estompes'), 'décocher une famille estompe ses planches').toBeGreaterThan(0);
    expect(await nombreAttr(toile(page), 'data-estompes'), 'mais pas toutes').toBeLessThan(nbPlanches);
    expect(await nombreAttr(toile(page), 'data-geometries'), 'changer un filtre ne reconstruit pas la géométrie').toBe(geometries);
    await caseFamille.click();
    filtres = m.basculerFiltre(filtres, 'familles', famille, options.familles);
    expect(filtres).toEqual(m.FILTRES_TOUT);
    await verifierEtat('famille recochée');
    expect(await nombreAttr(toile(page), 'data-geometries')).toBe(geometries);
  });

  await test.step('« rien » estompe tout, « tout » rend tout, par dimension', async () => {
    const geometries = await nombreAttr(toile(page), 'data-geometries');
    await boutonRien(page, 'familles').click();
    filtres = m.cocherRien(filtres, 'familles');
    await verifierEtat('familles : rien');
    expect(await nombreAttr(toile(page), 'data-estompes')).toBe(nbPlanches);
    for (const c of await cases(page, T.famille).all()) await expect(c).not.toBeChecked();
    await boutonTout(page, 'familles').click();
    filtres = m.cocherTout(filtres, 'familles');
    await verifierEtat('familles : tout');
    expect(await nombreAttr(toile(page), 'data-estompes')).toBe(0);
    for (const c of await cases(page, T.famille).all()) await expect(c).toBeChecked();

    await boutonRien(page, 'zones').click();
    filtres = m.cocherRien(filtres, 'zones');
    await verifierEtat('zones : rien');
    expect(await nombreAttr(toile(page), 'data-estompes')).toBe(nbPlanches);
    await boutonTout(page, 'zones').click();
    filtres = m.cocherTout(filtres, 'zones');
    await verifierEtat('zones : tout');
    expect(await nombreAttr(toile(page), 'data-geometries')).toBe(geometries);
  });

  await test.step('filtre par zone, par culture, et leur combinaison avec une famille', async () => {
    const geometries = await nombreAttr(toile(page), 'data-geometries');
    const zone = options.zones[0]?.id ?? '';
    await caseDe(page, T.zone, zone).click();
    filtres = m.basculerFiltre(filtres, 'zones', zone, options.zones.map((z) => z.id));
    await verifierEtat('zone décochée');
    expect(await nombreAttr(toile(page), 'data-estompes'), 'décocher une zone estompe ses planches').toBeGreaterThan(0);

    const culture = options.cultures[0] ?? '';
    await caseDe(page, T.culture, culture).click();
    filtres = m.basculerFiltre(filtres, 'cultures', culture, options.cultures);
    await verifierEtat('zone + culture décochées');

    const famille = options.familles[options.familles.length - 1] ?? '';
    await caseDe(page, T.famille, famille).click();
    filtres = m.basculerFiltre(filtres, 'familles', famille, options.familles);
    await verifierEtat('zone + culture + famille décochées');

    // Rien que la dernière culture de la liste cochée : tout le reste est estompé.
    await boutonRien(page, 'cultures').click();
    filtres = m.cocherRien(filtres, 'cultures');
    await verifierEtat('cultures : rien');
    expect(await nombreAttr(toile(page), 'data-estompes')).toBe(nbPlanches);
    expect(await nombreAttr(toile(page), 'data-geometries'), 'aucune reconstruction pendant toute la série de filtres').toBe(geometries);
    expect(await nombreAttr(toile(page), 'data-volumes'), 'estompé, pas retiré').toBe(nbPlanches);
  });

  await test.step('la légende suit la semaine : seulement les familles présentes', async () => {
    // Remet tout, puis va à une autre semaine : la légende et les cases suivent la scène de versScene.
    for (const dim of ['familles', 'cultures', 'zones'] as const) await boutonTout(page, dim).click();
    filtres = m.FILTRES_TOUT;
    const autre = semaine === 0 ? Math.min(plan.semaines.length - 1, 20) : 0;
    await page.getByTestId(TESTID_3D.curseur).fill(String(autre));
    await expect(vue(page)).toHaveAttribute('data-semaine', String(autre));
    const sceneAutre = m.versScene(plan, autre);
    const optionsAutre = m.optionsFiltres(sceneAutre);
    const valeurs = await cases(page, T.famille).evaluateAll((els) => els.map((e) => e.getAttribute('data-valeur') ?? ''));
    expect(valeurs, 'familles de la semaine affichée').toEqual(optionsAutre.familles);
    expect(optionsAutre.familles, 'les deux semaines n’ont pas la même légende (sinon le test ne prouve rien)').not.toEqual(options.familles);
    await page.getByTestId(TESTID_3D.curseur).fill(String(semaine));
    await expect(vue(page)).toHaveAttribute('data-semaine', String(semaine));
    await verifierEtat('retour à la semaine de départ');
  });

  await test.step('état local : retour au plan puis nouvelle ouverture → tout est coché', async () => {
    const famille = options.familles[0] ?? '';
    await caseDe(page, T.famille, famille).click();
    expect(await nombreAttr(toile(page), 'data-estompes')).toBeGreaterThan(0);
    await page.getByTestId(TESTID_3D.retour2d).click();
    await expect(vue(page)).toHaveCount(0);
    await ouvrirEn3d(page, nbPlanches);
    filtres = m.FILTRES_TOUT;
    await expect(toile(page)).toHaveAttribute('data-estompes', '0');
    for (const c of await cases(page, T.famille).all()) await expect(c).toBeChecked();
    await verifierEtat('réouverture');
    // Rien n'est stocké dans le navigateur par les filtres.
    const stockage = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    expect(stockage.filter((k) => /filtre|legende|3d/i.test(k)), 'clés de stockage des filtres').toEqual([]);
  });

  await test.step('les mesures de T27 tiennent encore : la semaine change toujours en moins de 100 ms avec des filtres actifs', async () => {
    const famille = options.familles[0] ?? '';
    await caseDe(page, T.famille, famille).click();
    await page.getByTestId(TESTID_3D.curseur).focus();
    const series = await repeterMesures(REPETITIONS_MESURE, async (i) => {
      await page.evaluate((marque) => {
        performance.clearMarks(marque);
        const f = window as unknown as { __touche?: number };
        delete f.__touche;
        document.addEventListener(
          'keydown',
          (e) => {
            f.__touche = e.timeStamp;
          },
          { capture: true, once: true },
        );
      }, MARQUES_3D.semaine);
      await page.getByTestId(TESTID_3D.curseur).press(i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft');
      await page.waitForFunction((mq) => performance.getEntriesByName(mq, 'mark').length > 0, MARQUES_3D.semaine);
      const ms = await page.evaluate((marque) => {
        const touche = (window as unknown as { __touche?: number }).__touche ?? Number.NaN;
        return (performance.getEntriesByName(marque, 'mark').at(-1)?.startTime ?? Number.NaN) - touche;
      }, MARQUES_3D.semaine);
      return { semaine: ms };
    });
    console.log(decrireSerie('vue 3D, changement de semaine avec un filtre actif', series.semaine, 100));
    expect(series.semaine.mediane, 'changement de semaine (médiane)').toBeLessThan(100);
    expect(Math.max(...series.semaine.valeurs), 'changement de semaine (plus haute valeur)').toBeLessThan(150);
  });

  expect(await violations(), 'violations de la CSP').toEqual([]);
});

/**
 * T27b, relecture : sur la démo (`pnpm e2e:demo`, 1280 × 800), les familles de la semaine tiennent dans
 * le panneau sans défiler : cucurbitacees et rosacees, dont la courgette et la fraise de la démo,
 * sont dans la fenêtre visible du panneau et de la page.
 */
test('vue 3D sur la démo : toutes les familles de la semaine sont visibles dans le panneau, sans défiler', async ({ page }) => {
  test.skip(process.env.E2E_DEMO !== '1', 'ne tourne que sur la démo (pnpm e2e:demo)');
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(TESTID_3D.bouton).click();
  await expect(vue(page)).toHaveAttribute('data-etat', 'pret', { timeout: 30_000 });

  const bp = await panneau(page).boundingBox();
  if (bp === null) throw new Error('panneau introuvable');
  const familles = await cases(page, T.famille).evaluateAll((els) => els.map((e) => e.getAttribute('data-valeur') ?? ''));
  for (const cle of ['cucurbitacees', 'rosacees']) {
    expect(familles, `la démo a des ${cle} cette semaine`).toContain(cle);
    const c = caseDe(page, T.famille, cle);
    await expect(c, `${cle} dans la fenêtre`).toBeInViewport({ ratio: 1 });
    const b = await c.boundingBox();
    if (b === null) throw new Error(`case ${cle} introuvable`);
    expect(b.y, `${cle} sous le haut du panneau`).toBeGreaterThanOrEqual(bp.y - 0.5);
    expect(b.y + b.height, `${cle} au-dessus du bas du panneau`).toBeLessThanOrEqual(bp.y + bp.height + 0.5);
  }
  // Toutes les familles de la semaine sont dans la fenêtre visible du panneau.
  for (const cle of familles) {
    const b = await caseDe(page, T.famille, cle).boundingBox();
    expect(b !== null && b.y + b.height <= bp.y + bp.height + 0.5, `${cle} visible sans défiler`).toBe(true);
  }
});

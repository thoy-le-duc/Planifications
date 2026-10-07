import { devices, expect, test, type Page } from '@playwright/test';
import type { Id } from '@planif/core';
import { creerPorte, SCHEMA_LOCAL } from '@planif/sync';
import { creerBaseMemoire } from '../../../packages/sync/src/test/base-memoire.ts';
import { remplirJeuT07 } from '../../../packages/sync/src/test/jeu-t07.ts';
import { CLE_SESSION } from '../src/connexion/session.ts';
import type { ModuleCalculsPlan } from '../src/ecrans/plan/test/contrat.ts';
import { MARQUES_3D, TESTID_3D, type ModuleScene, type Plan3d, type Scene } from '../src/ecrans/plan3d/test/contrat.ts';
import { decrireDefilement, decrireSerie, jugerDefilement, repeterMesures, REPETITIONS_MESURE, surveillerCsp, type PassageDefilement } from './outils.ts';

/**
 * T27 — vue 3D, de bout en bout, sur ordinateur (Chromium 1280 × 800, sans ralentissement du CPU :
 * la 3D sert au bureau, Q29), avec la grande ferme de T07 (400 emplacements, 3 000 occupations).
 * Contrat de la vue (data-testid, marques) : src/ecrans/plan3d/test/contrat.ts.
 *
 * ── Ce que mesure ce test ────────────────────────────────────────────────────────────────────
 *   1. « Voir en 3D » depuis Planches : la vue s'affiche en moins de 1 s APRÈS le chargement du
 *      module 3D (marque `module` → marque `affichee`) ; 5 ouvertures, médiane sous 1 s, aucune au-delà
 *      de 1,5 s (garde-fou de T11b : 1,5 × le budget) ; le téléchargement du module n'est pas compté ;
 *   2. changer de semaine (flèche du clavier sur le curseur) : image dessinée en moins de 100 ms,
 *      médiane de 5 changements, aucun au-delà de 150 ms ; les couleurs et la liste suivent la
 *      scène que `versScene` calcule sous Node pour la même semaine ;
 *   3. rendu à la demande : au repos, plus aucune image dessinée (data-rendus constant) ;
 *   4. navigation fluide : 5 passages de glissé du pointeur (une image par déplacement), même
 *      statistique que le défilement de plan.e2e.ts (T11d : au plus 2 images perdues d'affilée,
 *      échec si 4 passages sur 5 ou plus de 6 intervalles au total la dépassent) ; un témoin
 *      volontairement saccadé doit échouer à la même mesure ;
 *   5. sans WebGL (getContext refusé) : repli sur la 2D avec un message, sans vue 3D ;
 *   6. alternative texte : liste des planches et cultures de la semaine, fidèle à la scène ;
 *   7. aucune violation de la CSP (three et fiber ne demandent rien que la CSP refuse).
 *
 * Chromium headless n'a pas de GPU : WebGL passe par SwiftShader (rendu logiciel, nettement plus
 * lent qu'un vrai poste) ; les budgets sont donc tenus dans le pire cas réaliste.
 */

const CHEMIN_CALCULS = '../src/ecrans/plan/calculs.ts';
const CHEMIN_SCENE = '../src/ecrans/plan3d/scene.ts';
const DELAI_AMORCAGE_MS = 120_000;

const BUDGET_AFFICHAGE_MS = 1_000;
const BUDGET_SEMAINE_MS = 100;
/** Garde-fou en plus de la médiane : la plus haute valeur ne dépasse pas 1,5 fois le budget. */
const FACTEUR_MAXIMUM = 1.5;
const IMAGES_PERDUES_MAX = 2;
const PASSAGES_SACCADES_ECHEC = 4;
const RAFALES_TOTAL_MAX = 6;
/** Images par passage de glissé du pointeur. */
const IMAGES_PAR_PASSAGE = 120;
const TEMOIN_BLOCAGE_MS = 100;
const TEMOIN_PERIODE_MS = 1_000;

const executablePath = process.env.CHROMIUM_PATH;

// Ordinateur, avec un WebGL logiciel (SwiftShader) pour le Chromium headless des tests.
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
  readonly scene: ModuleScene;
  readonly utilisateurId: string;
  readonly fermeId: string;
}

/** Le plan de la ferme de T07 (graine 7) et l'adaptateur versScene, recalculés sous Node. */
async function planAttendu(): Promise<Attendu> {
  const calculs = (await import(/* @vite-ignore */ CHEMIN_CALCULS)) as ModuleCalculsPlan;
  const scene = (await import(/* @vite-ignore */ CHEMIN_SCENE)) as ModuleScene;
  const base = creerBaseMemoire(SCHEMA_LOCAL);
  try {
    const jeu = await remplirJeuT07(base);
    const porte = creerPorte(base, { utilisateurId: jeu.utilisateurId as Id<'Utilisateur'>, fermeId: jeu.principale.fermeId as Id<'Ferme'> });
    const aujourdhui = jourLocal(new Date());
    const saison = calculs.saisonParDefaut(await calculs.chargerSaisons(porte, jeu.principale.fermeId), aujourdhui);
    if (saison === null) throw new Error('jeu de T07 sans saison');
    const plan = (await calculs.chargerPlan(porte, jeu.principale.fermeId, { saison, aujourdhui })) as unknown as Plan3d;
    return { plan, scene, utilisateurId: jeu.utilisateurId, fermeId: jeu.principale.fermeId };
  } finally {
    base.fermer();
  }
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const onglet = (page: Page, libelle: string) => navigation(page).locator('button').filter({ hasText: libelle });
const vue = (page: Page) => page.getByTestId(TESTID_3D.vue);
const toile = (page: Page) => page.getByTestId(TESTID_3D.toile);
const curseur = (page: Page) => page.getByTestId(TESTID_3D.curseur);

/** Amorce la base locale (page de diagnostic), range la session, installe le service worker, ouvre Planches. */
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

/** Clique « Voir en 3D » ; renvoie le temps (ms) entre la marque du module chargé et celle de la vue affichée. */
async function ouvrirEn3d(page: Page): Promise<number> {
  await page.evaluate((marques) => {
    for (const m of marques) performance.clearMarks(m);
  }, Object.values(MARQUES_3D));
  await page.getByTestId(TESTID_3D.bouton).click();
  await page.waitForFunction((m) => performance.getEntriesByName(m, 'mark').length > 0, MARQUES_3D.affichee, { timeout: 30_000 });
  return page.evaluate(
    ([module = '', affichee = '']) => {
      const t = (nom: string) => performance.getEntriesByName(nom, 'mark')[0]?.startTime ?? Number.NaN;
      return t(affichee) - t(module);
    },
    [MARQUES_3D.module, MARQUES_3D.affichee],
  );
}

/** Indice de la semaine affichée par la vue. */
async function semaineAffichee(page: Page): Promise<number> {
  return Number(await vue(page).getAttribute('data-semaine'));
}

/**
 * Appuie sur une flèche du curseur ; renvoie le temps (ms) entre l'événement clavier et la marque
 * « image dessinée pour la nouvelle semaine ».
 */
async function changerDeSemaine(page: Page, touche: 'ArrowRight' | 'ArrowLeft'): Promise<{ ms: number; semaine: number }> {
  const avant = await semaineAffichee(page);
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
  await curseur(page).press(touche);
  await page.waitForFunction((m) => performance.getEntriesByName(m, 'mark').length > 0, MARQUES_3D.semaine);
  const mesure = await page.evaluate((marque) => {
    const touche = (window as unknown as { __touche?: number }).__touche ?? Number.NaN;
    const m = performance.getEntriesByName(marque, 'mark').at(-1) as PerformanceMark | undefined;
    const detail = m?.detail as { semaine?: number } | null | undefined;
    return { ms: (m?.startTime ?? Number.NaN) - touche, semaine: detail?.semaine ?? -1 };
  }, MARQUES_3D.semaine);
  expect(mesure.semaine, `la marque nomme la semaine affichée (avant : ${String(avant)})`).toBe(await semaineAffichee(page));
  return mesure;
}

/** Un passage de glissé du pointeur : une image (requestAnimationFrame) par déplacement. */
async function glisserUneFois(page: Page, sens: 1 | -1): Promise<PassageDefilement & { rendus: number }> {
  const boite = await toile(page).boundingBox();
  if (boite === null) throw new Error('toile 3D sans boîte');
  const x0 = boite.x + boite.width / 2 - (sens * boite.width) / 4;
  const y0 = boite.y + boite.height / 2;
  const rendusAvant = Number(await toile(page).getAttribute('data-rendus'));
  await page.evaluate(() => {
    const intervalles: number[] = [];
    const f = window as unknown as { __intervalles?: number[]; __arret?: boolean };
    f.__intervalles = intervalles;
    f.__arret = false;
    let precedent = -1;
    const image = (t: number) => {
      if (precedent >= 0) intervalles.push(t - precedent);
      precedent = t;
      if (f.__arret !== true) requestAnimationFrame(image);
    };
    requestAnimationFrame(image);
  });
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= IMAGES_PAR_PASSAGE; i += 1) {
    await page.mouse.move(x0 + sens * i * 3, y0 + ((i % 20) - 10) * 2);
    await page.evaluate(
      () =>
        new Promise<void>((fini) => {
          requestAnimationFrame(() => {
            fini();
          });
        }),
    );
  }
  await page.mouse.up();
  const intervalles = await page.evaluate(() => {
    const f = window as unknown as { __intervalles?: number[]; __arret?: boolean };
    f.__arret = true;
    return f.__intervalles ?? [];
  });
  const rendusApres = Number(await toile(page).getAttribute('data-rendus'));
  // Les deux premiers intervalles comptent le démarrage de la mesure, pas la navigation (comme plan.e2e.ts).
  return { intervalles: intervalles.slice(2), rendus: rendusApres - rendusAvant };
}

async function glisserCinqFois(page: Page): Promise<(PassageDefilement & { rendus: number })[]> {
  const passages: (PassageDefilement & { rendus: number })[] = [];
  for (let i = 0; i < REPETITIONS_MESURE; i += 1) passages.push(await glisserUneFois(page, i % 2 === 0 ? 1 : -1));
  return passages;
}

/** La liste texte d'une scène : ce que `liste-3d` doit montrer, planche par planche. */
function attenduListe(s: Scene): readonly { id: string; code: string; culture: string }[] {
  return s.volumes.map((v) => ({ id: v.id, code: v.code, culture: v.culture ?? '' }));
}

async function lireListe(page: Page): Promise<{ id: string; culture: string; texte: string }[]> {
  return page.getByTestId(TESTID_3D.elementListe).evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute('data-id') ?? '', culture: e.getAttribute('data-culture') ?? '', texte: e.textContent.trim() })),
  );
}

test('vue 3D : grande ferme de T07, ordinateur, WebGL', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 300_000);
  const attendu = await planAttendu();
  const { plan } = attendu;
  const nbPlanches = plan.lignes.filter((l) => l.sorte === 'emplacement').length;
  expect(nbPlanches, 'grande ferme').toBeGreaterThanOrEqual(400);
  const semaineInitiale = plan.semaineCourante ?? 0;
  const violations = await surveillerCsp(page);

  await ouvrirPlanches(page, attendu);

  await test.step('le bouton « Voir en 3D » est sur Planches, au clavier aussi', async () => {
    const bouton = page.getByTestId(TESTID_3D.bouton);
    await expect(bouton).toBeVisible();
    await expect(bouton).toHaveAccessibleName('Voir en 3D');
    await expect(vue(page)).toHaveCount(0);
  });

  await test.step('le module 3D n’est pas chargé avant le clic', async () => {
    const ressources = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
    expect(ressources.filter((r) => /three|fiber|plan3d|vue3d|vue-3d/i.test(r)), 'ressources 3D téléchargées avant le clic').toEqual([]);
  });

  await test.step('ouverture : vue affichée moins de 1 s après le chargement du module (médiane de 5, max 1,5 s)', async () => {
    const series = await repeterMesures(REPETITIONS_MESURE, async (i) => {
      const affichage = await ouvrirEn3d(page);
      await expect(vue(page)).toBeVisible();
      await expect(vue(page)).toHaveAttribute('data-etat', 'pret');
      await expect(toile(page)).toBeVisible();
      await expect(toile(page)).toHaveAttribute('data-volumes', String(nbPlanches));
      expect(await semaineAffichee(page), 'semaine à l’ouverture').toBe(semaineInitiale);
      if (i < REPETITIONS_MESURE - 1) {
        await page.getByTestId(TESTID_3D.retour2d).click();
        await expect(vue(page)).toHaveCount(0);
        await expect(page.getByTestId('plan-defilement')).toBeVisible();
      }
      return { affichage };
    });
    console.log(decrireSerie('vue 3D, affichage après chargement du module', series.affichage, BUDGET_AFFICHAGE_MS));
    expect(series.affichage.mediane, 'affichage (médiane)').toBeLessThan(BUDGET_AFFICHAGE_MS);
    expect(Math.max(...series.affichage.valeurs), 'affichage (plus haute valeur)').toBeLessThan(BUDGET_AFFICHAGE_MS * FACTEUR_MAXIMUM);
  });

  await test.step('curseur de semaine : accessible, borné par les semaines du plan', async () => {
    const c = curseur(page);
    await expect(c).toHaveAttribute('type', 'range');
    await expect(c).toHaveAccessibleName('Semaine');
    await expect(c).toHaveAttribute('min', '0');
    await expect(c).toHaveAttribute('max', String(plan.semaines.length - 1));
    await expect(c).toHaveAttribute('aria-valuetext', plan.semaines[semaineInitiale]?.libelle ?? '');
    await expect(page.getByTestId(TESTID_3D.semaine)).toHaveText(plan.semaines[semaineInitiale]?.libelle ?? '');
    const boite = await c.boundingBox();
    expect(boite?.height ?? 0, 'cible du curseur').toBeGreaterThanOrEqual(24);
  });

  await test.step('changer de semaine : image dessinée en moins de 100 ms (médiane de 5, max 150 ms), sans recharger', async () => {
    await page.evaluate(() => {
      (window as unknown as { __memePage?: boolean }).__memePage = true;
    });
    await curseur(page).focus();
    const touches = ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft'] as const;
    const series = await repeterMesures(touches.length, async (i) => {
      const t = touches[i] ?? 'ArrowRight';
      const { ms, semaine } = await changerDeSemaine(page, t);
      expect(semaine).toBeGreaterThanOrEqual(0);
      expect(semaine).toBeLessThan(plan.semaines.length);
      return { semaine: ms };
    });
    console.log(decrireSerie('vue 3D, changement de semaine', series.semaine, BUDGET_SEMAINE_MS));
    expect(series.semaine.mediane, 'changement de semaine (médiane)').toBeLessThan(BUDGET_SEMAINE_MS);
    expect(Math.max(...series.semaine.valeurs), 'changement de semaine (plus haute valeur)').toBeLessThan(BUDGET_SEMAINE_MS * FACTEUR_MAXIMUM);
    expect(await page.evaluate(() => (window as unknown as { __memePage?: boolean }).__memePage), 'pas de rechargement').toBe(true);
  });

  await test.step('alternative texte : la liste des planches et cultures suit la scène de versScene, semaine après semaine', async () => {
    const liste = page.getByTestId(TESTID_3D.liste);
    await expect(liste).toBeAttached();
    await expect(page.getByRole('list', { name: /^Planches et cultures/ })).toBeAttached();
    // Pour trois semaines : la courante, une autre et la dernière.
    for (const i of [semaineInitiale, Math.min(plan.semaines.length - 1, semaineInitiale + 5), plan.semaines.length - 1]) {
      await curseur(page).fill(String(i));
      await expect(vue(page)).toHaveAttribute('data-semaine', String(i));
      const scene = attendu.scene.versScene(plan, i);
      const attendue = attenduListe(scene);
      const vue_ = await lireListe(page);
      expect(vue_.length, `semaine ${String(i)} : une entrée par planche`).toBe(attendue.length);
      expect(vue_.map((e) => e.id), `semaine ${String(i)} : ordre du plan`).toEqual(attendue.map((e) => e.id));
      expect(vue_.map((e) => e.culture), `semaine ${String(i)} : cultures de la semaine`).toEqual(attendue.map((e) => e.culture));
      for (const [k, e] of vue_.entries()) {
        expect(e.texte, `planche ${String(attendue[k]?.code)}`).toContain(attendue[k]?.code ?? '');
        if (attendue[k]?.culture !== '') expect(e.texte).toContain(attendue[k]?.culture ?? '');
      }
      expect(attendue.some((e) => e.culture !== ''), `semaine ${String(i)} : au moins une culture en place`).toBe(true);
    }
    // Les cultures changent bel et bien d'une semaine à l'autre.
    const a = (await lireListe(page)).map((e) => e.culture).join('|');
    await curseur(page).fill('0');
    const b = (await lireListe(page)).map((e) => e.culture).join('|');
    expect(a).not.toBe(b);
  });

  await test.step('rendu à la demande : au repos, aucune image n’est dessinée', async () => {
    await page.waitForTimeout(500);
    const avant = Number(await toile(page).getAttribute('data-rendus'));
    await page.waitForTimeout(1_000);
    expect(Number(await toile(page).getAttribute('data-rendus')), 'images dessinées pendant 1 s de repos').toBe(avant);
  });

  await test.step('navigation au pointeur : 5 passages, au plus 2 images perdues d’affilée (4 passages saccadés ou plus de 6 intervalles : échec)', async () => {
    const passages = await glisserCinqFois(page);
    const verdict = jugerDefilement(passages, IMAGES_PERDUES_MAX, PASSAGES_SACCADES_ECHEC, RAFALES_TOTAL_MAX);
    console.log(decrireDefilement('navigation 3D', verdict));
    for (const [i, p] of passages.entries()) {
      expect(p.rendus, `passage ${String(i + 1)} : la caméra a bien bougé (images dessinées)`).toBeGreaterThan(IMAGES_PAR_PASSAGE / 4);
      expect(p.intervalles.length, `passage ${String(i + 1)} : images mesurées`).toBeGreaterThan(IMAGES_PAR_PASSAGE / 2);
    }
    expect(verdict.passagesSaccades, 'passages qui perdent plus de 2 images d’affilée').toBeLessThan(PASSAGES_SACCADES_ECHEC);
    expect(verdict.rafalesTotal, 'intervalles au-delà de 2 images perdues, sur les 5 passages').toBeLessThanOrEqual(RAFALES_TOTAL_MAX);
    expect(verdict.fluide).toBe(true);
  });

  await test.step('témoin : une navigation volontairement saccadée fait échouer la même mesure', async () => {
    await page.evaluate(
      ([blocageMs, periodeMs]) => {
        const f = window as unknown as { __saccade?: number };
        f.__saccade = window.setInterval(() => {
          const fin = performance.now() + blocageMs;
          while (performance.now() < fin) {
            // attente active : le fil principal est bloqué
          }
        }, periodeMs);
      },
      [TEMOIN_BLOCAGE_MS, TEMOIN_PERIODE_MS] as const,
    );
    try {
      const passages = await glisserCinqFois(page);
      const verdict = jugerDefilement(passages, IMAGES_PERDUES_MAX, PASSAGES_SACCADES_ECHEC, RAFALES_TOTAL_MAX);
      console.log(decrireDefilement('témoin saccadé (3D)', verdict));
      expect(verdict.fluide, 'la navigation saccadée doit échouer à la mesure').toBe(false);
    } finally {
      await page.evaluate(() => {
        window.clearInterval((window as unknown as { __saccade?: number }).__saccade);
      });
    }
  });

  await test.step('retour au plan 2D', async () => {
    await page.getByTestId(TESTID_3D.retour2d).click();
    await expect(vue(page)).toHaveCount(0);
    await expect(page.getByTestId('plan-defilement')).toBeVisible();
    await expect(page.getByTestId('barre').first()).toBeVisible();
  });

  expect(await violations(), 'violations de la CSP (three, fiber)').toEqual([]);
});

test('vue 3D : sans WebGL, repli sur la 2D avec un message', async ({ page }) => {
  test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
  const attendu = await planAttendu();
  await ouvrirPlanches(page, attendu);

  // WebGL refusé : le contexte ne se crée pas (carte graphique absente, pilote bloqué, désactivé).
  await page.addInitScript(() => {
    const original = Reflect.get(HTMLCanvasElement.prototype, 'getContext') as (this: HTMLCanvasElement, type: string, ...reste: unknown[]) => unknown;
    Reflect.set(HTMLCanvasElement.prototype, 'getContext', function (this: HTMLCanvasElement, type: string, ...reste: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return original.call(this, type, ...reste);
    });
  });
  await page.reload();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 30_000 });
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible();
  expect(await page.evaluate(() => document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')), 'WebGL refusé dans la page').toBeNull();

  await page.getByTestId(TESTID_3D.bouton).click();

  const repli = page.getByTestId(TESTID_3D.repli);
  await expect(repli).toBeVisible({ timeout: 15_000 });
  await expect(repli).toHaveAttribute('role', 'status');
  await expect(repli).toContainText('3D');
  expect((await repli.innerText()).trim().length, 'message d’explication').toBeGreaterThan(20);
  // La 2D est toujours là, utilisable ; aucune vue 3D à moitié ouverte.
  await expect(vue(page)).toHaveCount(0);
  await expect(toile(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
  await expect(page.getByTestId('plan-defilement')).toBeVisible();
  await expect(page.getByTestId('barre').first()).toBeVisible();
});

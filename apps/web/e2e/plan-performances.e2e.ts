import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  decrireDefilement,
  decrireSerie,
  jugerDefilement,
  jugerSerie,
  mediane,
  mesurerEnManches,
  ralentirCpu,
  REPETITIONS_MESURE,
  tempsAppPrete,
  type PassageDefilement,
  type SerieMesures,
  type VerdictDefilement,
} from './outils.ts';
import { installerAvecBase, noterPremierAppui, onglet, tapJusquAuPlanDepuisPremierAppui } from './plan-performances-outils.ts';

/**
 * T11e — tests d'acceptation de « Planches : marges de temps »
 * (docs/backlog/T11e-plan-performances.md). Mesures d'origine : docs/mesures/T11e-avant.md
 * (relevées par e2e/t11e-mesures.e2e.ts). Même cadre que plan.e2e.ts : build de production
 * (dist-essais), ferme de T07 (400 planches, 3 000 occupations) amorcée par
 * /diagnostic/amorcer.html, appli servie par le service worker, HORS LIGNE, CPU ralenti ×4.
 *
 * Le premier tap dans la première seconde (base pas encore prête) est sorti dans T11g (décision
 * du chef du 2026-10-10, docs/backlog/T11g-plan-avant-base.md) : il demande un instantané du plan
 * montré avant la base (App.tsx, main.tsx, budget de démarrage). Le test est remis ci-dessous
 * (test 3) tel que donné dans le ticket ; il est rouge tant que T11g n'est pas codé (mesuré avant :
 * médiane 633 ms, pire 694 ms, docs/mesures/T11e-avant.md, section 1).
 *
 * 1. « Planches », base prête (marge, garde) : 10 taps, CHACUN sous 300 ms (plus de tolérance de
 *    1,5 ×). Mesuré avant : 104 à 164 ms sans charge ; 313 ms relevés une fois sous charge (T11b).
 *    Ce test passe aujourd'hui : il garde la marge, il ne la crée pas.
 * 2. Défilement, 10 passages (40 px par image, comme plan.e2e.ts), plan complet lu et page au
 *    calme : limite de T11d (au plus 2 images perdues d'affilée à 60 Hz), mais AU PLUS UN passage
 *    saccadé sur 10 et AU PLUS 2 intervalles fautifs au total (plan.e2e.ts tolère 3 passages sur
 *    5 et 6 intervalles). Mesuré avant : 2 passages saccadés sur 10, 5 intervalles fautifs, pire
 *    133 ms ; images longues dont le RENDU (style, mise en page, peinture) prend 39 à 62 ms, et
 *    un message de PowerSync traité 123 ms dans la page (base-appli).
 *    T62 : jusqu'à trois manches de dix passages, mêmes seuils ; une première manche fautive n'est
 *    tolérée que si les deux manches rejouées sont fluides (docs/mesures/T62.md : les intervalles
 *    fautifs restants viennent surtout de la machine).
 */

const BUDGET_MS = 300;
/** T11g : la première seconde après la navigation. */
const PREMIERE_SECONDE_MS = 1_000;
const REPETITIONS_MARGE = 10;
const PASSAGES_DEFILEMENT = 10;
/** T11d : au plus 2 images perdues d'affilée (≈ 50 ms, frontière réelle ≈ 58 ms). */
const IMAGES_PERDUES_MAX = 2;
/** Échec dès 2 passages saccadés sur 10, ou plus de 2 intervalles fautifs au total. */
const PASSAGES_SACCADES_ECHEC = 2;
const RAFALES_TOTAL_MAX = 2;
const PAS_DEFILEMENT_PX = 40;

let contexte: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  contexte = await browser.newContext();
  page = await contexte.newPage();
  await noterPremierAppui(page);
  await installerAvecBase(page);
  // L'utilisateur a déjà vu Planches sur ce téléphone, puis revient à Aujourd'hui.
  await onglet(page, 'Planches').click();
  await expect(page.getByTestId('barre').first()).toBeVisible({ timeout: 30_000 });
  await onglet(page, 'Aujourd’hui').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toHaveCount(0);
  await contexte.setOffline(true);
  await ralentirCpu(page);
});

test.afterAll(async () => {
  await contexte.close();
});

/** Rechargement hors ligne : la page repart de zéro (base rouverte, module Planches pas chargé). */
async function recharger(): Promise<void> {
  await page.reload();
  await tempsAppPrete(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null), 'servie par le service worker').toBe(true);
}

test('« Planches », base prête : dix taps, chacun sous 300 ms (garde de la marge)', async () => {
  test.setTimeout(240_000);
  const valeurs: number[] = [];
  for (let i = 0; i < REPETITIONS_MARGE; i += 1) {
    await recharger();
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    // Page au calme (journée relue, début du plan préparé), comme plan.e2e.ts.
    await page.waitForTimeout(500);
    await onglet(page, 'Planches').click();
    const r = await tapJusquAuPlanDepuisPremierAppui(page);
    valeurs.push(r.ms);
    await expect(page.getByTestId('barre').first()).toBeVisible();
    await onglet(page, 'Aujourd’hui').click();
  }
  const serie: SerieMesures = { valeurs, mediane: mediane(valeurs) };
  console.log(decrireSerie('Planches, base prête, 10 taps', serie, BUDGET_MS));
  const auDela = valeurs.filter((v) => v >= BUDGET_MS);
  expect(auDela, 'taps sur Planches à 300 ms ou plus').toEqual([]);
});

test('défilement : dix passages, au plus un saccadé et au plus deux intervalles fautifs', async () => {
  // T62 : jusqu'à trois manches de dix passages (≈ 1,5 min chacune).
  test.setTimeout(600_000);
  await recharger();
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
  await onglet(page, 'Planches').click();
  const defilement = page.getByTestId('plan-defilement');
  await expect(page.getByTestId('barre').first()).toBeVisible();
  // Plan complet lu (plus de « Lecture des autres planches… »), puis une seconde de calme.
  await expect(page.getByText('Lecture des autres planches…')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1_000);

  /** Une manche : dix passages de haut en bas, jugés aux seuils du test (inchangés). */
  const manche = async (n: number): Promise<VerdictDefilement> => {
    const passages: PassageDefilement[] = [];
    for (let i = 0; i < PASSAGES_DEFILEMENT; i += 1) {
      await defilement.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.waitForTimeout(200);
      const intervalles = await defilement.evaluate(
        (el, pas) =>
          new Promise<number[]>((fini) => {
            const ecarts: number[] = [];
            let precedent = -1;
            const image = (t: number) => {
              if (precedent >= 0) ecarts.push(t - precedent);
              precedent = t;
              const max = el.scrollHeight - el.clientHeight;
              if (el.scrollTop >= max - 1) {
                // Les deux premiers intervalles comptent le démarrage de la mesure (plan.e2e.ts).
                fini(ecarts.slice(2));
                return;
              }
              el.scrollTop = Math.min(max, el.scrollTop + pas);
              requestAnimationFrame(image);
            };
            requestAnimationFrame(image);
          }),
        PAS_DEFILEMENT_PX,
      );
      expect(intervalles.length, `manche ${String(n + 1)}, passage ${String(i + 1)} : le plan défile`).toBeGreaterThan(100);
      passages.push({ intervalles });
    }
    const v = jugerDefilement(passages, IMAGES_PERDUES_MAX, PASSAGES_SACCADES_ECHEC, RAFALES_TOTAL_MAX);
    console.log(decrireDefilement(`défilement, manche ${String(n + 1)}, 10 passages`, v));
    return v;
  };
  // T62 : une première manche en échec n'est tolérée que si TOUTES les manches rejouées (jusqu'à
  // MANCHES_DEFILEMENT_MAX en tout) sont fluides, mêmes seuils ; deux manches fautives : échec.
  const { fluide, manchesFautives, retenu: verdict, manches } = await mesurerEnManches(manche);
  console.log(
    `défilement : ${String(manches.length)} manche(s) mesurée(s), ${String(manchesFautives)} fautive(s) ; retenue : ${String(verdict.passagesSaccades)} passage(s) saccadé(s), ${String(verdict.rafalesTotal)} intervalle(s) fautif(s)`,
  );
  expect(fluide, `au plus une manche fautive, et seulement si les manches rejouées sont toutes fluides (${String(manchesFautives)} fautive(s) sur ${String(manches.length)})`).toBe(true);
  expect(verdict.passagesSaccades, 'passages qui perdent plus de 2 images d’affilée (sur 10)').toBeLessThan(PASSAGES_SACCADES_ECHEC);
  expect(verdict.rafalesTotal, 'intervalles au-delà de 2 images perdues, sur les 10 passages').toBeLessThanOrEqual(RAFALES_TOTAL_MAX);
});

// T11g (docs/backlog/T11g-plan-avant-base.md) : remis tel quel depuis le ticket.
test('premier tap sur « Planches » dans la première seconde : plan affiché en moins de 300 ms', async () => {
  test.setTimeout(180_000);
  const valeurs: number[] = [];
  for (let i = 0; i < REPETITIONS_MESURE; i += 1) {
    await recharger();
    const baseAuTap = await page.getByTestId('app').getAttribute('data-base');
    await onglet(page, 'Planches').click();
    const r = await tapJusquAuPlanDepuisPremierAppui(page);
    console.log(`premier tap : à ${r.tap.toFixed(0)} ms (base « ${baseAuTap ?? '?'} »), plan à ${r.plan.toFixed(0)} ms → ${r.ms.toFixed(0)} ms`);
    expect(r.tap, 'le tap tombe dans la première seconde').toBeLessThan(PREMIERE_SECONDE_MS);
    await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
    await expect(page.getByTestId('ligne-plan').first()).toBeVisible();
    await expect(page.getByTestId('barre').first()).toBeVisible();
    valeurs.push(r.ms);
    await onglet(page, 'Aujourd’hui').click();
  }
  const serie: SerieMesures = { valeurs, mediane: mediane(valeurs) };
  console.log(decrireSerie('Planches, premier tap dans la première seconde', serie, BUDGET_MS));
  expect(jugerSerie(serie, BUDGET_MS).raisons, 'premier tap sur Planches').toEqual([]);
});

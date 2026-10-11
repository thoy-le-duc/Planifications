import { expect, test, type Page, type Request } from '@playwright/test';
import { ralentirCpu, tempsAppPrete } from './outils.ts';
import {
  additionnerProfils,
  amorcer,
  arreterProfil,
  demarrerProfil,
  imagesLonguesDepuis,
  installerAvecBase,
  MARQUE_PLAN,
  noterPremierAppui,
  observerImagesLongues,
  onglet,
  rangerSession,
  tapJusquAuPlanDepuisPremierAppui,
  type ImageLongue,
  type LigneProfil,
} from './plan-performances-outils.ts';

/**
 * T11e — MESURES (pas des tests d'acceptation) : les chiffres de docs/mesures/T11e-avant.md.
 * Ignoré par `pnpm e2e` ; à lancer à la main, sur dist-essais (après `pnpm build:essais`) :
 *
 *   cd apps/web && MESURES_T11E=1 E2E_PORT_APPLI=4407 bash ../../scripts/verrou-e2e.sh \
 *     npx playwright test e2e/t11e-mesures.e2e.ts
 *
 * Les relevés sortent en lignes « [T11e] … » dans le journal du test. Le développeur relance le
 * même fichier après ses corrections pour la mesure « après » de la PR.
 */
test.skip(process.env.MESURES_T11E !== '1', 'mesures T11e : MESURES_T11E=1 pour les lancer');

const REPETITIONS = 5;
const log = (texte: string) => {
  console.log(`[T11e] ${texte}`);
};
const ms = (x: number) => x.toFixed(0);

/** Fichiers suivis au lancement (nom court → motif de l'URL). */
const FICHIERS: readonly (readonly [string, RegExp])[] = [
  ['index.js (démarrage)', /\/assets\/index-[^/]+\.js$/],
  ['appli.ts', /\/assets\/appli-[^/]+\.js$/],
  ['effacer.ts', /\/assets\/effacer-[^/]+\.js$/],
  ['base-appli.ts', /\/assets\/sqlite\/base-appli-[^/]+\.js$/],
  ['PowerSync (lib)', /\/assets\/sqlite\/lib-[^/]+\.js$/],
  ['worker PowerSync', /\/assets\/sqlite\/worker-[^/]+\.js$/],
  ['wa-sqlite-async.js', /\/assets\/sqlite\/wa-sqlite-async-[^/]+\.js$/],
  ['WASM', /\/assets\/sqlite\/[^/]+\.wasm$/],
  ['IDBBatchAtomicVFS', /\/assets\/sqlite\/IDBBatchAtomicVFS-[^/]+\.js$/],
  ['écran Planches', /\/assets\/plan-[^/]+\.js$/],
  ['écran Aujourd’hui', /\/assets\/aujourdhui-[^/]+\.js$/],
];

/** Instrumentation des étapes du lancement : indexedDB.databases(), Worker, data-base. */
async function instrumenterLancement(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const f = window as unknown as { __etapesT11e: [string, number][] };
    f.__etapesT11e = [];
    const noter = (nom: string) => {
      f.__etapesT11e.push([nom, performance.now()]);
    };
    const proto = IDBFactory.prototype as unknown as { databases?: (this: IDBFactory) => Promise<IDBDatabaseInfo[]> };
    const databases = proto.databases;
    if (databases !== undefined) {
      proto.databases = function (this: IDBFactory) {
        noter('indexedDB.databases() : appel');
        return databases.call(this).finally(() => {
          noter('indexedDB.databases() : réponse');
        });
      };
    }
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(url: string | URL, options?: WorkerOptions) {
        noter(`new Worker(${String(url).split('/').pop() ?? ''})`);
        super(url, options);
      }
    };
    new MutationObserver((changements) => {
      for (const c of changements) {
        if (c.target instanceof HTMLElement && c.attributeName === 'data-base') noter(`data-base=${c.target.dataset.base ?? ''}`);
      }
    }).observe(document, { attributes: true, attributeFilter: ['data-base'], subtree: true });
    document.addEventListener('DOMContentLoaded', () => {
      const app = document.querySelector<HTMLElement>('[data-testid="app"]');
      if (app?.dataset.base !== undefined) noter(`data-base=${app.dataset.base}`);
    });
  });
}

interface Etape {
  readonly nom: string;
  readonly debut: number;
  readonly fin: number;
}

/** Requêtes de la page (et de ses workers), relatives au début de la navigation. */
async function etapesReseau(page: Page, requetes: readonly Request[]): Promise<Etape[]> {
  const origine = await page.evaluate(() => performance.timeOrigin);
  const etapes: Etape[] = [];
  for (const r of requetes) {
    const nom = FICHIERS.find(([, motif]) => motif.test(r.url()))?.[0];
    if (nom === undefined) continue;
    const t = r.timing();
    const debut = t.startTime - origine;
    const fin = t.responseEnd >= 0 ? debut + t.responseEnd : Number.NaN;
    etapes.push({ nom: `fichier ${nom}`, debut, fin });
  }
  return etapes;
}

test.describe.configure({ mode: 'serial' });

test('mesure 1 — chronologie du lancement et premier tap sur Planches', async ({ page, context }) => {
  test.setTimeout(600_000);
  await instrumenterLancement(page);
  await noterPremierAppui(page);
  await installerAvecBase(page);
  await context.setOffline(true);
  await ralentirCpu(page);

  let requetes: Request[] = [];
  page.on('requestfinished', (r) => {
    requetes.push(r);
  });

  // a) Chronologie, sans tap : rechargement hors ligne, jusqu'à la base prête.
  for (let i = 0; i < REPETITIONS; i += 1) {
    requetes = [];
    await page.reload();
    const prete = await tempsAppPrete(page);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    await page.waitForTimeout(300);
    const etapes = await page.evaluate(() => (window as unknown as { __etapesT11e?: [string, number][] }).__etapesT11e ?? []);
    const reseau = await etapesReseau(page, requetes);
    const tout: Etape[] = [
      { nom: 'marque app-prete', debut: prete, fin: prete },
      ...etapes.map(([nom, t]) => ({ nom, debut: t, fin: t })),
      ...reseau,
    ].sort((a, b) => a.debut - b.debut);
    log(`chronologie, répétition ${String(i + 1)} :`);
    for (const e of tout) log(`  ${ms(e.debut)}${e.fin !== e.debut ? `→${ms(e.fin)}` : ''} ms  ${e.nom}`);
  }

  // b) Premier tap sur Planches dès la marque app-prete (base pas encore prête).
  const premiers: string[] = [];
  for (let i = 0; i < REPETITIONS; i += 1) {
    await page.reload();
    await tempsAppPrete(page);
    await onglet(page, 'Planches').click();
    const r = await tapJusquAuPlanDepuisPremierAppui(page);
    const base = await page.evaluate(() => ((window as unknown as { __etapesT11e?: [string, number][] }).__etapesT11e ?? []).find(([n]) => n === 'data-base=prete')?.[1] ?? Number.NaN);
    premiers.push(`tap ${ms(r.tap)} ms → plan ${ms(r.plan)} ms : ${ms(r.ms)} ms (base prête à ${ms(base)} ms)`);
    await expect(page.getByRole('heading', { level: 1, name: 'Planches' })).toBeVisible();
    await onglet(page, 'Aujourd’hui').click();
  }
  log('premier tap sur Planches dès app-prete :');
  for (const p of premiers) log(`  ${p}`);

  // c) Premier tap à 500 ms de la navigation (dans la première seconde, base pas encore prête).
  const demi: string[] = [];
  for (let i = 0; i < REPETITIONS; i += 1) {
    await page.reload();
    await tempsAppPrete(page);
    const maintenant = await page.evaluate(() => performance.now());
    if (maintenant < 500) await page.waitForTimeout(500 - maintenant);
    await onglet(page, 'Planches').click();
    const r = await tapJusquAuPlanDepuisPremierAppui(page);
    const base = await page.evaluate(() => ((window as unknown as { __etapesT11e?: [string, number][] }).__etapesT11e ?? []).find(([n]) => n === 'data-base=prete')?.[1] ?? Number.NaN);
    demi.push(`tap ${ms(r.tap)} ms → plan ${ms(r.plan)} ms : ${ms(r.ms)} ms (base prête à ${ms(base)} ms)`);
    await onglet(page, 'Aujourd’hui').click();
  }
  log('premier tap sur Planches vers 500 ms :');
  for (const p of demi) log(`  ${p}`);
});

test('mesure 2 — double téléchargement à la première visite', async ({ browser }) => {
  test.setTimeout(600_000);
  // Deux cas : (A) session et base déjà là à la première visite de l'appli (la page charge
  // PowerSync tout de suite, le service worker précache ensuite) ; (B) connexion pendant le
  // précache : la page se recharge connectée dès l'enregistrement du service worker.
  for (const cas of ['A', 'B'] as const) {
    const contexte = await browser.newContext();
    try {
      const page = await contexte.newPage();
      const jeu = await amorcer(page);
      if (cas === 'A') await rangerSession(page, jeu.utilisateurId);
      // Cache HTTP vidé : l'amorçage a pu charger les mêmes fichiers de SQLite.
      const cdp = await contexte.newCDPSession(page);
      await cdp.send('Network.clearBrowserCache');
      await ralentirCpu(page);

      interface Releve {
        readonly url: string;
        readonly parSw: boolean;
        readonly depuisSw: boolean;
        readonly statut: number;
        readonly corps: number;
      }
      const releves: Releve[] = [];
      contexte.on('requestfinished', (r) => {
        void (async () => {
          const reponse = await r.response();
          const tailles = await r.sizes();
          releves.push({
            url: r.url(),
            parSw: r.serviceWorker() !== null,
            depuisSw: reponse?.fromServiceWorker() ?? false,
            statut: reponse?.status() ?? 0,
            corps: tailles.responseBodySize,
          });
        })();
      });

      await page.goto('/');
      if (cas === 'B') {
        await page.waitForFunction(() => performance.getEntriesByName('planif:sw-enregistre', 'mark').length > 0, undefined, { timeout: 30_000 });
        await rangerSession(page, jeu.utilisateurId);
        await page.reload();
      }
      await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 60_000 });
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 60_000 });
      await page.waitForTimeout(2_000);

      const sqlite = releves.filter((r) => r.url.includes('/assets/sqlite/'));
      const parUrl = new Map<string, Releve[]>();
      for (const r of sqlite) parUrl.set(r.url, [...(parUrl.get(r.url) ?? []), r]);
      let doublon = 0;
      let total = 0;
      log(`cas ${cas} :`);
      for (const [url, liste] of parUrl) {
        const reseau = liste.filter((r) => !r.depuisSw && r.corps > 0);
        total += reseau.reduce((s, r) => s + r.corps, 0);
        if (reseau.length > 1) doublon += reseau.slice(1).reduce((s, r) => s + r.corps, 0);
        log(
          `  ${url.split('/').pop() ?? url} : ${liste
            .map((r) => `${r.parSw ? 'précache' : 'page'}${r.depuisSw ? ' (servi par le SW)' : ''} ${String(r.statut)} ${String(r.corps)} o`)
            .join(' ; ')}`,
        );
      }
      log(`  octets de SQLite reçus du réseau : ${String(total)} ; en double : ${String(doublon)}`);
    } finally {
      await contexte.close();
    }
  }
});

test('mesure 3 — profil de « Planches » et du défilement', async ({ page, context }) => {
  test.setTimeout(900_000);
  await observerImagesLongues(page);
  await noterPremierAppui(page);
  await installerAvecBase(page);
  await context.setOffline(true);
  await ralentirCpu(page);
  const cdp = await context.newCDPSession(page);

  // a) Tap sur Planches, base déjà prête (comme plan.e2e.ts) : temps, images longues, profil.
  const profils: LigneProfil[][] = [];
  for (let i = 0; i < REPETITIONS; i += 1) {
    await page.reload();
    await tempsAppPrete(page);
    await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 15_000 });
    await page.waitForTimeout(500);
    const avant = await page.evaluate(() => performance.now());
    await demarrerProfil(cdp);
    await onglet(page, 'Planches').click();
    const r = await tapJusquAuPlanDepuisPremierAppui(page);
    await page.waitForTimeout(100);
    profils.push(await arreterProfil(cdp));
    const images = await imagesLonguesDepuis(page, avant);
    log(`Planches (base prête), répétition ${String(i + 1)} : ${ms(r.ms)} ms`);
    for (const im of images.filter((x) => x.debut <= r.plan + 50)) log(`  ${decrireImage(im)}`);
  }
  log('profil cumulé (5 taps, CPU ×4, temps propre) :');
  for (const l of additionnerProfils(profils).slice(0, 25)) log(`  ${l.ms.toFixed(1)} ms  ${l.fonction}`);

  // b) Défilement : dix passages, comme plan.e2e.ts (40 px par image).
  const defilement = page.getByTestId('plan-defilement');
  await expect(page.getByTestId('barre').first()).toBeVisible();
  const pires: string[] = [];
  const profilsDefilement: LigneProfil[][] = [];
  const toutesImages: ImageLongue[] = [];
  for (let i = 0; i < 10; i += 1) {
    await defilement.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(200);
    const avant = await page.evaluate(() => performance.now());
    await demarrerProfil(cdp);
    const intervalles = await defilement.evaluate(
      (el) =>
        new Promise<number[]>((fini) => {
          const ecarts: number[] = [];
          let precedent = -1;
          const image = (t: number) => {
            if (precedent >= 0) ecarts.push(t - precedent);
            precedent = t;
            const max = el.scrollHeight - el.clientHeight;
            if (el.scrollTop >= max - 1) {
              fini(ecarts.slice(2));
              return;
            }
            el.scrollTop = Math.min(max, el.scrollTop + 40);
            requestAnimationFrame(image);
          };
          requestAnimationFrame(image);
        }),
    );
    profilsDefilement.push(await arreterProfil(cdp));
    const images = await imagesLonguesDepuis(page, avant);
    toutesImages.push(...images);
    const pire = Math.max(...intervalles);
    const au_dela = intervalles.filter((x) => x > 58).length;
    pires.push(`passage ${String(i + 1)} : pire ${pire.toFixed(1)} ms, ${String(intervalles.length)} images, ${String(au_dela)} au-delà de 58 ms, images longues (>50 ms) : ${String(images.length)}`);
  }
  log('défilement, 10 passages :');
  for (const p of pires) log(`  ${p}`);
  log('les 10 pires images longues du défilement :');
  for (const im of [...toutesImages].sort((a, b) => b.duree - a.duree).slice(0, 10)) log(`  ${decrireImage(im)}`);
  log('profil cumulé du défilement (10 passages, CPU ×4, temps propre) :');
  for (const l of additionnerProfils(profilsDefilement).slice(0, 25)) log(`  ${l.ms.toFixed(1)} ms  ${l.fonction}`);
  expect(MARQUE_PLAN).toBe('planif:plan-affiche');
});

function decrireImage(im: ImageLongue): string {
  const scripts = im.scripts
    .filter((s) => s.duree >= 1)
    .map((s) => `${s.source} ${s.duree.toFixed(0)} ms${s.miseEnPageForcee > 0 ? ` (mise en page forcée ${s.miseEnPageForcee.toFixed(0)})` : ''}`)
    .join(' | ');
  return `image ${ms(im.debut)} ms : ${im.duree.toFixed(0)} ms, rendu ${im.rendu.toFixed(0)} ms, style+mise en page ${im.styleEtMiseEnPage.toFixed(0)} ms ; scripts : ${scripts === '' ? 'aucun' : scripts}`;
}

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ralentirCpu } from './outils.ts';
import { amorcer, rangerSession } from './plan-performances-outils.ts';

/**
 * T11e — « Double téléchargement à la première visite » (docs/backlog/T11e-plan-performances.md).
 * Question : PowerSync et le WASM de SQLite (assets/sqlite/, ≈ 2,35 Mo dont 2,26 Mo de WASM)
 * sont-ils reçus deux fois du réseau, une fois par la page (ouverture de la base) et une fois par
 * le précache du service worker ?
 *
 * Mesure (docs/mesures/T11e-avant.md) : NON. Le précache de Workbox demande les fichiers hachés
 * sans `cache: 'reload'` (révision nulle) : le cache HTTP du navigateur les lui rend, corps vide
 * côté réseau (0 octet), dans les deux cas ci-dessous. Ce test est donc une GARDE, qui passe
 * aujourd'hui : il échouera si un réglage (révision des fichiers, en-têtes de cache, cache vidé
 * entre la page et le précache) fait retélécharger ces 2,3 Mo, le plus souvent au champ, en 4G.
 *
 * Deux cas, chacun dans un contexte de navigateur neuf, base locale déjà amorcée (jeu de T07),
 * cache HTTP vidé après l'amorçage, CPU ×4 :
 *   A. session et base déjà là à la première visite de l'appli : la page ouvre la base (PowerSync,
 *      worker, WASM) tout de suite, le service worker s'enregistre au repos puis précache ;
 *   B. connexion pendant l'installation : première visite sans session, puis rechargement
 *      connecté dès que l'enregistrement du service worker est lancé.
 * Pour chaque fichier de assets/sqlite/ : la somme des corps reçus du réseau (hors réponses
 * servies par le service worker) ne dépasse pas la taille du fichier : aucun octet deux fois.
 *
 * Limite connue : Playwright ne distingue pas une réponse du cache HTTP d'une réponse du réseau
 * autrement que par la taille du corps reçu (0 octet depuis le cache) ; c'est ce qu'on compte.
 */

/** Attente maximale des tailles des requêtes relevées. */
const ATTENTE_RELEVES_MS = 10_000;

interface Releve {
  readonly url: string;
  readonly precache: boolean;
  readonly depuisSw: boolean;
  readonly corps: number;
}

function suivre(contexte: BrowserContext): { releves: Releve[]; attendre: () => Promise<void> } {
  const releves: Releve[] = [];
  const enCours: Promise<void>[] = [];
  contexte.on('requestfinished', (r) => {
    enCours.push(
      (async () => {
        // Seuls les fichiers de la base comptent ; une requête d'une page rechargée peut ne
        // jamais rendre ses tailles : elle ne bloque pas le test (attente bornée plus bas).
        if (!r.url().includes('/assets/sqlite/')) return;
        const reponse = await r.response();
        const tailles = await r.sizes();
        releves.push({ url: r.url(), precache: r.serviceWorker() !== null, depuisSw: reponse?.fromServiceWorker() ?? false, corps: tailles.responseBodySize });
      })().catch(() => undefined),
    );
  });
  return {
    releves,
    attendre: async () => {
      await Promise.race([
        Promise.all(enCours),
        new Promise<void>((fin) => {
          setTimeout(fin, ATTENTE_RELEVES_MS);
        }),
      ]);
    },
  };
}

async function installeeEtBasePrete(page: Page): Promise<void> {
  await expect(page.getByTestId('app')).toHaveAttribute('data-base', 'prete', { timeout: 60_000 });
  // Précache terminé : le service worker s'active (clientsClaim) une fois l'installation finie.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 60_000 });
}

for (const cas of ['A : session et base déjà là', 'B : connexion pendant l’installation'] as const) {
  test(`première visite, ${cas} : aucun octet de PowerSync ni du WASM reçu deux fois`, async ({ browser }) => {
    test.setTimeout(300_000);
    const contexte = await browser.newContext();
    try {
      const page = await contexte.newPage();
      const jeu = await amorcer(page);
      const sessionDAbord = cas.startsWith('A');
      if (sessionDAbord) await rangerSession(page, jeu.utilisateurId);
      const cdp = await contexte.newCDPSession(page);
      await cdp.send('Network.clearBrowserCache');
      await ralentirCpu(page);
      const { releves, attendre } = suivre(contexte);

      await page.goto('/');
      if (!sessionDAbord) {
        await page.waitForFunction(() => performance.getEntriesByName('planif:sw-enregistre', 'mark').length > 0, undefined, { timeout: 30_000 });
        await rangerSession(page, jeu.utilisateurId);
        await page.reload();
      }
      await installeeEtBasePrete(page);
      await page.waitForTimeout(2_000);
      await attendre();

      const sqlite = releves.filter((r) => r.url.includes('/assets/sqlite/'));
      const wasm = sqlite.filter((r) => r.url.endsWith('.wasm'));
      expect(wasm.length, 'le WASM de SQLite a bien été demandé').toBeGreaterThan(0);
      expect(
        wasm.some((r) => r.precache),
        'le précache a bien demandé le WASM (sinon le test ne mesure rien)',
      ).toBe(true);

      const recus = new Map<string, number[]>();
      for (const r of sqlite) {
        if (r.depuisSw || r.corps === 0) continue;
        recus.set(r.url, [...(recus.get(r.url) ?? []), r.corps]);
      }
      const doublons = [...recus].filter(([, corps]) => corps.length > 1).map(([url, corps]) => `${url.split('/').pop() ?? url} : ${corps.join(' + ')} octets`);
      const total = [...recus.values()].flat().reduce((s, n) => s + n, 0);
      console.log(`cas ${cas} : ${String(total)} octets de assets/sqlite/ reçus du réseau ; en double : ${doublons.length === 0 ? 'aucun' : doublons.join(', ')}`);
      expect(doublons, 'fichiers de PowerSync ou de SQLite reçus deux fois du réseau').toEqual([]);
    } finally {
      await contexte.close();
    }
  });
}

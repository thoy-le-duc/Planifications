import { test } from '@playwright/test';
import { amorcerEtOuvrir, bandeauEntier, CAS, contenuSansDefilement, DELAI_AMORCAGE_MS, descendreJusquauBout, glisser, molette, PAS_PX, planVisibleDEmblee, sansDebordement, VUES } from './plan-defilement-outils.ts';

/**
 * T50 : Planches défile au doigt jusqu'à la dernière planche, téléphone simulé (écran tactile,
 * appareil mobile), sans défilement horizontal. Démarche : plan-defilement-outils.ts.
 */

test.use({ hasTouch: true, isMobile: true });

for (const cas of CAS) {
  for (const vue of VUES) {
    const titre = `${cas.nom}, ${String(vue.width)} × ${String(vue.height)}`;
    test(`Planches défile au doigt jusqu’à la dernière planche : ${titre}`, async ({ page }) => {
      test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
      await page.setViewportSize(vue);
      await amorcerEtOuvrir(page, cas);
      await sansDebordement(page);
      await planVisibleDEmblee(page);
      await contenuSansDefilement(page);
      if (cas.bandeau) await bandeauEntier(page);
      const cdp = await page.context().newCDPSession(page);
      await descendreJusquauBout(page, (x, y) => glisser(cdp, x, y, PAS_PX), titre);
      await sansDebordement(page);
    });
  }
}

// Le chemin d'un test WebKit (Safari iOS, pas installé ici ni en CI), rejoué dans Chromium.
for (const cas of CAS.filter((c) => c.bandeau)) {
  test(`Planches défile au point du pouce (chemin de WebKit) : ${cas.nom}, 390 × 844`, async ({ page }) => {
    test.setTimeout(DELAI_AMORCAGE_MS + 120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await amorcerEtOuvrir(page, cas);
    await descendreJusquauBout(page, (x, y) => molette(page, x, y), `molette, ${cas.nom}`);
    await sansDebordement(page);
  });
}

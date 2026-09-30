# T20 — Main verte : service worker après le premier affichage, mesures e2e stables

**Objectif** : la CI de `main` repasse au vert et y reste, sans relever aucun budget.

**Dépend de** : T11
**Périmètre** : `apps/web/vite.config.ts`, `apps/web/src/main.tsx` (ou le point d'entrée), `apps/web/e2e/demarrage.e2e.ts`, `apps/web/e2e/plan.e2e.ts`, `apps/web/e2e/mesure-sqlite.e2e.ts`, `apps/web/e2e/outils*` (ou l'utilitaire de mesure commun)

## Constat (CI de main, 30 septembre)

- **Précache avant le premier affichage.** `mesure-sqlite.e2e.ts` : `assets/sqlite/worker-*.js` précaché 17 ms avant la marque de premier affichage. Le service worker est enregistré par le script injecté de vite-plugin-pwa, au `load` de la fenêtre. Sur une machine lente, `load` arrive avant le premier affichage de l'appli (écrans chargés à la demande), et le précache de 2,8 Mio concurrence l'affichage. C'est un vrai défaut.
- **Réouverture hors ligne** mesurée une seule fois, autour de 300 ms, sur une machine partagée :
  - `demarrage.e2e.ts` : 287 ms, puis 307 ms ;
  - `plan.e2e.ts`, base remplie : 321 ms ;
  - en local, seul : 185 à 280 ms.
  Une seule mesure ne permet pas de distinguer la charge de la machine d'une vraie régression.

## Règles

- **Service worker enregistré après le premier affichage** de l'appli, et au repos (`requestIdleCallback`, avec un repli), jamais au `load`. Première visite : l'appli s'affiche d'abord, puis elle précache. Le hors-ligne dès la deuxième visite reste garanti (tests existants de réouverture hors ligne).
- **Mesures de temps e2e en médiane** : chaque mesure de temps d'écran (réouverture hors ligne, Planches, démarrage à froid) est prise 5 fois, et c'est la médiane qui est comparée au budget. Budgets inchangés (300 ms, 1 s, 50 ms par image). Le journal du test affiche les 5 valeurs.
- Si une médiane dépasse encore le budget en CI, ce n'est plus du bruit : chercher ce qui coûte (profil sur CPU ×4) et le corriger, sans relever le budget.

## Critères d'acceptation

- [ ] `mesure-sqlite.e2e.ts` passe sans tolérance ajoutée : aucune requête du précache ne commence avant la marque de premier affichage.
- [ ] Un test vérifie que le service worker n'est pas enregistré avant la marque de premier affichage, et qu'il l'est ensuite (précache terminé, réouverture hors ligne OK).
- [ ] Les mesures de réouverture hors ligne et de Planches utilisent la médiane de 5 ; budgets identiques.
- [ ] `pnpm verif` vert trois fois de suite en local, et CI verte sur la PR puis sur `main`.

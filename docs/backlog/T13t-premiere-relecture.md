# T13t — Aujourd'hui : la première relecture après « Fait » est lente

**Objectif** : que la saisie apparaisse dans l'historique en moins de 500 ms dès le premier « Fait » sur une grande ferme, sans pic au-dessus de 750 ms.

**Dépend de** : T11f
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`, `apps/web/e2e/aujourdhui-grande-ferme.e2e.ts`

## Constat (T11f, 2026-10-11)

`aujourdhui-grande-ferme.e2e.ts`, étape « relecture après « Fait » » (budget 500 ms) : la première répétition prend 1,1 à 2,4 s (déjà avant T11f), les suivantes 150 à 800 ms ; médiane 388 à 457 ms. Le garde-fou de T11f (maximum ≤ 1,5 fois le budget) n'est pas encore appliqué à cette série : seule la médiane est exigée.

## Règles

- Trouver ce qui coûte à la première relecture (profil sous CPU ×4 : préparation de requêtes, cache froid, recalcul complet ?) et le corriger ; aucun budget relevé.
- Rétablir le garde-fou complet (`jugerSerie(...).raisons` vide) sur cette série.

## Critères d'acceptation

- [ ] e2e : `expect(jugerSerie(serie, BUDGET_RELECTURE_MS).raisons).toEqual([])` sur la relecture après « Fait », dix passages.
- [ ] `pnpm verif` passe en entier.

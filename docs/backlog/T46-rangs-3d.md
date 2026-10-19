# T46 — Matérialiser l'écart entre rangs dans la vue 3D

**Objectif** : demande de Théophane (2026-10-19) : « la distance entre rangs, faut la matérialiser aussi ». Depuis T43, l'écart entre rangs est une vraie donnée de l'itinéraire (copiée dans l'instantané de la série), mais la vue 3D répartit toujours les rangs en bandes égales sur la largeur de la planche.

**Dépend de** : T43, T35b (quinconce), T37b (rendu au téléphone)
**Périmètre** : `apps/web/src/ecrans/plan3d/**` (placement des plants : `plants.ts`, `donnees-plants.ts`…), démo si elle doit montrer un écart, tests, `apps/web/budget.json` seulement si justifié
**Priorité** : normale.

## Règle

1. Quand la série (instantané de l'itinéraire) porte `ecartEntreRangsCm`, les rangs sont placés à cet écart, **centrés** sur la planche ; en quinconce, le décalage sur le rang est inchangé. Sans valeur : comportement actuel (bandes égales).
2. Rangs qui dépasseraient la planche (rangs − 1) × écart > largeur : rester fidèle à l'écart saisi mais ne jamais dessiner hors de la planche (resserrer au bord) — et ne pas planter l'affichage.
3. Les rangs se voient : de près, une ligne de rang discrète (sillon ou ligne de goutte-à-goutte) sous les plants, sans ajouter d'appels de dessin au-delà du budget du téléphone (`APPELS_DESSIN_MAX_ETROIT`, une seule géométrie instanciée).
4. Performance : budgets de la vue 3D (poids `jsVue3dGzKio`, temps d'affichage, appels de dessin) tenus ; démarrage inchangé.

## Critères d'acceptation

- [x] Test : 4 rangs à 18 cm sur une planche de 75 cm → positions centrées à −27, −9, 9, 27 cm (à la tolérance près) ; sans valeur → bandes égales comme avant.
- [x] Test : écart trop grand → aucun plant hors de la planche.
- [x] Test : quinconce conservé avec un écart saisi.
- [x] e2e de la vue 3D et budgets verts ; `pnpm verif` passe.

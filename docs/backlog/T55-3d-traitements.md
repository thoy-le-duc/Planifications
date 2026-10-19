# T55 — Jumeau 3D : traitements et délai avant récolte visibles

**Objectif** : le jumeau 3D sert à dire aux ouvriers « vous faites ça, là » (Q36, T37). Une planche traitée ne doit pas être récoltée par erreur : dans la 3D, les **emplacements sous délai avant récolte** portent un repère clair, et les **traitements du jour** apparaissent dans les travaux numérotés.

**Dépend de** : T52 (traitements et DAR), T37 (travaux du jour en 3D)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, tests
**Priorité** : moyenne, juste après T52. **Modèle** : Opus (performance 3D).

## Règles

1. Un emplacement sous DAR à la date affichée porte un repère « Ne pas récolter » (couleur dédiée, lisible en vue d'ensemble, distincte de la balise « à récolter ») ; le tap ouvre « Récolte interdite jusqu'au JJ/MM (Produit) ».
2. Quand la balise « à récolter » et le DAR tombent ensemble, le DAR l'emporte.
3. Les traitements prévus ou réalisés du jour s'ajoutent aux travaux du jour numérotés (T37).
4. Le curseur de date de la 3D fait apparaître et disparaître le repère selon la date.
5. Budgets : poids de la vue 3D et temps d'affichage inchangés, ou relevés avec justification.

## Critères d'acceptation

- [ ] Tests : emplacement traité le 10/05, DAR 3 j → repère les 10, 11 et 12/05, absent le 13/05.
- [ ] Test : DAR prioritaire sur « à récolter ».
- [ ] Test : le traitement du jour figure dans la liste numérotée.
- [ ] Budget `jsVue3dGzKio` respecté ; `pnpm verif` passe.

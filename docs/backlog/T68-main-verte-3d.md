# T68 — Main verte : la vue 3D de la grande ferme au repos après T55

**Objectif** : depuis la fusion de T55 (PR #221, 35a8d99), `e2e/vue-3d-jumeau.e2e.ts:214` est rouge par intermittence en CI (part 4/4) à l'étape « rendu à la demande : au repos, aucune image n'est dessinée » (6 images, puis 7 pendant la seconde de repos). Main était verte sur 3dd0cd0. Retrouver la cause dans le code de T55 et la corriger, sans relever de seuil ni toucher aux tests de fluidité.

**Dépend de** : T55
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/src/ecrans/aujourdhui/dar.ts` et son test de plan
**Priorité** : urgente (règle « main verte » de `docs/boucle.md`).

## Règles

1. Mesurer main et 3dd0cd0 dans les mêmes conditions, en alternance, et attribuer l'écart à un code précis.
2. Corriger dans le code ; aucun seuil relevé, aucun test de fluidité modifié.
3. L'échec de `aujourdhui-grande-ferme.e2e.ts` (« Execution context was destroyed ») est noté seulement s'il existe aussi sur 3dd0cd0.

## Critères d'acceptation

- [x] Cause chiffrée : lectures de traitements ajoutées par T55 pendant l'ouverture et le défilé des semaines.
- [x] Tests de plan d'abord (rouges), puis correctifs : les deux requêtes ne relisent plus les traitements de la ferme.
- [x] Typage, lint, tests plan3d et Aujourd'hui, build des essais, budgets, e2e vue-3d*.

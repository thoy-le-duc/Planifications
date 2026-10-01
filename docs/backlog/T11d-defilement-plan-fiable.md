# T11d — Mesure du défilement du plan : fiable sans relever la limite

**Objectif** : le test e2e de fluidité du défilement de Planches (`apps/web/e2e/plan.e2e.ts`) ne doit plus échouer au hasard, sans affaiblir ce qu'il garantit.

**Dépend de** : T11, T20
**Périmètre** : `apps/web/e2e/plan.e2e.ts`, `apps/web/e2e/` (outils de mesure)

## Constat

- Échecs observés quatre fois depuis T22 (66,7 ms, 66,7 ms, 50,1 ms pour une limite de 50 ms), toujours sous charge (deux agents sur la machine) ; relancé seul, il passe (33,4 à 50,0 ms).
- La limite de 50 ms tombe pile sur trois images à 60 Hz (3 × 16,7 ms) : un seul intervalle de trois images suffit à échouer, d'où les échecs à 50,1 ms.
- La mesure retient le **pire** intervalle d'un seul passage.

## Piste

Mesurer comme T20 : plusieurs passages, et une statistique robuste (par exemple le 95e centile des intervalles, ou le pire intervalle médian sur 5 passages), avec une limite exprimée en images (« jamais plus de 2 images perdues d'affilée au 95e centile »). Toute nouvelle limite se justifie dans la PR ; elle ne doit pas laisser passer un vrai saccadement (test témoin : un défilement volontairement ralenti doit échouer).

## Critères d'acceptation

- [ ] 20 passages de suite sans échec sur la machine de CI chargée par un second e2e.
- [ ] Un témoin de saccadement volontaire échoue.

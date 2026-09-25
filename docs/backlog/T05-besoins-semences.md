# T05 — Besoins en semences et en plants

**Objectif** : savoir combien de graines, de mottes et de plants commander pour la saison, série par série puis au total par variété.

**Dépend de** : T01
**Périmètre** : `packages/core/src/planification/besoins.ts` et ses tests

## Règles métier

Paramètres : longueur de la série (m), rangs par planche, écartement entre plants sur le rang (cm), graines par poquet ou par motte, taux de germination (%), marge de sécurité (%), poids de mille graines (g).

- Plants en place = ⌊longueur en cm ÷ écartement⌋ × rangs.
- Semis direct : graines = ⌈plants × graines par poquet × (100 + marge) × 100 ÷ (100 × germination)⌉.
- Plant maison : mottes = ⌈plants × (100 + marge) ÷ 100⌉ ; graines = ⌈mottes × graines par motte × 100 ÷ germination⌉.
- Plant acheté : plants à commander = ⌈plants × (100 + marge) ÷ 100⌉.
- Poids de semences (g) = graines × poids de mille graines ÷ 1 000, arrondi au dixième supérieur.
- **Tout en nombres entiers jusqu'à l'arrondi final** : en JavaScript, `100 * 1.1` vaut `110.00000000000001`, ce qui donnerait 111 mottes au lieu de 110.

| Cas | Données | Résultat attendu |
| --- | --- | --- |
| Carotte, semis direct | 30 m, 4 rangs, 3 cm, 1 graine/poquet, germination 80 %, marge 10 %, PMG 1,2 g | 4 000 plants, 5 500 graines, 6,6 g |
| Batavia, plant maison | 30 m, 3 rangs, 30 cm, 1 graine/motte, germination 90 %, marge 10 % | 300 plants, 330 mottes, 367 graines |
| Piège d'arrondi | 100 plants, marge 10 %, plant acheté | 110 plants à commander, pas 111 |

## Critères d'acceptation

- [ ] `besoinsSerie(parametres, longueur)` et `besoinsSaison(series)` qui agrège par variété et par semaine de semis (ou de plantation pour les plants achetés).
- [ ] Les trois cas du tableau en test, plus : longueur non multiple de l'écartement (arrondi à l'inférieur des plants), germination 100 %, marge 0 %.
- [ ] Aucun nombre à virgule flottante avant l'arrondi final (revue de code + test du piège d'arrondi).

**Hors périmètre** : stocks de semences, commandes fournisseurs, interface.

**À confirmer par Théophane** : les formules ci-dessus (voir `docs/questions.md`).

# T05 — Besoins en semences et en plants

**Objectif** : savoir combien de graines, de mottes, de plaques et de plants commander pour la saison, série par série puis au total par variété, quelle que soit la façon dont la ferme compte ses densités.

**Dépend de** : T01
**Périmètre** : `packages/core/src/planification/besoins.ts` et ses tests

## Règles métier

Chaque itinéraire choisit **une façon de compter la densité** ; les fermes ne comptent pas toutes pareil.

| Façon de compter | Paramètres | Ce qu'on en tire |
| --- | --- | --- |
| Écartement | rangs par planche, écartement sur le rang (cm) | plants (ou mottes) en place = ⌊longueur en cm ÷ écartement⌋ × rangs |
| Au mètre linéaire | rangs par planche, graines par mètre de rang | graines = longueur × rangs × graines par mètre |
| À la volée | largeur semée (cm), dose (g/m²) | poids = surface × dose |

Puis, selon le mode de l'itinéraire :

- **Semis direct à l'écartement** : graines = plants × graines par poquet ÷ germination, plus la marge.
- **Semis direct au mètre linéaire** : la densité compte déjà la germination ; seule la marge s'ajoute.
- **Plant maison** :
  - mottes à planter = mottes en place + marge ;
  - mottes à semer = mottes à planter ÷ (1 − perte en pépinière) ;
  - graines = mottes à semer × graines par motte ÷ germination ;
  - plaques = mottes à semer ÷ alvéoles par plaque, arrondi au-dessus ;
  - plants en place = mottes en place × plants par motte (1 par défaut ; oignons en mottes : plusieurs).
- **Plant acheté** : plants à commander = plants en place + marge.
- **Poids de semences** (g) = graines × poids de mille graines ÷ 1 000, arrondi au dixième supérieur.
- Tout arrondi se fait au-dessus, sauf les plants en place (au-dessous : on ne plante pas une fraction de plant).
- **Calcul en nombres entiers jusqu'à l'arrondi final** (longueurs en cm, pourcentages entiers) : en JavaScript, `100 * 1.1` vaut `110.00000000000001`, ce qui donnerait 111 mottes au lieu de 110.

| Cas | Données | Résultat attendu |
| --- | --- | --- |
| Carotte, semis direct à l'écartement | 30 m, 4 rangs, 3 cm, 1 graine/poquet, germination 80 %, marge 10 %, PMG 1,2 g | 4 000 plants, 5 500 graines, 6,6 g |
| Carotte, semis direct au mètre linéaire | 30 m, 4 rangs, 60 graines/m, marge 10 %, PMG 1,2 g | 7 920 graines, 9,6 g |
| Batavia, plant maison | 30 m, 3 rangs, 30 cm, 1 graine/motte, germination 90 %, marge 10 %, perte 0 % | 300 plants, 330 mottes, 367 graines |
| Batavia, avec perte en pépinière et plaques | idem, perte 5 %, plaques de 104 alvéoles | 348 mottes à semer, 387 graines, 4 plaques |
| Oignon en mottes | 30 m, 4 rangs, 25 cm entre mottes, 4 plants/motte, 6 graines/motte, germination 85 %, marge 10 % | 480 mottes en place, 1 920 plants, 528 mottes, 3 728 graines |
| Engrais vert à la volée | 30 m × 80 cm, 15 g/m², marge 0 % | 360 g |
| Piège d'arrondi | 100 plants, marge 10 %, plant acheté | 110 plants à commander, pas 111 |

## Critères d'acceptation

- [ ] `besoinsSerie(itineraire, longueur)` et `besoinsSaison(series)` qui agrège par variété et par semaine de semis (ou de plantation pour les plants achetés).
- [ ] Les sept cas du tableau en test, plus : longueur non multiple de l'écartement, germination 100 %, marge 0 %.
- [ ] Le type de l'itinéraire rend impossible un paramétrage incohérent (par exemple une dose à la volée sur un plant maison).
- [ ] Aucun nombre à virgule flottante avant l'arrondi final (revue de code + test du piège d'arrondi).

**Hors périmètre** : stocks de semences, commandes fournisseurs, interface.

Formules validées dans le principe par Théophane (Q7) ; les façons de compter couvrent les pratiques courantes pour s'adapter à toutes les fermes. Un cas de ferme qui n'entre dans aucune se signale dans `docs/questions.md`.

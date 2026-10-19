# T42b — Suites de T42 : ordre et cohérence agronomique des travaux de la bibliothèque

**Objectif** : relecture de T42 (PR #198). Corriger, par une nouvelle migration de bibliothèque (mécanique de T41b), quatre maladresses des travaux prévus, avant que Théophane relance `migrer` (une seule mise à jour pour lui).

**Dépend de** : T42
**Périmètre** : `packages/db/bibliotheque/depart.json`, nouvelle migration `0035_…` générée par l'outil, `packages/db/src/*.test.ts`, `apps/web/src/ecrans/itineraires/schema-rangs.ts` (point 5), `packages/db/src/bibliotheque.test.ts` (point 6), journal
**Priorité** : haute (avant la mise à jour de la base de production).

## Règle

1. **Carotte botte** : ordre compost → grelinette → occultation → préparation (râteau) à J−1, au lieu d'une occultation avant le travail du sol (qui remonterait des graines d'adventices).
2. **Carottes (et toute culture où un filet est posé au semis puis un désherbage thermique prévu)** : filet anti-insectes posé **après** le passage thermique (J+7 environ), jamais avant.
3. **Éclaircissage de la carotte et du navet** semés graine à graine : retiré, ou gardé seulement si la densité réelle le justifie ; dans tous les cas, l'expliquer dans « à vérifier ».
4. **Cultures paillées en toile tissée** (tomate, aubergine, poivron, piment, concombre) : désherbage limité au trou de plantation et au passe-pied, fréquence réduite (tous les 30 à 45 jours au plus).
5. **Une seule largeur par défaut** de planche dans `schema-rangs.ts` (75 cm), plus de 120 cm résiduel.
6. Le contrôle « clés interdites » de `bibliotheque.test.ts` couvre de nouveau l'intérieur des travaux (sauf `categorie`, légitime).

## Critères d'acceptation

- [ ] Tests : ordre des travaux de la carotte botte ; filet après le désherbage thermique ; plus d'éclaircissage injustifié ; fréquence de désherbage sur toile ≥ 30 jours.
- [ ] Test d'intégration : la migration 0035 ne touche que la bibliothèque, rejouable.
- [ ] Aucune trace de Masterclass ; `pnpm verif` passe (ou étapes équivalentes).

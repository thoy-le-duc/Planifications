# T19 — Tests de temps robustes sous charge

**Objectif** : aucun test de performance ne doit échouer parce que la machine est occupée par autre chose, sans perdre ce qu'il vérifie.

**Dépend de** : —
**Périmètre** : `packages/sync/src/export.test.ts` (temps du premier export T15), et tout test de temps en temps mural relevé en CI

## Constat

Le test « premier export T15 en moins de 2,5 s » mesure un temps mural : 2,8 à 3,0 s quand deux équipes testent en parallèle, alors qu'il passe seul (relectures T14c et T15b). Même fragilité sur main.

## Règles

- Mesurer le temps CPU du processus (comme le test « fil jamais gelé » de T15b) ou lancer ces tests seuls, en série.
- Garder le même seuil de fond ; ne jamais le relever pour faire passer.

## Critères d'acceptation

- [ ] Le test passe dix fois de suite avec quatre boucles de calcul en parallèle sur la machine, et échoue toujours si l'export est rendu deux fois plus lent.

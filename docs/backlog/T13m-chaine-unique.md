# T13m — Une seule règle « chaîne d'une saisie »

**Objectif** : la règle qui dit si une saisie est annulée et quelle ligne est en vigueur n'existe qu'à un endroit, testée par comparaison aléatoire.

**Dépend de** : T13l, T13j
**Périmètre** : `packages/sync/src/fait-unique.ts`, `apps/web/src/ecrans/aujourdhui/ecritures.ts`, `apps/web/src/ecrans/aujourdhui/calculs.ts`

## Constat (relecture T13l)

- `SQL_CHAINE_DE` (ecritures.ts) refait pour une seule chaîne la règle de `chaines` (fait-unique.ts) et de `enVigueur` (calculs.ts). Une comparaison aléatoire (≈ 80 000 cas) montre qu'elles s'accordent aujourd'hui, mais elles divergeront à la prochaine retouche de la règle.
- `evenementDuJournal` (ecritures.ts) copie `evenementLu` (calculs.ts) en moins strict : ni étape, ni catégorie, ni libellé vide vérifiés, unité non normalisée.

## Règles

- `chaineDe(id)` rejoint `@planif/sync/fait-unique`, à côté de `chaines` ; `ecritures.ts` l'utilise.
- `evenementDuJournal` réutilise `detailLu` / `evenementLu` de calculs.ts.

## Critères d'acceptation

- [ ] Test de propriété aléatoire : `chaineDe`, `chaines` et `enVigueur` donnent la même chaîne annulée et la même ligne en vigueur (maillons manquants, horloges décalées, cycles).
- [ ] Plus aucune copie de la règle dans `ecritures.ts`.

# T13s — Horodatages de la table des modifications

## Objectif

Plus aucun tri d'horodatage en texte, y compris sur la table `modification`. Suite de T13n.

## Périmètre

- `apps/web/src/ecrans/serie/donnees.ts` (historique de la série, entrées des occupations) ;
- `apps/web/src/diagnostic/itineraires.ts` (historique des itinéraires) ;
- `apps/web/src/diagnostic/plan-serie.ts` (historique du plan de série) ;
- leurs tests.

## Règle

Même ordre (instant, id) que T13n : `cleHorodatageSql` (`packages/sync/src/fait-unique.ts`) en SQL, `comparerSaisies` (`packages/sync/src/horodatage.ts`) en JavaScript. Aucun index perdu.

## Critères d'acceptation

- Deux modifications à formats différents (`Z` / `+00`, `T` / espace, fractions) sont ordonnées par leur instant, à chacun des endroits ci-dessus.
- `pnpm verif` vert, aucun budget relevé (poids de l'écran Série et du morceau `fait`, voir `pnpm budget`).

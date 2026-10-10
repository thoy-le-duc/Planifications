# T13s — Horodatages : la table des modifications aussi (relecture T13q)

**Objectif** : plus aucun tri d'horodatage en texte, y compris sur la table `modification`.

**Dépend de** : T13q
**Périmètre** : `apps/web/src/ecrans/serie/donnees.ts`, `apps/web/src/diagnostic/itineraires.ts`, `apps/web/src/diagnostic/plan-serie.ts`, et leurs tests

## Constat (relecture T13q)

Des `ORDER BY horodatage` comparent encore le texte sur la table `modification` : `serie/donnees.ts` (~241, ~252), `diagnostic/itineraires.ts` (~115), `diagnostic/plan-serie.ts` (~142).

## Règles

- Même ordre (instant, id) que T13n : `cleHorodatageSql` en SQL, `comparerSaisies` en JS ; aucun index perdu (plans de requête vérifiés si une requête est sur un chemin chaud).

## Critères d'acceptation

- [ ] Tests : deux modifications à formats différents (`Z` / `+00`, `T` / espace, fractions) → ordre par l'instant, à chaque endroit.
- [ ] `pnpm verif` passe en entier.

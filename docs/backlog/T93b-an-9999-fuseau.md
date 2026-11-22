# T93b — Horodatages : « 9999-12-31 24 h » avec fuseau positif, illisible comme SQLite (relecture T93) — **critique** (synchro)

## Objectif

Dernier écart connu entre `instantHorodatage` (JavaScript) et `julianday` de SQLite, relevé par la relecture de T93. Aucune donnée réelle n'est concernée : ce ticket verrouille la règle pour que les deux côtés restent identiques.

## Dépend de

T93.

## Périmètre

- `packages/sync/src/horodatage.ts` (fonction `instantHorodatage`)
- `packages/sync/src/horodatage-instant.test.ts`
- `docs/backlog/README.md`, `docs/journal.md`

## Règles métier

Constat de la relecture (SQLite 3.54.1) : `9999-12-31T24:00`, `9999-12-31T24:00:00`, `9999-12-31T24:00:00.000`, suivis d'un fuseau positif (`+14:00`, `+02:00`, `+0530`), sont illisibles pour SQLite (`null`), qui refuse le passage au 10000-01-01 avant d'appliquer le fuseau. Le JavaScript donne 464269010400000.

1. Ces formes deviennent illisibles (0) en JavaScript aussi.
2. Les formes `9999-12-31T23:59:59.999Z` et `9999-12-31T24:00:00-05:00` gardent la valeur que leur donne SQLite (à mesurer dans le test).

## Critères d'acceptation

- [ ] Les formes ci-dessus sont dans la liste fixe `FORMES` et donnent le même instant en JavaScript et dans SQLite.
- [ ] `pnpm verif` passe en entier.

## Hors périmètre

Épingler la version de Node (Q53).

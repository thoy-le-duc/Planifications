# T93 — Main verte : « 24 h » lu comme SQLite 3.54 (horodatages) — **critique** (synchro)

## Objectif

Depuis Node 22.23.5 (`.node-version` vaut `22`, la CI prend la dernière 22.x), le SQLite embarqué passe en 3.54.1 et `julianday` refuse une heure « 24 » suivie de minutes, de secondes ou d'une fraction non nulles. Le test tiré au hasard de `packages/sync/src/horodatage-instant.test.ts` échoue alors à chaque run : la CI est rouge sur toute PR, même de documentation (PR #275, 22 novembre). Théophane gagne une `main` de nouveau verte, avec la même règle d'ordre des horodatages en JavaScript et en SQL.

## Dépend de

T13n, T13q (règle `instantHorodatage` / `cleHorodatageSql`).

## Périmètre

- `packages/sync/src/horodatage.ts` (fonction `instantHorodatage`)
- `packages/sync/src/horodatage-instant.test.ts`
- `docs/backlog/README.md`, `docs/journal.md`

## Règles métier

Constat mesuré avec `node:sqlite` (SQLite 3.54.1) :

| Horodatage | `julianday` |
| --- | --- |
| `2026-10-01T24:00:00Z`, `2026-10-01T24:00Z`, `2026-10-01T24:00:00.000Z`, `2026-10-01T24:00:00.0000000Z`, `2026-10-01 24:00 ` | lisible : minuit du lendemain (2461315,5) |
| `2026-10-01T24:00:00-05:30` | lisible (2461315,7291666665) |
| `2026-02-30T24:00:00Z` | lisible (2461102,5) |
| `2026-10-01T24:00:01Z`, `2026-10-01T24:01Z`, `2026-10-01 24:59:59`, `2026-10-01T24:00:00.5Z`, `2026-10-01T24:00:00.0001Z` | illisible (`null`) |

1. Une heure 24 n'est lisible que si minutes = 0, secondes = 0 et fraction nulle (tous ses chiffres à 0). Sinon `instantHorodatage` renvoie 0 (illisible), comme `cleHorodatageSql` lu par SQLite.
2. Toutes les autres formes gardent exactement leur instant actuel.
3. Aucun horodatage écrit par l'appli n'a la forme « 24:xx » (`toISOString` donne 00 à 23) : aucun effet sur les données réelles. Un SQLite plus ancien (téléphone) pourrait encore lire « 24:30 » : écart accepté sur des valeurs qui n'existent pas, à signaler dans la PR.

## Critères d'acceptation

- [ ] Les formes du tableau ci-dessus sont ajoutées à la liste fixe du test (`FORMES`) et donnent le même instant en JavaScript et dans SQLite.
- [ ] Le test « tirés au hasard » (graine 13, 2000 horodatages) passe sans être modifié.
- [ ] `pnpm verif` passe en entier.

## Hors périmètre

- Épingler la version de Node (Q53, en attente de Théophane).
- Toucher à `cleHorodatageSql` ou aux requêtes SQL.

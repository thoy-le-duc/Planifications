# T13o — Horodatages : les derniers endroits qui comparent du texte

**Objectif** : finir T13n (« partout ») : plus aucune règle ne compare des horodatages comme du texte.

**Dépend de** : T13n
**Périmètre** : `apps/web/src/ecrans/itineraires/donnees.ts`, `apps/web/src/diagnostic/stock-serie.ts`, `apps/web/src/ecrans/aujourdhui/calculs.ts` (fenêtre de l'historique), `packages/sync/src/horodatage.ts` et `fait-unique.ts` (réutilisation seulement)

## Constat (relecture T13n)

- `itineraires/donnees.ts:46` : `MAX(horodatage || '|' || id)` (même défaut que `chaines` avant T13n).
- `diagnostic/stock-serie.ts:248` : `ORDER BY r.horodatage DESC`.
- La fenêtre de l'historique (`e.horodatage >= ?` dans `sqlRecents`, `dansLaFenetre`) : une ligne serveur `2026-10-10 10:00:00+00` peut sortir de la fenêtre alors qu'elle y est.

## Règles

- Réutiliser `comparerSaisies` / `instantHorodatage` côté JS et `cleHorodatageSql` côté SQL : une seule règle, même ordre (instant, id).
- La fenêtre doit rester servie par un index (pas de SCAN du journal sur la grande ferme) : si la borne ne peut pas être comparée comme une date sans perdre l'index, élargir la fenêtre en SQL puis filtrer en JS par l'instant.

## Critères d'acceptation

- [ ] Test : itinéraires, deux corrections à formats différents (`Z`/`+00`, `T`/espace, fractions) → la plus récente gagne.
- [ ] Test : diagnostic stock-série, même cas → même ordre.
- [ ] Test : une ligne au format Postgres juste dans la fenêtre y figure ; juste hors de la fenêtre n'y figure pas.
- [ ] Plans de requête et budget `lireJournee` grande ferme (250 ms) tenus.
- [ ] `pnpm verif` passe en entier.

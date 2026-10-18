# T41b — Suites de T41 : migration de la bibliothèque figée, mise à jour par nouvelle migration

**Objectif** : relecture de T41 (PR #195). Aujourd'hui `pnpm --filter @planif/db bibliotheque` réécrit toujours `0032_bibliotheque_depart.sql`, et le test `bibliotheque.test.ts` force cette réécriture. Sur une base déjà migrée (la production de Théophane), drizzle ne rejoue pas 0032 : une valeur corrigée dans `depart.json` serait perdue sans un mot.

**Dépend de** : T41
**Périmètre** : `packages/db/src/bibliotheque*.ts`, `packages/db/src/ecrire-bibliotheque.ts`, `packages/db/bibliotheque/**`, `packages/db/migrations/**`, `packages/db/package.json`, `docs/modele-donnees.md`
**Priorité** : normale (avant toute correction de valeur de la bibliothèque).

## Règle

1. **0032 figée** : son contenu ne change plus jamais (un test compare son empreinte à une valeur inscrite dans le test).
2. **Mise à jour = nouvelle migration** : le script prend le nom de la migration cible ; il produit les `INSERT … ON CONFLICT (id) DO UPDATE` des lignes **de la bibliothèque** (`ferme_id IS NULL` seulement, jamais une ligne de ferme) dont la valeur a changé, et les nouvelles lignes. Une ligne retirée du JSON n'est pas supprimée (des séries peuvent la référencer) : elle est marquée supprimée (`supprime_le`).
3. Un test : modifier une valeur du JSON sans produire de nouvelle migration fait échouer la suite (le JSON courant doit être égal à « 0032 + migrations de bibliothèque suivantes »).
4. `package.json` de `@planif/db` gagne un script `test` (la relecture a noté qu'il n'en avait pas).
5. Melon : l'itinéraire « sous chenille » rangé en plein champ : le renommer « Melon, plein champ (chenille conseillée) » et le dire dans `aVerifier`, par la nouvelle mécanique (migration 0033), ce qui la teste en vrai.
6. `docs/modele-donnees.md` décrit la procédure de mise à jour.

## Critères d'acceptation

- [x] Test : empreinte de 0032 inchangée.
- [x] Test d'intégration Postgres : base migrée jusqu'à 0032, puis 0033 → l'itinéraire du melon est renommé, aucune ligne de ferme touchée, rejouable.
- [x] Test : JSON modifié sans migration → échec explicite.
- [x] `pnpm --filter @planif/db test` lance les tests du paquet ; `pnpm verif` passe (typage, lint, tests avec Postgres, build verts ; e2e web non relancés : rien ne change côté web).

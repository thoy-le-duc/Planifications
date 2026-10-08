# T10t — Parcellaire et catalogue : suites de la relecture

**Objectif** : fermer les écarts non bloquants trouvés par la relecture de T10s.

**Dépend de** : T10s
**Périmètre** : `apps/api/src/sync/structure*.ts`, `apps/api/src/sync/serie.ts`, `packages/db` (index), `docs/modele-donnees.md`

## Constat (relecture T10s)

- Pas de test positif pour une série terminée réactivée avec toutes ses lignes actives, ni pour un lot qui rétablit l'emplacement puis réactive la série ; pas de test de bord du fuseau (arrachage prévu le jour même autour de minuit à Paris).
- Suppressions qui laissent des lignes actives : une zone, une saison ou un emplacement supprimés laissent leurs assolements ; une espèce supprimée laisse ses variétés et ses itinéraires ; changer la famille d'une espèce rend incohérents les assolements existants.
- Unicité du code d'emplacement dans la ferme : prévue par le modèle, pas contrôlée (Q27).

## Critères d'acceptation

- [x] Les deux tests positifs et le test de bord du fuseau.
- [x] Règle écrite et testée pour chaque cas de lignes laissées actives (refus ou suppression en cascade, à trancher).
- [x] Q27 (réponse du 2026-10-07) : code d'emplacement unique par zone ; à l'import, un doublon donne un avertissement, pas un refus ; côté serveur, refus propre d'un doublon dans la même zone (index unique partiel `WHERE supprime_le IS NULL`).

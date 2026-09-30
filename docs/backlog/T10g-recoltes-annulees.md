# T10g — Récoltes annulées et plafonds définitifs

**Objectif** : appliquer les réponses Q20 et Q13.

**Dépend de** : T10d
**Périmètre** : `packages/core/src/saisies/**`, `apps/api/src/sync/stock.ts`, `apps/web/src/ecrans/aujourdhui/**`

## Règles

- **Q20 :** une récolte annulée ne se corrige plus. Le téléphone ne propose pas « Corriger » sur une récolte annulée, et le serveur refuse une correction dont l'origine est annulée (motif explicite). Pour rétablir, on saisit une nouvelle récolte.
- **Q20, conflit :** quand deux corrections de la même récolte arrivent, celle qui reste en vigueur est la plus récente selon l'heure du téléphone (`horodatage`), pas l'ordre d'arrivée ; égalité départagée par l'identifiant.
- **Q13 :** `PLAFONDS_PROVISOIRES` devient `PLAFONDS_SAISIES`, valeurs inchangées.

## Critères d'acceptation

- [ ] Test serveur : correction d'une récolte annulée refusée, stock inchangé.
- [ ] Test serveur : deux corrections hors ligne arrivées dans l'ordre inverse de leur heure ; la plus récente gagne, stock juste.
- [ ] Test d'écran : pas de « Corriger » sur une récolte annulée.

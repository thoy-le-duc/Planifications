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

## Décisions du chef (après les tests)

1. **Périmètre élargi** : `apps/api/src/sync/motifs.ts`, `upload.ts` (messages), `references.ts`, et une migration de `packages/db` pour la vue `evenements_en_vigueur`.
2. **Chaîne annulée** = toute annulation dans la chaîne (origine ou correction), comme le stock.
3. **Annuler une annulation** est refusé (`recolte_annulee`). L'annulation redondante de l'origine reste acceptée (T10d).
4. **« En vigueur » = la correction la plus récente de toute la chaîne** (horodatage du téléphone, puis identifiant), comme `lireChaine`. La vue `evenements_en_vigueur` et `enVigueur` du téléphone suivent cette règle, même quand la chaîne se ramifie.
5. Motif du refus d'une correction plus ancienne que celle en vigueur : libre, tant que le lot et le stock restent justes.
6. **Le serveur calcule lui-même l'écart de stock d'une correction ou d'une annulation de récolte.** Le mouvement envoyé par le téléphone (calculé sur sa chaîne locale, peut-être en retard) n'est plus comparé : le serveur écrit `quantité en vigueur après − quantité en vigueur avant` sous le verrou de la ferme, et la ligne corrigée redescend au téléphone par la synchro. Sinon, deux corrections hors ligne arrivées dans l'ordre de leur heure feraient gagner la plus ancienne, contraire à Q20. Une correction plus ancienne que celle en vigueur ne change rien au stock (écart nul ou refus, au choix du développeur, écrit dans le contrat).
7. **Hors périmètre** : corrections de réalisés et d'interventions ; décalage d'horloge (on suit l'heure du téléphone telle quelle).

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

## Décisions du chef (après la relecture)

8. **Le serveur écrit lui-même le mouvement d'écart** de toute correction ou annulation de récolte acceptée dont la chaîne a un article, sous le verrou de la ferme, que le téléphone ait envoyé un mouvement ou non :
   - si le téléphone en a envoyé un, sa ligne porte la quantité calculée par le serveur (comme aujourd'hui) ;
   - sinon, et si l'écart n'est pas nul, le serveur crée le mouvement avec un identifiant déterministe tiré de l'identifiant de l'événement (UUID v5), pour qu'un renvoi ne le double pas ;
   - un mouvement du téléphone qui arrive plus tard pour cet événement est accepté sans rien écrire de plus.
9. **Écart nul sur une correction acceptée** (deux téléphones qui corrigent à la même quantité) : la correction est acceptée ; son mouvement éventuel est accepté sans rien écrire. Le refus de T10d de l'annulation redondante qui porte un mouvement reste à part, inchangé.
10. **Suites, ticket T10h** : performance de la vue `evenements_en_vigueur` (récursion sur tout le journal : 4 s sur 200 000 événements), `EN_VIGUEUR` du semainier alignée, historique partiel du téléphone. À faire avant tout export lu côté serveur.

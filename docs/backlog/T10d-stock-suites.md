# T10d — Stock synchronisé : suites des relectures de T10c

**Objectif** : fermer les écarts non bloquants trouvés par les relectures de sécurité de T10c.

**Dépend de** : T10c
**Périmètre** : `apps/api/src/sync/**`, `packages/core/src/saisies/**`

## Règles

- **Correction antidatée.** Aujourd'hui, la correction « en vigueur » se lit sur l'horodatage envoyé par le téléphone, alors que le mouvement de correction se calcule sur la somme des mouvements.
  - Exemple : le téléphone A corrige 12 → 15 à 07:00. Le téléphone B, resté hors ligne, avait corrigé 12 → 100 à 04:00 et se synchronise après. Le serveur accepte +85 : le stock vaut 100 alors que la correction en vigueur dit 15.
  - Décision à prendre avec la réponse à Q20 : refuser une correction plus ancienne que celle en vigueur, ou prendre l'ordre d'arrivée au serveur. **Hors de ce ticket tant que Q20 est ouverte.**
- **Une correction garde la série et l'unité de l'origine** (vérifié au serveur).
- **Annulation redondante** (relecture T13) : deux téléphones annulent la même récolte hors ligne. La seconde annulation arrive avec −q alors que la chaîne est déjà à 0 : son lot est refusé et le refus est visible (T10). C'est le comportement voulu, le stock reste juste. Un test le fige ; un autre vérifie qu'une annulation redondante sans mouvement est acceptée.
- **Ferme vérifiée dans la même requête que le verrou `FOR SHARE`**, ici et dans `references.ts` (T10). Plus aucun indice de l'existence d'une ligne d'une autre ferme.
- **Lot trop gros** : l'API répond 200 avec des refus au lieu de 400 ou 413, pour que la file PowerSync ne se bloque jamais. La porte compte des ordres, pas des lignes : un ordre sur plusieurs lignes peut encore dépasser la limite.
- **Échelle `numeric(12,6)`** pour `mouvement_stock.quantite` (migration).

## Critères d'acceptation

- [ ] Un test par règle.

# T10d — Stock synchronisé : suites des relectures de T10c

**Objectif** : fermer les écarts non bloquants trouvés par les relectures de sécurité de T10c.

**Dépend de** : T10c
**Périmètre** : `apps/api/src/sync/**`, `packages/core/src/saisies/**`

## Règles

- **Correction antidatée.** Aujourd'hui, la correction « en vigueur » se lit sur l'horodatage envoyé par le téléphone, alors que le mouvement de correction se calcule sur la somme des mouvements.
  - Exemple : le téléphone A corrige 12 → 15 à 07:00. Le téléphone B, resté hors ligne, avait corrigé 12 → 100 à 04:00 et se synchronise après. Le serveur accepte +85 : le stock vaut 100 alors que la correction en vigueur dit 15.
  - Décision à prendre avec la réponse à Q20 : refuser une correction plus ancienne que celle en vigueur, ou prendre l'ordre d'arrivée au serveur. **Hors de ce ticket tant que Q20 est ouverte.**
- **Une correction garde la série et l'unité de l'origine** (vérifié au serveur).
- **Annulation redondante** (relecture T13) : deux téléphones annulent la même récolte hors ligne ; la seconde annulation arrive avec un mouvement devenu faux (−q au lieu de 0). Décision du chef : le serveur accepte une annulation redondante de l'événement, mais refuse son mouvement. Le lot est donc refusé tant qu'il porte un mouvement ; pour une annulation dont la chaîne est déjà à 0, le mouvement attendu est 0, et le téléphone n'en écrit pas (T13). Le test vérifie qu'une annulation redondante sans mouvement est acceptée.
- **Ferme vérifiée dans la même requête que le verrou `FOR SHARE`**, ici et dans `references.ts` (T10). Plus aucun indice de l'existence d'une ligne d'une autre ferme.
- **Lot trop gros** : l'API répond 200 avec des refus au lieu de 400 ou 413, pour que la file PowerSync ne se bloque jamais. La porte compte des ordres, pas des lignes : un ordre sur plusieurs lignes peut encore dépasser la limite.
- **Échelle `numeric(12,6)`** pour `mouvement_stock.quantite` (migration).

## Critères d'acceptation

- [ ] Un test par règle.

# T10d — Stock synchronisé : suites des relectures de T10c

**Objectif** : fermer les écarts non bloquants trouvés par les relectures de sécurité de T10c.

**Dépend de** : T10c
**Périmètre** : `apps/api/src/sync/**`, `packages/core/src/saisies/**`, `packages/db` (migration, `schema.ts`), `packages/sync/src/types.ts` (motif `lot_trop_gros`)

## Règles

- **Correction antidatée.** Aujourd'hui, la correction « en vigueur » se lit sur l'horodatage envoyé par le téléphone, alors que le mouvement de correction se calcule sur la somme des mouvements.
  - Exemple : le téléphone A corrige 12 → 15 à 07:00. Le téléphone B, resté hors ligne, avait corrigé 12 → 100 à 04:00 et se synchronise après. Le serveur accepte +85 : le stock vaut 100 alors que la correction en vigueur dit 15.
  - Décision à prendre avec la réponse à Q20 : refuser une correction plus ancienne que celle en vigueur, ou prendre l'ordre d'arrivée au serveur. **Hors de ce ticket tant que Q20 est ouverte.**
- **Une correction garde la série et l'unité de l'origine** (vérifié au serveur).
- **Annulation redondante** (relecture T13) : deux téléphones annulent la même récolte hors ligne. La seconde annulation arrive avec −q alors que la chaîne est déjà à 0 : son lot est refusé et le refus est visible (T10). C'est le comportement voulu, le stock reste juste. Un test le fige ; un autre vérifie qu'une annulation redondante sans mouvement est acceptée.
- **Ferme vérifiée dans la même requête que le verrou `FOR SHARE`**, ici et dans `references.ts` (T10). Plus aucun indice de l'existence d'une ligne d'une autre ferme.
- **Lot trop gros** : l'API répond 200 avec des refus au lieu de 400 ou 413, pour que la file PowerSync ne se bloque jamais. La porte compte des ordres, pas des lignes : un ordre sur plusieurs lignes peut encore dépasser la limite.
- **Échelle `numeric(12,6)`** pour `mouvement_stock.quantite` (migration).

## Décisions du chef (2026-09-30, après les tests)

- **Lot trop gros** : au-delà de 500 écritures, ou d'un corps de 5 Mio, le serveur répond 200 avec `lot_trop_gros` pour chaque écriture. Rien n'est écrit, et ce motif passe avant toute autre règle. Au-delà d'une limite dure de 32 Mio, il répond 413 et ne lit pas le corps.
- **Correction** : limitée aux récoltes. Corriger une récolte saisie sur la mauvaise série ou dans la mauvaise unité devient impossible : on l'annule puis on la ressaisit. À dire à Théophane.
- **Plus aucun indice d'existence** : un PATCH ou un DELETE sur une ligne existante d'une autre ferme répond exactement comme sur un id inexistant. Le test M1 de T10 est adapté en conséquence. Un `ferme_id` étranger déclaré par l'écriture elle-même garde `ferme_interdite`.
- **Tests existants adaptés** (T10, T10c) : les références étrangères passent de `ferme_interdite` à `ecriture_invalide`, et un lot trop gros reçoit 200 avec des refus au lieu de 400 ou 413.

## Critères d'acceptation

- [ ] Un test par règle.

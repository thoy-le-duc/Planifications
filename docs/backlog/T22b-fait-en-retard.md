# T22b — « Fait » sur un travail répété en retard

**Objectif** : taper « Fait » sur une carte en retard solde cette occurrence et les précédentes, jamais la suivante (Q24).

**Dépend de** : T22
**Périmètre** : `packages/core/src/planification/semainier.ts`, `travaux.ts`, `apps/web/src/ecrans/aujourdhui/**`

## Règles

- L'intervention écrite par « Fait » porte l'occurrence visée (date prévue) dans son détail, en plus de la date réelle.
- Une intervention avec occurrence visée solde cette occurrence et les précédentes.
- Une intervention sans occurrence visée (saisie libre, anciennes saisies) garde la règle actuelle : l'occurrence la plus proche.
- `validerSaisie` accepte le nouveau champ, facultatif, borné comme les autres dates.

## Critères d'acceptation

- [ ] Désherbage tous les 14 jours (17 et 31), « Fait » le 25 sur la carte du 17 : le 17 est soldé, le 31 reste dû.
- [ ] Une intervention sans occurrence visée se comporte comme avant.
- [ ] Le serveur accepte le nouveau détail (test de synchro).

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

## Décisions du chef (après les tests)

Interprétations du testeur retenues :
1. `detail.occurrenceVisee` (AAAA-MM-JJ ou null) : l'intervention solde l'occurrence la plus proche de l'occurrence visée (la plus ancienne à égalité) et les précédentes. Si les dates de la série sont recalées après coup, la carte touchée reste soldée.
2. Aucun lien imposé avec la date réelle : une carte de la semaine peut être faite en avance.
3. Champ permis seulement sur une intervention.
4. Champ facultatif : anciennes saisies et saisies libres gardent la règle de T22.

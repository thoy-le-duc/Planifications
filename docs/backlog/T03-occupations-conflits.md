# T03 — Occupations et conflits de place

**Objectif** : savoir, pour chaque emplacement, ce qui l'occupe et quand, et signaler tout de suite quand deux cultures se marchent dessus.

**Dépend de** : T02
**Périmètre** : `packages/core/src/planification/occupations.ts`, `packages/core/src/planification/conflits.ts` et leurs tests

## Règles métier

- Une occupation couvre l'intervalle de la mise en place à la fin de récolte, en dates réelles quand elles existent, sinon prévues. La pépinière n'occupe pas l'emplacement.
- On peut arracher et replanter le même jour : deux occupations se recouvrent seulement si l'une commence **avant** le jour où l'autre finit (`debutA < finB` et `debutB < finA`).
- Une couverture longue (bâche, occultation, solarisation) crée aussi une occupation.
- Une plantation pérenne occupe son emplacement de la plantation à l'arrachage (sans fin tant qu'elle n'est pas arrachée).
- **Conflit** sur un emplacement :
  - si les deux occupations ont une position sur la planche : leurs tronçons [début, début + longueur] se recouvrent pendant une période commune ;
  - sinon : à un moment donné, la somme des longueurs présentes dépasse la longueur de la planche (ou la somme des places dépasse le nombre de places d'une gouttière).
- Un emplacement inactif à la date d'une occupation est aussi un conflit (« emplacement supprimé »).

Exemple (planche de 30 m) : radis 0–30 m du `2027-03-01` au `2027-04-04`, batavia 0–15 m du `2027-04-05` au `2027-06-07`, batavia 15–30 m du `2027-04-19` au `2027-06-21` : **aucun conflit**. Ajouter une tomate 0–30 m à partir du `2027-06-01` : **conflit** avec les deux batavias, du `2027-06-01` au `2027-06-21`.

## Critères d'acceptation

- [ ] `occupationDeSerie(serie, emplacement, longueur, position?)` et `occupationDePlantation(...)`.
- [ ] `detecterConflits(emplacement, occupations)` renvoie la liste des conflits avec les occupations en cause et la période de recouvrement.
- [ ] L'exemple ci-dessus en test, plus : deux occupations sans position dont la somme vaut exactement la longueur (pas de conflit) ; les mêmes avec un mètre de trop (conflit) ; gouttière pleine ; occupation qui commence le jour où la précédente finit (pas de conflit) ; un jour plus tôt (conflit) ; pérenne sans date d'arrachage.
- [ ] 3 000 occupations réparties sur 400 emplacements analysées en moins de 50 ms (test de performance dans Vitest).

**Hors périmètre** : rotation (T04), affichage.

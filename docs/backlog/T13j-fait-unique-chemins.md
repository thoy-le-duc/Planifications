# T13j — « Fait » unique : tous les chemins d'écriture

**Objectif** : aucune écriture de réalisé ni d'intervention qui solde un travail prévu ne peut contourner la vérification « déjà fait », quel que soit le chemin.

**Dépend de** : T13i
**Périmètre** : `packages/sync/src/porte.ts`, `packages/sync/src/fait-unique.ts`, `packages/db` (index local, si retenu)

## Constat (relecture T13i)

- `preparerSaisie` suivi de `ecrireEnsemble` sans vérificateur, et `porte.ecrire` en SQL brut, écrivent un réalisé sans vérification. Aujourd'hui, seul l'écran Aujourd'hui emprunte ces chemins, et il passe la vérification ; la voix et l'agent les emprunteront.
- Une intervention qui solde un travail prévu (`occurrenceVisee`), saisie par `saisirEvenement`, n'est pas protégée. L'écran la protège.
- La branche `origine_id` de la vérification parcourt toute la plage de l'index `remplacement` : 4,7 à 5,4 ms sur la grande ferme en CPU normal, environ ×4 sur un téléphone, au moment du tap. Un index sur `origine_id` rendrait la recherche directe, mais alourdirait chaque écriture de synchro.

## Règles

- `preparerSaisie` rend aussi la vérification à appliquer, ou `ecrireEnsemble` refuse tout INSERT de réalisé préparé sans vérificateur.
- `saisirEvenement` vérifie aussi l'intervention qui solde un travail prévu, avec la même règle que l'écran.
- Mesurer la branche `origine_id` sur CPU ×4 ; ajouter l'index seulement si le refus dépasse 50 ms, en mesurant le coût sur la synchro.

## Critères d'acceptation

- [x] Test : un réalisé écrit par `preparerSaisie` + `ecrireEnsemble` sans vérificateur est refusé.
- [x] Test : une intervention qui solde un travail déjà soldé, par `saisirEvenement`, est refusée avec `DejaFait`.
- [x] Mesure CPU ×4 du refus sur la grande ferme, dans la PR.

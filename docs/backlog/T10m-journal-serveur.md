# T10m — Journal du serveur : la même règle partout

**Objectif** : aucune ligne du journal du serveur ne contient de valeur saisie ni de donnée personnelle, et aucune ne peut être falsifiée par un client.

**Dépend de** : T10j
**Périmètre** : `apps/api/src/app.ts`, `apps/api/src/**` (appels à `console.*`)

## Constat (contre-relecture T10j)

- `app.ts` journalise l'erreur brute d'un 500 (`console.error(erreur)`) : une erreur de la base non classée peut citer une valeur saisie.
- Les autres journaux de l'API n'utilisent pas encore le journal injectable et nettoyé de T10j (`ligneDeJournal`).

## Règles

- Un seul journal injectable pour toute l'API, avec le nettoyage de T10j (une ligne, sans contrôle ni séparateur).
- Une erreur inattendue est journalisée par son code, sa classe et sa pile, jamais par son message brut quand il peut venir de la base.

## Critères d'acceptation

- [ ] Test : une erreur 500 provoquée par une valeur piégée ne fait apparaître ni la valeur ni un retour à la ligne dans le journal.

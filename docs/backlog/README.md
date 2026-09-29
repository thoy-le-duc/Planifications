# Backlog

Un fichier par ticket. La boucle prend **le premier ticket « à faire » dont chaque dépendance est « fait » ou « en revue » avec une CI verte**, dans l'ordre du tableau (procédure complète dans `docs/boucle.md`). Un ticket « à préciser » attend une réponse de Théophane : ne pas le prendre, voir `docs/questions.md`.

Statuts : `à faire` → `en revue` (PR ouverte) → `fait` (fusionné dans `main`) ; `à préciser`.

## Phase 1 — Noyau

Critère de sortie : Théophane utilise l'appli chaque jour sur sa ferme pendant un mois complet.

| Ticket | Sujet | Dépend de | Statut |
| --- | --- | --- | --- |
| [T01](T01-types-et-dates.md) | Types du domaine et dates calendaires | — | fait |
| [T02](T02-dates-serie.md) | Dates d'une série, planification à rebours et décalage | T01 | fait |
| [T03](T03-occupations-conflits.md) | Occupations et conflits de place | T02 | fait |
| [T04](T04-rotation.md) | Alertes de rotation | T03 | fait |
| [T05](T05-besoins-semences.md) | Besoins en semences et en plants | T01 | en revue |
| [T06](T06-semainier.md) | Semainier | T02 | à faire |
| [T07](T07-mesure-sqlite.md) | Mesure : SQLite PowerSync sur téléphone simulé | — | à faire |
| [T08](T08-schema-postgres.md) | Schéma PostgreSQL et migrations | T01 | à faire |
| [T09](T09-comptes-jetons.md) | Comptes, fermes et jetons | T08 | à préciser |
| [T10](T10-synchro.md) | Synchro de bout en bout | T07, T08, T09 | à faire |
| [T11](T11-vue-2d.md) | Vue 2D planches × semaines | T03, T10 | à faire |
| [T12](T12-plan-de-culture.md) | Plan de culture : créer et modifier une série | T04, T05, T11 | à faire |
| [T13](T13-saisie-terrain.md) | Saisie terrain hors ligne : réalisé et récolte | T06, T10 | à faire |
| [T14](T14-import-csv.md) | Import de n'importe quel tableur | T10 | à faire |
| [T15](T15-export.md) | Export complet JSON + CSV | T10 | à faire |

T07 n'a pas de dépendance et porte le plus gros risque technique (le budget de 300 ms avec la base) : la boucle peut le prendre dès le début, en parallèle du moteur.

## Format d'un ticket

- **Objectif** : ce que Théophane gagne, en une ou deux phrases.
- **Dépend de** et **Périmètre** : les fichiers que le ticket a le droit de toucher. Sortir du périmètre se justifie dans la PR.
- **Règles métier** : les calculs exacts, avec des exemples chiffrés. Ce sont les tests d'acceptation.
- **Critères d'acceptation** : cases à cocher vérifiables, toutes couvertes par un test automatique.
- **Hors périmètre** : ce qu'il ne faut pas faire dans ce ticket.

## Règles communes à tous les tickets

- `pnpm verif` passe en entier (typage, lint, tests, build, budgets).
- Dates calendaires en chaînes `AAAA-MM-JJ` et calculs en jours entiers : jamais d'objet `Date` avec fuseau local dans `packages/core`.
- Quantités calculées en nombres entiers quand un arrondi est en jeu ; pas de flottant avant l'arrondi final.
- Textes de l'interface en français ; noms de code en français comme dans le modèle (`serie`, `emplacement`, `occupation`).
- Fin de ticket : trois lignes dans `docs/journal.md` et le statut mis à jour dans ce tableau.

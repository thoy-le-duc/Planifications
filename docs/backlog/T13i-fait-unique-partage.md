# T13i — « Fait » unique : partagé avec la voix et l'agent

**Objectif** : la règle de T13h protège toutes les écritures de réalisés, pas seulement l'écran Aujourd'hui.

**Dépend de** : T13h
**Périmètre** : `apps/web/src/ecrans/aujourdhui/ecritures.ts`, `packages/sync/**`

## Constat (relecture T13h)

- La vérification « déjà fait » vit dans `ecritures.ts` : `porte.saisirEvenement` et `ecrireEnsemble` sans vérification restent ouverts (futures voix et agent).
- Quand un réalisé de la même étape existe déjà (même annulé), la vérification recalcule les chaînes de toute la ferme : ≈ 30 ms sous Node sur 51 000 événements, peut-être 120–300 ms sur un téléphone moyen (au tap, masqué).

## Règles

- Sortir la vérification dans un module partagé (`@planif/sync` ou module d'écriture commun) appelé par toute écriture de réalisé.
- Restreindre le calcul des chaînes à la culture visée.

## Critères d'acceptation

- [x] Test : une écriture de réalisé par `saisirEvenement` passe par la même vérification.
- [x] Test de temps : refus « déjà fait » sur la grande ferme sous 50 ms (CPU normal).

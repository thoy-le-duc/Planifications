# T10o — Refus : archivage vérifié entre deux téléphones

**Objectif** : prouver avec la vraie synchro (pas une base simulée) qu'un refus archivé sur un téléphone disparaît sur l'autre.

**Dépend de** : T10l
**Périmètre** : `apps/web/e2e-synchro/**` (ou le dossier des tests de `pnpm e2e:synchro`)

## Constat (relecture T10l)

Le critère « sur tous les téléphones » n'est couvert qu'avec la base en mémoire qui imite la synchro.

## Critères d'acceptation

- [ ] `pnpm e2e:synchro` : navigateur A archive un refus, navigateur B voit la carte disparaître ; la ligne descend avec `archive_le` rempli ; le PATCH envoyé ne porte que `archive_le`.

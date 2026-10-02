# T10l — Refus de synchro : archiver un refus vu

**Objectif** : la liste des refus ne grossit pas sans fin.

**Dépend de** : T10i
**Périmètre** : `apps/api/src/sync/**`, `packages/sync/**`, `apps/web/src/ecrans/ferme/Refus.tsx`

## Règles

- Archiver un refus vu (ou tous) ; les refus archivés ne s'affichent plus, sur tous les téléphones de l'utilisateur.

## Critères d'acceptation

- [ ] Archiver un refus le retire de la liste, sur tous les téléphones de l'utilisateur.
- [ ] Un refus archivé reste dans l'export complet (principe 5).

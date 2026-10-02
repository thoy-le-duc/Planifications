# T10l — Refus de synchro : archiver un refus vu

**Objectif** : la liste des refus ne grossit pas sans fin.

**Dépend de** : T10i
**Périmètre** : `apps/api/src/sync/**`, `packages/sync/**`, `packages/db/**` (colonne `refus_synchro.archive_le`, migration 0024), `powersync/sync-config.yaml`, `apps/web/src/ecrans/ferme/Refus.tsx` (et la ligne qui lui passe l'archivage dans `EcranFerme.tsx`)

## Règles

- Archiver un refus vu (ou tous) ; les refus archivés ne s'affichent plus, sur tous les téléphones de l'utilisateur.

## Critères d'acceptation

- [x] Archiver un refus le retire de la liste, sur tous les téléphones de l'utilisateur.
- [x] Archiver ne supprime rien : la ligne reste sur le serveur et le téléphone. Les refus de synchro restent hors de l'export complet, comme décidé en T15.

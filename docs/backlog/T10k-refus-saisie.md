# T10k — Refus de synchro : la saisie refusée reconnaissable

**Objectif** : la carte d'un refus montre quelle saisie a été refusée (type, culture, date de la saisie, quantité).

**Dépend de** : T10j
**Périmètre** : `apps/api/src/sync/**` (résumé du refus), règles de synchro (`sync-config.yaml`), `packages/sync/src/schema.ts`, `apps/web/src/ecrans/ferme/Refus.tsx`

## Règles

- Un court résumé non sensible de la saisie refusée accompagne le refus (type, culture, date de la saisie, quantité), calculé par le serveur.
- Jamais de donnée d'une autre ferme ni d'un autre utilisateur.

## Critères d'acceptation

- [ ] La carte d'un refus de récolte montre la culture, la date et la quantité saisies.
- [ ] Test d'isolement : le résumé ne contient rien d'une autre ferme.

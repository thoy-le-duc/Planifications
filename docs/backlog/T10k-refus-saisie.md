# T10k — Refus de synchro : la saisie refusée reconnaissable

**Objectif** : la carte d'un refus montre quelle saisie a été refusée (type, culture, date de la saisie, quantité).

**Dépend de** : T10j
**Périmètre** : `apps/api/src/sync/**` (résumé du refus), règles de synchro (`sync-config.yaml`), `packages/sync/src/schema.ts`, `apps/web/src/ecrans/ferme/Refus.tsx`

## Règles

- Un court résumé non sensible de la saisie refusée accompagne le refus (type, culture, date de la saisie, quantité), calculé par le serveur.
- Jamais de donnée d'une autre ferme ni d'un autre utilisateur.

## Critères d'acceptation

- [x] La carte d'un refus de récolte montre la culture, la date et la quantité saisies.
- [x] Test d'isolement : le résumé ne contient rien d'une autre ferme.

## Décisions (chef, 2026-10-02)

- Cinq colonnes séparées et typées sur `refus_synchro` (type, culture, date, quantité, unité), jamais la note ni les données reçues.
- La culture n'est remplie que si la série ou la campagne est de la ferme de l'événement et que l'utilisateur en est membre accepté au moment du lot.
- Quantité gardée seulement entre 0 et 1 000 000 ; pas de résumé pour les autres tables ni pour un lot trop gros.
- Les refus restent hors de l'export complet (journal technique, depuis T10i).
- Limite connue : dans le chemin « chaque écriture à part », la culture est lue une fois par refus (borné à 500 par lot).
- Question à Théophane : Q25 (un ancien membre garde, dans ses refus, le nom des cultures de la ferme qu'il a quittée).

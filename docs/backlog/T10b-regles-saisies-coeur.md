# T10b — Règles des saisies dans le cœur

**Objectif** : une seule définition des règles d'une saisie (récolte, traitement, irrigation…), utilisée à la fois par le téléphone avant écriture et par le serveur à l'envoi.

**Dépend de** : T10
**Périmètre** : `packages/core/src/saisies/**`, `apps/api/src/sync/evenement.ts`

## Règles

- Déplacer dans `packages/core` la validation du détail des événements écrite pour T10 dans `apps/api/src/sync/evenement.ts` (clés autorisées, limites, bornes de dates), avec ses tests.
- Le serveur l'appelle ; le contrôle d'appartenance à la ferme (base de données) reste dans l'API.
- Décider avec Théophane des plafonds métier des quantités (aujourd'hui une quantité de 1e308 est acceptée).

## Critères d'acceptation

- [ ] Les tests d'upload de T10 passent sans modification.
- [ ] Les règles ont leurs tests unitaires dans `packages/core`, sans base ni réseau.

**Hors périmètre** : écrans de saisie (T13).

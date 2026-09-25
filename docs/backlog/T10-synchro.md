# T10 — Synchro de bout en bout

**Objectif** : une saisie faite sur un téléphone sans réseau arrive sur le serveur et sur les autres téléphones de la ferme au retour du réseau, après passage par les règles métier.

**Dépend de** : T07, T08, T09
**Périmètre** : `packages/sync/**`, `apps/api/src/sync/**`, `apps/web/src/donnees/**`, `docker-compose.yml`, `powersync/**` (configuration du service)

## Règles

Architecture décrite dans `docs/choix-synchro.md`.

- Service PowerSync auto-hébergé dans `docker-compose.yml`, à côté de Postgres ; stockage des buckets dans Postgres.
- Sync Streams : un flux par table filtré par les fermes dont l'utilisateur est membre ; la bibliothèque de référence en flux global.
- `packages/sync` : seule porte d'accès aux données pour l'appli web (lecture, écriture, requêtes surveillées). Aucun écran n'importe PowerSync directement.
- `POST /sync/upload` : vérifie la ferme de chaque écriture, rejoue les règles de `packages/core`, écrit dans une seule transaction avec la ligne de MODIFICATION.
- Écriture refusée par une règle métier : réponse 200, refus enregistré avec son motif, visible sur le téléphone. Réponse 5xx seulement pour une panne passagère.
- Un même envoi rejoué deux fois ne crée rien en double (identifiants UUID v7).

## Critères d'acceptation

- [ ] Test Playwright de bout en bout : deux navigateurs sur la même ferme ; le premier passe hors ligne, saisit une récolte, revient en ligne ; la récolte apparaît chez le second.
- [ ] Test : écriture refusée (événement modifié après coup) ; le motif s'affiche sur le téléphone et la file n'est pas bloquée.
- [ ] Test : deux envois identiques, une seule ligne en base.
- [ ] Test : un utilisateur d'une autre ferme ne reçoit rien.
- [ ] Budgets de `pnpm verif` toujours respectés.

**Hors périmètre** : écrans métier (T11 à T13), import (T14).

# T08 — Schéma PostgreSQL et migrations

**Objectif** : la base de référence du serveur, fidèle au modèle v1, prête pour la réplication PowerSync.

**Dépend de** : T01
**Périmètre** : `packages/db/**`, `docker-compose.yml`, `.github/workflows/ci.yml` (service Postgres)

## Règles

- Drizzle ORM, une table par entité du modèle v1, noms en français (`serie`, `emplacement`, `occupation`, `assolement`…).
- Chaque table : `id` UUID (v7, généré par le client), `ferme_id` (sauf bibliothèque de référence, `ferme_id` nul), `cree_le`, `modifie_le`, `supprime_le` (suppression douce).
- Clés étrangères et contraintes de validité côté serveur (exactement une cible entre série et plantation pour une occupation, longueurs positives, etc.).
- `evenement` et `mouvement_stock` en ajout seul : ni mise à jour ni suppression physique (déclencheur qui refuse).
- Index pour les requêtes de la vue 2D (emplacement, période) et du semainier (dates prévues).
- Base prête pour PowerSync : `wal_level=logical` dans `docker-compose.yml`, publication `powersync`.

## Critères d'acceptation

- [ ] Migrations générées par drizzle-kit, versionnées, rejouables sur une base vide.
- [ ] `docker compose up` démarre Postgres 17 configuré pour la réplication logique.
- [ ] Tests d'intégration en CI contre un vrai Postgres (service GitHub Actions) : contraintes respectées, refus de modifier un événement, suppression douce, cascade interdite sur l'historique.
- [ ] Types TypeScript du schéma compatibles avec ceux de T01 (test de typage).

**Hors périmètre** : règles de synchro (T10), comptes (T09), données de démonstration.

# @planif/db

Base PostgreSQL de référence du serveur (ticket T08) : schéma Drizzle du modèle v1, migrations versionnées, conversions ligne ↔ entité de `@planif/core`.

## Utilisation

```ts
import { appliquerMigrations, serie, ligneDepuisSerie, serieDepuisLigne } from '@planif/db';

await appliquerMigrations(process.env.DATABASE_URL); // rejouable : ne fait rien si la base est à jour
```

| Commande | Rôle |
| --- | --- |
| `docker compose up -d` (racine) | Postgres 17 local, `wal_level=logical` |
| `pnpm --filter @planif/db migrer` | Applique les migrations sur `DATABASE_URL` |
| `pnpm --filter @planif/db generer` | Génère la migration après un changement de `src/schema.ts` |
| `DATABASE_URL=… pnpm test` | Tests, y compris ceux d'intégration contre Postgres |

Sans `DATABASE_URL`, les tests d'intégration sont sautés en local (avec un avertissement) et échouent en CI. La CI vérifie aussi que `drizzle-kit generate` ne produit rien : un schéma modifié sans sa migration fait échouer la CI.

## Fichiers

| Fichier | Contenu |
| --- | --- |
| `src/schema.ts` | Les 21 tables, clés étrangères, CHECK, index |
| `src/valeurs.ts` | Valeurs des unions de T01, vérifiées à la compilation contre `@planif/core` |
| `src/conversions.ts` | `ligneDepuisX` / `xDepuisLigne` pour Serie, Occupation, Emplacement, Evenement |
| `src/migrations.ts` | `appliquerMigrations(url)` |
| `migrations/0000_*.sql` | Généré par drizzle-kit : tables, contraintes, index |
| `migrations/0001_*.sql` | Migration personnalisée (`drizzle-kit generate --custom`) : déclencheurs d'ajout seul, vues, publication `powersync` |

Ne jamais modifier une migration déjà fusionnée : on en ajoute une nouvelle.

## Règles du schéma

- **Noms** : tables et colonnes en français, snake_case en base, camelCase côté TypeScript.
- **Colonnes communes** : `id` UUID v7 généré par le client (pas de défaut), `ferme_id` vers `ferme` (nul autorisé seulement pour la bibliothèque de référence : `famille`, `espece`, `variete`, `itineraire`, `produit_phyto`), `cree_le`, `modifie_le`, `supprime_le` (suppression douce).
- **Types** : dates calendaires en `date` lues comme chaînes `AAAA-MM-JJ`, instants en `timestamptz`, longueurs et quantités en `numeric` lues comme nombres.
- **Unions de T01** : `text` + CHECK, avec les valeurs exactes de T01. Plus simple à faire évoluer qu'un enum Postgres, et PowerSync les réplique en texte.
- **Clés étrangères** : aucune en cascade. Supprimer physiquement une ligne référencée échoue ; on supprime en douceur (`supprime_le`).
- **Contraintes** : une seule cible et une seule place par occupation, longueurs et quantités positives, une récolte liée à un mouvement de stock si et seulement si le motif est `recolte`, dates dans l'ordre, etc.
- **Ajout seul** : un déclencheur refuse `UPDATE`, `DELETE` et `TRUNCATE` sur `evenement` et `mouvement_stock` (erreur `23001`). Un événement se corrige ou s'annule par un nouvel événement qui le désigne.
- **Index** : `occupation (emplacement_id, prevu_du, prevu_au)` pour la vue 2D ; `serie (ferme_id, prevu_…)` pour le semainier ; plus les clés étrangères les plus lues.
- **PowerSync** : publication `powersync` (insert, update, delete) sur les 21 tables, en liste explicite : pas besoin d'être superutilisateur chez un hébergeur géré, et la table de suivi des migrations n'est pas publiée. Une nouvelle table synchronisée s'ajoute dans sa migration par `ALTER PUBLICATION powersync ADD TABLE …`. Le service PowerSync exige `wal_level=logical` sur le serveur (réglé dans `docker-compose.yml`) ; la création de la publication, elle, n'en a pas besoin, ce qui permet de tester en CI avec le service Postgres standard.

## Vues du journal (Q10)

Il n'y a pas de tables Récolte, Intervention et Traitement : le détail est dans `evenement.detail` (jsonb, l'objet `Detail*` de T01 tel quel). Trois vues le présentent en colonnes, pour les exports et le registre phyto :

| Vue | Colonnes |
| --- | --- |
| `recoltes` | id, ferme_id, date, serie_id, campagne_id, emplacement_ids, quantite, unite, categorie, note |
| `interventions` | id, ferme_id, date, serie_id, campagne_id, emplacement_ids, categorie, type_intervention, outil, produit, quantite_valeur, quantite_unite, duree_occupation_jours, note |
| `traitements` | id, ferme_id, date, serie_id, campagne_id, emplacement_ids, produit_phyto_id, nom_commercial, numero_amm, substance_active, dose_valeur, dose_unite, surface_traitee_m2, cible, operateur, recolte_autorisee_le, note |

**Seule la version en vigueur apparaît** : les vues excluent les annulations, les événements annulés et les événements remplacés par une correction. Une correction apparaît tant qu'elle n'est pas elle-même corrigée ou annulée. Elles s'appuient sur la vue `evenements_en_vigueur`, utilisable directement.

Des CHECK vérifient dans le détail ce que les vues lisent et convertissent (quantité de récolte strictement positive et unité, catégorie d'intervention, étape d'un réalisé, identifiant de produit et date d'un traitement) : un détail mal formé ne peut pas casser le registre phyto.

## Écarts assumés avec le ticket et le modèle v1

Validés par le chef d'équipe le 2026-09-29.

1. **Pas de table `utilisateur` avant T09.** `evenement.auteur_id`, `proposition.auteur_id` et `modification.auteur_id` sont des UUID sans clé étrangère ; T09 ajoutera la table et les clés.
2. **`evenement` et `mouvement_stock` sans `modifie_le` ni `supprime_le`.** Ils sont en ajout seul : une ligne n'est jamais modifiée ni supprimée. (L'entité `MouvementStock` de T01 porte un `supprimeLe` : il n'a pas de colonne.)
3. **Tableaux `uuid[]`** pour `emplacement.remplace` et `evenement.emplacement_ids`, plutôt que des tables de liaison : ils se lisent et se synchronisent avec leur ligne. Pas de clé étrangère sur leurs éléments.
4. **Les identifiants du détail restent dans le jsonb** (`produitPhytoId` d'un traitement, `secteurIrrigationId` d'une irrigation) : pas de clé étrangère. La vue `traitements` joint le produit par une jointure externe.
5. **Journal des modifications** : l'entité T01 a un champ `table` ; la colonne s'appelle `nom_table` (clé `nomTable`), `table` étant un mot réservé SQL. Elle contient le nom d'entité de T01 (`Serie`, `Emplacement`…).

## Correspondance entité ↔ ligne

Les entités de T01 sont imbriquées (ancre, taille, occupant, place, détail…), une ligne SQL est plate : d'où une paire de fonctions pures par entité, sans perte dans les deux sens (`xDepuisLigne(ligneDepuisX(e))` égal à `e`). `Ligne<T>` est la ligne sans `cree_le` ni `modifie_le`, que la base remplit. Les instants sont des `Date` côté ligne et des millisecondes côté domaine. Un champ absent ou nul du domaine devient `NULL`, et redevient absent ou nul à la relecture (`DatesPrevuesSerie.semisPepiniere` est absent hors plant maison).

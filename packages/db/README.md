# @planif/db

Base PostgreSQL de référence du serveur (tickets T08 et T09) : schéma Drizzle du modèle v1 et des comptes, migrations versionnées, conversions ligne ↔ entité de `@planif/core`, règles de découpage par ferme.

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

Sans `DATABASE_URL`, les tests d'intégration sont sautés en local (avec un avertissement) et échouent en CI. La CI vérifie aussi que `drizzle-kit generate` conclut « No schema changes » et ne crée aucun fichier : un schéma modifié sans sa migration, ou un changement qui attend une réponse interactive (renommage de colonne), fait échouer la CI. Un renommage se génère en local, où drizzle-kit pose la question.

## Fichiers

| Fichier | Contenu |
| --- | --- |
| `src/schema.ts` | Les 21 tables du modèle v1, les 4 tables de comptes (T09) et `refus_synchro` (T10), clés étrangères, CHECK, index |
| `src/securite.ts` | Schéma `securite` (T09b), données du serveur seul : `demande_ip`. Hors du point d’entrée (`@planif/db/securite`), pour que `@planif/sync` n’en dérive rien |
| `src/comptes.ts` | `fermesDeLUtilisateur`, `roleDansLaFerme`, `ROLES_MEMBRE`, `ETATS_MEMBRE` (T09) |
| `src/valeurs.ts` | Valeurs des unions de T01, vérifiées à la compilation contre `@planif/core` |
| `src/conversions.ts` | `ligneDepuisX` / `xDepuisLigne` pour Serie, Occupation, Emplacement, Evenement |
| `src/migrations.ts` | `appliquerMigrations(url)` |
| `migrations/0000_*.sql` | Généré par drizzle-kit : tables, contraintes, index |
| `migrations/0001_*.sql` | Migration personnalisée (`drizzle-kit generate --custom`) : déclencheurs d'ajout seul, vues, publication `powersync` |
| `migrations/0002_*.sql` | Migration personnalisée : fonction `est_date_calendaire`, déclencheur « remplacement du même type », vue `evenements_en_vigueur` (correction la plus récente) |
| `migrations/0003_*.sql` | Généré par drizzle-kit : CHECK stricts du détail jsonb, clé étrangère composée du remplacement. Seule retouche : l'UNIQUE posé avant la clé étrangère qui s'y appuie |
| `migrations/0004_*.sql` | Généré par drizzle-kit (T09) : `utilisateur`, `membre`, `code_connexion`, `jeton_renouvellement`, clés `auteur_id` → `utilisateur` |
| `migrations/0005_*.sql` | Migration personnalisée (T09) : `utilisateur` et `membre` ajoutées à la publication `powersync` |
| `migrations/0006_*.sql` | Généré par drizzle-kit (T09, relecture sécurité) : `membre.etat`, `invite_par`, `invite_le` et leurs CHECK |
| `migrations/0007_*.sql` | Généré par drizzle-kit (T10) : `refus_synchro` |
| `migrations/0010_*.sql` | Généré par drizzle-kit (T09b) : `jeton_renouvellement.famille_id`, `connexion_le`, `utilise_le` (rotation), schéma `securite` et table `demande_ip` (limite par IP). Seule retouche : les sessions existantes forment chacune leur famille |
| `migrations/0008_*.sql` | Migration personnalisée (T10) : `refus_synchro` dans la publication `powersync`, et publication étendue à `truncate` (exigé par PowerSync 1.26, erreur PSYNC_S1142) |
| `migrations/0012_*.sql` | Généré par drizzle-kit (T10d) : `mouvement_stock.quantite` en `numeric(12,6)`, six décimales au plus comme la règle de l'API |
| `migrations/0015_*.sql` | Généré par drizzle-kit (T23) : table `type_intervention`, unicité (ferme, catégorie, libellé) parmi les types actifs, `modification.nom_table` accepte `TypeIntervention` |
| `migrations/0017_*.sql` | Généré par drizzle-kit (T23, décision 11) : unicité des types actifs insensible à la casse (`lower(libelle)`) |
| `migrations/0016_*.sql` | Migration personnalisée (T23) : `type_intervention` dans la publication `powersync`, et la liste de départ (`TYPES_INTERVENTION_PAR_DEFAUT`, `ferme_id` nul, identifiants tirés du couple) |
| `migrations/0018_*.sql` | Migration personnalisée (T10g) : `evenements_en_vigueur` suit toute la chaîne (une annulation retire tout, sinon la correction la plus récente de la chaîne) |

Ne jamais modifier une migration déjà fusionnée : on en ajoute une nouvelle.

## Règles du schéma

- **Noms** : tables et colonnes en français, snake_case en base, camelCase côté TypeScript.
- **Colonnes communes** : `id` UUID v7 généré par le client (pas de défaut), `ferme_id` vers `ferme` (nul autorisé seulement pour la bibliothèque de référence : `famille`, `espece`, `variete`, `itineraire`, `produit_phyto`, et la liste de départ de `type_intervention`), `cree_le`, `modifie_le`, `supprime_le` (suppression douce).
- **Types** : dates calendaires en `date` lues comme chaînes `AAAA-MM-JJ`, instants en `timestamptz`, longueurs et quantités en `numeric` lues comme nombres.
- **Unions de T01** : `text` + CHECK, avec les valeurs exactes de T01. Plus simple à faire évoluer qu'un enum Postgres, et PowerSync les réplique en texte.
- **Clés étrangères** : aucune en cascade. Supprimer physiquement une ligne référencée échoue ; on supprime en douceur (`supprime_le`).
- **Contraintes** : une seule cible et une seule place par occupation, longueurs et quantités positives, une récolte liée à un mouvement de stock si et seulement si le motif est `recolte`, dates dans l'ordre, etc.
- **Ajout seul** : un déclencheur refuse `UPDATE`, `DELETE` et `TRUNCATE` sur `evenement` et `mouvement_stock` (erreur `23001`). Un événement se corrige ou s'annule par un nouvel événement qui le désigne.
  - **Limite** : le propriétaire des tables (et un superutilisateur) peut désactiver ces déclencheurs (`ALTER TABLE … DISABLE TRIGGER`, `session_replication_role = replica`). L'ajout seul n'est donc garanti que si l'application ne se connecte pas en propriétaire : un rôle applicatif qui n'a que `INSERT` et `SELECT` sur `evenement` et `mouvement_stock` est prévu dans un ticket suivant (voir « Comptes »).
- **Remplacement** : une correction ou une annulation vise un événement de la même ferme (clé étrangère composée `(ferme_id, remplace_evenement_id)` → `evenement (ferme_id, id)`, erreur `23503`) et du même type (déclencheur à l'insertion, erreur `23514`).
- **Index** : `occupation (emplacement_id, prevu_du, prevu_au)` pour la vue 2D ; `serie (ferme_id, prevu_…)` pour le semainier ; plus les clés étrangères les plus lues.
- **PowerSync** : publication `powersync` (insert, update, delete, truncate depuis T10) sur les 21 tables du modèle, plus `utilisateur` et `membre` (T09) et `refus_synchro` (T10), en liste explicite : pas besoin d'être superutilisateur chez un hébergeur géré, et la table de suivi des migrations n'est pas publiée. Une nouvelle table synchronisée s'ajoute dans sa migration par `ALTER PUBLICATION powersync ADD TABLE …`. Le service PowerSync exige `wal_level=logical` sur le serveur (réglé dans `docker-compose.yml`, et en CI par `docker run … -c wal_level=logical`) ; la création de la publication, elle, n'en a pas besoin. Ce que chaque téléphone reçoit est décidé par `powersync/sync-config.yaml`, pas par la publication.
- **Schéma `securite`** (T09b) : données du serveur seul, hors de `public` donc hors de la publication. `demande_ip` (adresse IP, action `code` ou `verifier`, instant) sert à la limite par IP de l'API, qui efface les lignes de plus de 24 heures.

## Synchro (T10)

| Table | Rôle | Publiée |
| --- | --- | --- |
| `refus_synchro` | Écriture reçue par `POST /sync/upload` et refusée : `utilisateur_id` (auteur), `ferme_id` visée si connue (sans clé étrangère), `nom_table`, `ligne_id` (texte : l'id reçu n'est pas forcément un UUID), `operation` (`PUT`, `PATCH`, `DELETE`), `motif` (code stable), `message` (français, affiché sur le téléphone), `donnees` (ce qui a été reçu), `cree_le`. Écrite par le serveur seulement | oui, vers son seul auteur, sans `donnees` |

Service PowerSync en local : voir `apps/api/README.md`, « Lancer la synchro en local ».

## Comptes (T09)

Connexion par code à 6 chiffres reçu par e-mail, sans mot de passe (Q9). Le code et les jetons sont gérés par `apps/api` ; la base ne stocke que des empreintes.

| Table | Rôle | Publiée |
| --- | --- | --- |
| `utilisateur` | Personne qui se connecte. `email` unique, toujours en minuscules (CHECK `email = lower(email)`) | oui |
| `membre` | Utilisateur × ferme, rôle `gerant` ou `equipier`, unique par couple, retrait en douceur (`supprime_le`). `etat` : `invite` jusqu'à la prochaine connexion réussie de l'invité, puis `accepte` (valeur par défaut) ; `invite_par` et `invite_le` gardent la trace de l'invitation | oui |
| `code_connexion` | Code à usage unique, haché, expiration, tentatives. Pas de clé vers `utilisateur` : le code précède le compte. Ses lignes servent aussi aux limites : envois par adresse, et échecs par adresse sur 24 h (somme des `tentatives` des codes créés dans la fenêtre) | **non** |
| `jeton_renouvellement` | Jeton long et opaque, haché, expiration, révocation | **non** |

Règle de découpage : `fermesDeLUtilisateur(db, utilisateurId)` rend les fermes dont l'utilisateur est membre actif (membre accepté, et membre, ferme et utilisateur non supprimés), triées par id ; `roleDansLaFerme(db, utilisateurId, fermeId)` rend le rôle ou `null`. L'API les relit à chaque requête, les règles de synchro PowerSync (`powersync/sync-config.yaml`, T10) reprennent la même règle.

**Appliqué par T10** : `membre` est publiée avec ses lignes « invité ». Les règles de synchro filtrent `etat = 'accepte'` (en plus de `supprime_le` nul sur le membre, la ferme et l'utilisateur), sinon un invité recevrait les données de la ferme avant d'avoir accepté. `db` est ce que rend `drizzle(client)` de `drizzle-orm/node-postgres`.

Tickets suivants (décision du chef d'équipe, rien dans T09) :

- **Clé d'accès (WebAuthn)** en option (Q9) : aucune table pour l'instant.
- **Déconnexion et révocation par l'API** : la colonne `jeton_renouvellement.revoque_le` existe et est respectée, mais aucune route ne la remplit encore.
- **Rôle applicatif** limité à `INSERT`/`SELECT` sur le journal (`evenement`, `mouvement_stock`), et **contrôle des références entre fermes** (une ligne qui pointe vers une ligne d'une autre ferme), avec la RLS et `security_invoker` des vues.

## Vues du journal (Q10)

Il n'y a pas de tables Récolte, Intervention et Traitement : le détail est dans `evenement.detail` (jsonb, l'objet `Detail*` de T01 tel quel). Trois vues le présentent en colonnes, pour les exports et le registre phyto :

| Vue | Colonnes |
| --- | --- |
| `recoltes` | id, ferme_id, date, serie_id, campagne_id, emplacement_ids, quantite, unite, categorie, note |
| `interventions` | id, ferme_id, date, serie_id, campagne_id, emplacement_ids, categorie, type_intervention, outil, produit, quantite_valeur, quantite_unite, duree_occupation_jours, note |
| `traitements` | id, ferme_id, date, serie_id, campagne_id, emplacement_ids, produit_phyto_id, nom_commercial, numero_amm, substance_active, dose_valeur, dose_unite, surface_traitee_m2, cible, operateur, recolte_autorisee_le, note |

**Seule la version en vigueur apparaît.** Les vues s'appuient sur `evenements_en_vigueur`, utilisable directement, qui exclut :

- toute la chaîne d'un événement annulé : la chaîne, c'est l'origine, ses corrections, les corrections de ses corrections, et toutes leurs annulations ; une seule annulation, de l'origine ou de n'importe quelle correction, retire toute la chaîne (T10g) ;
- sinon, toute la chaîne sauf UNE ligne : la correction la plus récente de toute la chaîne (`horodatage` le plus grand, puis `id` le plus grand), à défaut l'origine. Une chaîne ramifiée n'a qu'une ligne en vigueur (T10g, migration 0018 ; même règle que le stock et le téléphone).

Conséquences à connaître :

- **Annuler une correction retire la saisie** : toute la chaîne est annulée. Une récolte annulée ne se corrige plus (l'API refuse, motif `recolte_annulee`) : pour la rétablir, on saisit une nouvelle récolte.
- **Annuler une annulation ne restaure rien** (l'API la refuse pour une récolte) : pour rétablir, on saisit de nouveau.

Des CHECK contrôlent le détail à l'insertion (erreur `23514`), pour qu'un `SELECT *` sur une vue ne lève jamais : champ obligatoire absent (`… IS TRUE`, un champ absent donnant NULL), date impossible (`est_date_calendaire`, fonction IMMUTABLE qui ne lève jamais), valeur non numérique là où la vue convertit en nombre (`jsonb_typeof`), valeurs des unions de T01.

Limites de maintenance :

- **`SELECT e.*`** : `evenements_en_vigueur` fige la liste des colonnes à sa création. Ajouter une colonne à `evenement` oblige à recréer la vue (`CREATE OR REPLACE VIEW`) dans la même migration, sinon elle ne l'expose pas.
- **Pas de `security_invoker`** : les vues s'exécutent avec les droits de leur propriétaire, donc elles contourneraient une RLS posée sur `evenement`. À revoir avec la RLS (`WITH (security_invoker = true)`), dans un ticket suivant.

## Écarts assumés avec le ticket et le modèle v1

Validés par le chef d'équipe le 2026-09-29.

1. **Pas de table `utilisateur` avant T09.** Résolu par T09 : `evenement.auteur_id`, `proposition.auteur_id` et `modification.auteur_id` référencent `utilisateur(id)`, sans cascade. La migration 0004 échoue sur une base qui contient déjà des événements (ou propositions, modifications) d'auteurs inconnus : la clé étrangère ne se pose pas. Aucune base en production aujourd'hui ; une base de développement dans ce cas se recrée (relevé par la relecture sécurité de T09).
2. **`evenement` et `mouvement_stock` sans `modifie_le` ni `supprime_le`.** Ils sont en ajout seul : une ligne n'est jamais modifiée ni supprimée. (L'entité `MouvementStock` de T01 porte un `supprimeLe` : il n'a pas de colonne.)
3. **Tableaux `uuid[]`** pour `emplacement.remplace` et `evenement.emplacement_ids`, plutôt que des tables de liaison : ils se lisent et se synchronisent avec leur ligne. Pas de clé étrangère sur leurs éléments.
4. **Les identifiants du détail restent dans le jsonb** (`produitPhytoId` d'un traitement, `secteurIrrigationId` d'une irrigation) : pas de clé étrangère. La vue `traitements` joint le produit par une jointure externe.
5. **Journal des modifications** : l'entité T01 a un champ `table` ; la colonne s'appelle `nom_table` (clé `nomTable`), `table` étant un mot réservé SQL. Elle contient le nom d'entité de T01 (`Serie`, `Emplacement`…).
6. **`ferme_id` nul dans la bibliothèque de référence** (`famille`, `espece`, `variete`, `itineraire`, `produit_phyto`), alors que T01 type `fermeId` non nul sur ces entités (`LigneDeFerme`). Une ligne partagée n'appartient à aucune ferme ; il n'y a pas encore de conversion pour ces tables, et T01 devra admettre `fermeId: null` (ou une entité de bibliothèque distincte) quand on les écrira.

## Correspondance entité ↔ ligne

Les entités de T01 sont imbriquées (ancre, taille, occupant, place, détail…), une ligne SQL est plate : d'où une paire de fonctions pures par entité, sans perte dans les deux sens (`xDepuisLigne(ligneDepuisX(e))` égal à `e`). `Ligne<T>` est la ligne sans `cree_le` ni `modifie_le`, que la base remplit. Les instants sont des `Date` côté ligne et des millisecondes côté domaine. Un champ absent ou nul du domaine devient `NULL`, et redevient absent ou nul à la relecture (`DatesPrevuesSerie.semisPepiniere` est absent hors plant maison).

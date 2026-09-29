# @planif/sync

Seule porte d'accès aux données de l'appli web (T10) : lecture, écriture et requêtes surveillées sur la base locale du téléphone (PowerSync, SQLite), et envoi des écritures faites hors ligne à l'API. Aucun écran n'importe PowerSync : ESLint l'interdit dans `apps/web/src`, hors `donnees/` (ouverture de la base, connecteur) et `mesures/` (T07).

Architecture et choix : `docs/choix-synchro.md`. Contrat exact : `src/test/contrat.ts`.

## Utilisation

```ts
import { creerPorte, envoyerEcritures, SCHEMA_LOCAL } from '@planif/sync';

const porte = creerPorte(base, { utilisateurId, fermeId }); // base : PowerSyncDatabase ouverte avec SCHEMA_LOCAL
const id = await porte.saisirEvenement({ type: 'recolte', date, source: 'tap', culture: null, emplacementIds: [],
  note: null, photos: [], remplaceEvenement: null, detail: { quantite: 12.5, unite: 'kg', categorie: null } });
const arreter = porte.surveiller({ sql: 'SELECT … FROM evenement WHERE ferme_id = ?', parametres: [fermeId], tables: ['evenement'] }, afficher);
porte.surveillerRefus(afficherRefus); // refus du serveur, du plus récent au plus ancien
```

Dans l'appli, `ouvrirDonnees` (`apps/web/src/donnees`) ouvre la base, branche le connecteur et rend la porte ; à charger par import dynamique, pour garder PowerSync hors du JavaScript de démarrage.

| Export | Rôle |
| --- | --- |
| `creerPorte(base, options)` | `lire`, `ecrire` (transaction locale, part dans la file d'envoi), `surveiller` (résultat tout de suite, puis à chaque écriture sur les tables données, locale ou reçue ; `convertir` facultatif par ligne), `saisirEvenement` (UUID v7, ferme, auteur, horodatage complétés ; toujours un INSERT), `surveillerRefus` |
| `envoyerEcritures(file, options)` | Cœur de `uploadData` du connecteur : une transaction de la file = un `POST /sync/upload`. 200 → `complete()` ; autre réponse ou panne → erreur, la transaction reste et PowerSync réessaie. 401 → `invaliderJeton()`, jeton neuf et un seul nouvel essai ; second 401 → `SessionExpiree`. Un refus métier arrive en 200 : il ne bloque jamais la file |
| `SessionExpiree` | Erreur « reconnexion nécessaire », la seule de l'appli (réexportée par `apps/web/src/donnees/jeton.ts`) |
| `SCHEMA_LOCAL`, `TABLES_LOCALES` | Schéma PowerSync : les tables synchronisées, noms et colonnes de Postgres, sans e-mail ni secrets. `schema.test.ts` le compare au schéma de `@planif/db` |

## Format des lignes locales

Noms de tables et de colonnes de Postgres (snake_case). Valeurs telles que SQLite les stocke : dates `AAAA-MM-JJ`, instants ISO 8601 UTC à la milliseconde (`toISOString()`, et `timestamp_max_precision: milliseconds` côté service), jsonb et tableaux en texte JSON, numeric en réel, booléens en 0/1. C'est aussi le format des `donnees` envoyées à `POST /sync/upload`.

## Ce que le téléphone reçoit

Règles du service : `powersync/sync-config.yaml` (Sync Streams, édition 3). Les lignes des fermes dont l'utilisateur est membre actif (membre accepté, ni membre, ni ferme, ni utilisateur supprimés), la bibliothèque de référence partagée (`ferme_id` nul), son propre compte sans e-mail, et ses propres refus. Jamais `code_connexion` ni `jeton_renouvellement`. Une nouvelle table synchronisée : publication (migration de `@planif/db`), `sync-config.yaml`, puis `src/schema.ts`.

## Tests

| Commande | Ce qui tourne |
| --- | --- |
| `pnpm test` | Porte et envoi sur un SQLite en mémoire (`node:sqlite`), schéma local contre `@planif/db` ; avec `DATABASE_URL` (Postgres en `wal_level=logical`) et Docker : `POST /sync/upload` et les règles de synchro contre le vrai service PowerSync (`apps/api/src/sync/`) |
| `pnpm e2e:synchro` | Deux navigateurs sur la même ferme, saisie hors ligne et refus (`apps/web/e2e-synchro/`). Démarre et arrête seul Postgres, PowerSync (docker compose) et l'API. `POWERSYNC_IMAGE` et `POSTGRES_IMAGE` pour un miroir si Docker Hub est limité |

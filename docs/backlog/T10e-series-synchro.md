# T10e — Synchro : le serveur accepte les séries des téléphones

**Objectif** : une série créée, modifiée ou annulée au téléphone (T12) arrive au serveur, même saisie hors ligne. Aucune ferme ne peut écrire chez une autre, et aucune date n'est crue sans être recalculée.

**Dépend de** : T10, T10b, T10c
**Bloque** : T12 (sa PR attend celle-ci)
**Périmètre** : `apps/api/src/sync/**`, `packages/core/src/saisies/**` (règles), `packages/core/src/index.ts` (exports), `packages/db` (migration de `serie.rotation_acceptee`), `powersync/sync-config.yaml` et le schéma local de `packages/sync` si la colonne doit descendre, le banc `e2e:synchro`

## Constat (testeur T12)

`apps/api/src/sync/upload.ts` n'accepte que `evenement`, `article_stock` et `mouvement_stock` (`TABLES_ECRITES`). Un PUT ou un PATCH sur `serie` ou `occupation` est refusé (`table_interdite`). La table `modification` est écrite par le serveur seul, et c'est voulu.

## Règles

1. **`serie` et `occupation` sont ouvertes au téléphone.**
   - PUT crée une ligne. Un renvoi identique est accepté sans rien réécrire ; le même id avec d'autres valeurs doit passer par PATCH.
   - PATCH modifie une ligne.
   - Une suppression douce se fait par PATCH de `supprime_le`.
   - Un DELETE réel est refusé.
   - Changer `ferme_id` par PATCH est refusé.
2. **Ferme et références** : la règle de T10d s'applique, une ligne d'une autre ferme se comporte comme une ligne inexistante.
   - De la même ferme : `saison_id`, `emplacement_id`, `occupation.serie_id`.
   - De la ferme ou de la bibliothèque commune : `espece_id`, `variete_id`, `itineraire_id`.
   - Refusés pour une occupation de série : `plantation_id` et `evenement_id` (plantations pérennes : ticket suivant).
3. **Règles du cœur** : `validerSerie` et `validerOccupation`, dans `packages/core/src/saisies`, rejouées par le serveur.
   - Ancre et statut prennent leurs valeurs admises.
   - Longueur ou nombre de plants : exactement l'un des deux, positif et plafonné.
   - `parametres` (l'instantané de l'itinéraire) est lisible.
   - **Les dates prévues valent celles calculées par le cœur** (T02) à partir des paramètres et de l'ancre. Le serveur ne croit pas une date calculée ailleurs (principe 2).
   - Les dates d'une occupation sont cohérentes avec celles de sa série.
4. **Une saisie = une transaction, tout ou rien** : la série et ses occupations sont acceptées ou refusées ensemble, comme le stock dans T10c. Un verrou par ferme est pris.
5. **L'historique est écrit par le serveur** : une ligne `modification` par ligne de table touchée.
   - `creation` : `avant` nul.
   - `modification` : `avant` = la ligne avant le PATCH, `apres` = la ligne après.
   - `suppression` : suppression douce, `apres` = la ligne marquée supprimée.
6. **Décision sur une alerte de rotation rouge** : une nouvelle colonne `serie.rotation_acceptee`, en jsonb nullable (`{ famille, delai_ans, le }`), par migration générée. Elle est validée par le cœur et passe d'elle-même dans `modification.apres`.
7. **Exports du cœur pour T12** : `calculerDatesSerie`, `besoinsSerie` et `alertesRotation`, ou leurs noms réels.

## Critères d'acceptation

- [ ] Un test d'intégration Postgres par règle, y compris :
  - une ferme étrangère ;
  - une date prévue fausse ;
  - une transaction à moitié invalide ;
  - un DELETE ;
  - un changement de ferme ;
  - l'historique `avant` et `apres`.
- [ ] `pnpm e2e:synchro` : le téléphone A, hors ligne, crée une série sur deux planches, la modifie, puis annule la modification. Le téléphone B reçoit la série dans son état final, et l'historique serveur compte les lignes attendues.

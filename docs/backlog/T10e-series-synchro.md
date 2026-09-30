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

## Décisions du chef (après les tests)

1. **Cohérence série ↔ occupations, vérifiée en fin de lot.** Chaque occupation active d'une série touchée garde les dates de sa série (de la mise en place à la fin de récolte). Décaler une série sans ses occupations est refusé. Supprimer une série en laissant une occupation active est refusé aussi.
2. **`rotation_acceptee`** : `{ famille, delai_ans, le }`, sans autre clé.
   - `famille` : identifiant (UUID) de la famille botanique en cause.
   - `delai_ans` : entier de 0 à 100.
   - `le` : instant ISO de la décision.
3. **Rétablir une ligne supprimée** (PATCH de `supprime_le` à NULL) est accepté et s'inscrit comme une `modification` : c'est « annuler une annulation » de T12.
4. **Même id, autres valeurs en PUT** : refusé avec le motif `ecriture_invalide` (pas `ajout_seul`, dont le message parle des événements).
5. **Cohérence de la bibliothèque** : la variété d'une série appartient à son espèce, l'itinéraire aussi. Sinon : `ecriture_invalide`, à la création comme au PATCH.
6. **Pas de création déjà supprimée** : un PUT de série ou d'occupation avec `supprime_le` non nul est refusé (`ecriture_invalide`).
7. **Pas des refus serveur** : une mise en place hors de la saison et une occupation qui dépasse sa planche sont acceptées. Ce sont des alertes et des conflits affichés par T12 (T03), pas des règles d'écriture.
8. **Plafonds provisoires** (`PLAFONDS_SERIE`) : fourchette du testeur (entre 1 000 et 1 000 000 m, entre 100 000 et 100 000 000 plants ; proposé : 10 000 m, 1 000 000 plants), à valider par Théophane avec Q13.

## Décisions du chef après la relecture de sécurité

1. **Bloquant : une occupation qui n'est pas celle d'une série ne se modifie pas depuis le téléphone.** Un PATCH sur une occupation dont la ligne existante a `serie_id` nul, ou `plantation_id` ou `evenement_id` non nul, est refusé (`ecriture_invalide`), même s'il remet ces colonnes à NULL et ajoute un `serie_id`. La ligne ne change pas et aucun historique n'est écrit. Sonde : l'occupation de la plantation de kiwis transformée en occupation de série 2027 était acceptée.
2. **Rétablissement** (`supprime_le` non nul → NULL) : toutes les références sont revérifiées comme si elles changeaient. Une saison, une espèce, une variété, un itinéraire ou une planche supprimés entre-temps font refuser le rétablissement.
3. **Fin de lot** : `verifierFinDeLot` ne lit que les occupations de la ferme. Une occupation d'une autre ferme qui désignerait la série (possible seulement par une écriture directe en base, faute de clé composée) ne bloque ni son décalage ni sa suppression, et ne révèle rien.

## Critères d'acceptation

- [ ] Un test d'intégration Postgres par règle, y compris :
  - une ferme étrangère ;
  - une date prévue fausse ;
  - une transaction à moitié invalide ;
  - un DELETE ;
  - un changement de ferme ;
  - l'historique `avant` et `apres`.
- [ ] `pnpm e2e:synchro` : le téléphone A, hors ligne, crée une série sur deux planches, la modifie, puis annule la modification. Le téléphone B reçoit la série dans son état final, et l'historique serveur compte les lignes attendues.

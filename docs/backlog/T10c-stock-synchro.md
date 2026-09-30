# T10c — Synchro : le serveur accepte les saisies de stock des téléphones

**Objectif** : une récolte saisie au champ (T13) arrive au serveur avec son effet sur le stock, et son annulation aussi. Aucune ligne de stock ne peut être modifiée, effacée ou écrite pour une autre ferme.

**Dépend de** : T10, T10b
**Bloque** : T13 (sa PR attend celle-ci)
**Périmètre** : `apps/api/src/sync/**`, `apps/api` (amorçage e2e), la porte de `packages/sync` (écriture de plusieurs lignes en une transaction, que T13 réutilisera), `scripts/e2e-synchro.ts` (projet compose et port de page paramétrables), la page `diagnostic/synchro.html`, les règles des saisies du cœur (`packages/core`, T10b) si une règle y a sa place, `packages/sync` (règles de synchro), les tests de synchro de bout en bout (`pnpm e2e:synchro`)

## Constat

`apps/api/src/sync/upload.ts` n'accepte que la table `evenement` (`TABLES_ECRITES`). Les lignes `article_stock` et `mouvement_stock` écrites par le téléphone seraient refusées au retour du réseau (motif `table_interdite`).

## Règles

- **`mouvement_stock` : ajout seul.**
  - Seule la création est acceptée ; une modification ou un effacement est refusé.
  - Une ligne identique renvoyée (même id, mêmes valeurs) est acceptée sans double écriture. Même id avec d'autres valeurs : refusé.
  - L'article de stock appartient à la ferme du jeton.
  - `quantite` est un nombre fini, non nul, dans les plafonds déjà appliqués aux récoltes (T10b ; Q13 reste ouverte).
  - `motif = 'recolte'` si et seulement si `recolte_id` est présent. `recolte_id` désigne un événement de type récolte (ou son annulation ou sa correction) de la même ferme.
  - Un mouvement négatif avec le motif `recolte` n'est accepté que s'il est rattaché à une annulation ou une correction d'une récolte. On ne peut pas vider le stock par une fausse récolte.
- **`article_stock` : création seule** depuis un téléphone, avec une espèce visible par la ferme (la sienne ou la bibliothèque commune) et une unité valide. Un article identique renvoyé est accepté. Modifier ou effacer est refusé, faute d'écran qui le demande.
- **Une saisie = une transaction.** Une transaction qui mêle événement, article et mouvement est acceptée ou refusée en entier. Si un morceau est refusé, rien n'est écrit, et le motif est journalisé comme pour les autres refus (T10).
- **Les refus ne perdent rien en silence.** Même comportement que pour les événements refusés : T10 fixe le sort de la ligne dans la file et ce que voit l'utilisateur. Suivre T10.

## Décisions du chef (2026-09-30, après les tests)

1. **Tout ou rien** pour un lot qui contient une écriture de stock ; un lot d'événements seuls garde la règle de T10.
2. **Écritures valides d'un lot refusé** : elles figurent aussi dans les refus, pour ne rien perdre en silence.
3. **Mouvement inverse borné.**
   - Annulation : le mouvement rattaché vaut exactement l'opposé de la somme des mouvements de la récolte d'origine, sur le même article.
   - Correction : le mouvement rattaché vaut la différence entre la nouvelle quantité et celle en vigueur.
4. **Plafond** : |quantité| ≤ plafond provisoire, pour tous les motifs.
5. **Motifs acceptés depuis un téléphone : `recolte` seulement**, pour l'instant. Vente, perte et ajustement n'ont pas d'écran : ils sont refusés jusqu'au ticket qui les saisira. On n'ouvre pas une porte dont personne n'a besoin.
6. **Modifier ou effacer un article** : refusé, motif `ajout_seul` ou `table_interdite`.
7. **Banc `e2e:synchro`** : le nom du projet compose et le port de la page sont paramétrables, pour que deux équipes puissent le lancer en même temps.

## Critères d'acceptation

- [ ] Un test par règle, côté API (intégration Postgres), y compris :
  - l'écriture pour une autre ferme ;
  - la modification et l'effacement d'un mouvement ;
  - le renvoi identique et le renvoi différent ;
  - le mouvement négatif non rattaché ;
  - la transaction à moitié invalide.
- [ ] `pnpm e2e:synchro` : l'amorçage de l'API sait créer une ferme avec une série de tomates en récolte. Le téléphone A, hors ligne, note 12 kg, les annule, puis revient en ligne. Le téléphone B reçoit la récolte et son annulation, les deux mouvements (+12 et −12), et un stock inchangé.

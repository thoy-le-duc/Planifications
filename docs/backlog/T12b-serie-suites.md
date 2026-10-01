# T12b — Formulaire de série : suites de la relecture T12

**Objectif** : le formulaire de série reste juste et agréable sur tous les téléphones, y compris l'iPhone, et ne garde rien de périmé.

**Dépend de** : T12
**Périmètre** : `apps/web/src/ecrans/serie/**`, `apps/web/src/ecrans/plan/**`

## Constats (relecture T12, non bloquants)

- **N8. Sélecteur de semaine.** `<input type="week">` n'a pas de sélecteur sur iOS Safari ni sur Firefox Android : il faut taper « 2027-W22 » à la main. Il faut un sélecteur de semaine maison, tactile, avec des cibles d'au moins 56 px et des libellés en français (« S22 · 31 mai »).
- **Sélecteur d'ancre coupé.** Sur la capture à 390 px, le libellé « Récolte à partir de » déborde de son bouton et est rogné en haut. Le libellé doit tenir (par exemple « Récolte » avec « à partir de » en dessous, ou une taille adaptée), sans passer sous 56 px de cible.
- **N1. Ancre hors lundi.** Une série importée dont l'ancre n'est pas un lundi est recalée au lundi dès qu'on l'enregistre, même si seule la longueur a changé. Il faut garder l'ancre d'origine tant que la semaine n'est pas touchée.
- **N2. Variété supprimée.** Si la variété d'une série a été supprimée de la bibliothèque, « Enregistrer » la remplace par `null` sans prévenir. Il faut la garder, ou prévenir avant.
- **N3. Décision de rotation périmée.** Si on change de culture ou si l'alerte rouge disparaît, l'ancien `rotation_acceptee` reste sur la série. Il faut l'effacer quand il ne correspond plus.
- **N5. Bandeau « Annuler » et autre téléphone.** Le bandeau rétablit toutes les colonnes, y compris `statut` et `supprime_le`. Si un autre téléphone a changé la série pendant ces 10 s, ses changements sont écrasés. Il faut vérifier que la ligne n'a pas changé depuis la saisie avant d'annuler, et prévenir sinon.

## Critères d'acceptation

- [ ] Sélecteur de semaine maison, testé à 360 px, sans champ `type=week`.
- [ ] Un test par constat N1, N2, N3 et N5.
- [ ] Formulaire toujours en moins de 300 ms, recalcul en moins de 100 ms (CPU ×4).

## Décisions du chef (après les tests)

1. **Libellé « Récolte à partir de »** : le constat venait de la capture (carte passée sous l'en-tête fixe), pas d'un débordement. Rien à corriger ; le test e2e reste comme garde-fou.
2. **N2** : la variété supprimée est gardée sur la série (le serveur l'accepte : `variete_id` n'est revérifié que s'il change) ; elle n'est plus proposée à la recherche.
3. **N5, occupation modifiée ailleurs** : sa série reste aussi telle quelle, pour que tout reste valide.
4. **N5, création modifiée ailleurs puis « Annuler »** : la série créée est quand même supprimée doucement (comme T24 : c'est sa propre saisie, dans les 10 s).
5. **N1** : revenir à la semaine d'origine après l'avoir changée donne le lundi (pas de mémoire de l'ancre d'origine) ; non testé.
6. **Libellé de semaine** : « S22 · 31 mai 2027 », mois court et année.

## Décisions du chef (après la relecture)

7. **N5, série supprimée ailleurs** : « Annuler » ne rend jamais active une occupation dont la série n'est pas active après l'annulation ; ces occupations restent telles quelles et le message « modifié entre-temps » s'affiche. (Même trou dans `ramener` de T24 : ticket T24b.)
8. **N2 corrigée** : le serveur revérifie la variété quand l'espèce, la variété **ou l'itinéraire** change. Donc, si l'itinéraire change sur une série dont la variété a été supprimée, le formulaire retire la variété et le dit avant d'enregistrer (« variété X retirée : supprimée de la bibliothèque »). Sans changement d'itinéraire, la variété est gardée.
9. **Sélecteur, petits correctifs** : le focus entre toujours dans la feuille de choix rapide (sur la semaine choisie, sinon sur le titre) ; le liseré de la semaine en cours passe à l'orange foncé (contraste ≥ 3:1).

## Décision du chef (après la contre-relecture)

10. **Règle générale de l'annulation** : avant d'écrire, l'état de chaque série après annulation est vérifié comme le serveur le fera en fin de lot :
    - la série passe `validerSerie` et ses références (espèce, variété, itinéraire, saison) existent et ne sont pas supprimées en local ;
    - aucune occupation active sous une série supprimée ;
    - toute occupation active de la série passe `validerOccupation` avec la série ramenée.

    Si une condition échoue, la série et ses occupations restent telles quelles, avec le message « modifié entre-temps » ; le reste est défait. Cette règle couvre B3 (rétablissement annulé avec une planche ajoutée ailleurs) et B4 (variété ou itinéraire supprimé remis par l'annulation), et les cas voisins.

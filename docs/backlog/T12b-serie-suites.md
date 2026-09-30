# T12b — Formulaire de série : suites de la relecture T12

**Objectif** : le formulaire de série reste juste et agréable sur tous les téléphones, y compris l'iPhone, et ne garde rien de périmé.

**Dépend de** : T12
**Périmètre** : `apps/web/src/ecrans/serie/**`, `apps/web/src/ecrans/plan/**`

## Constats (relecture T12, non bloquants)

- **N8. Sélecteur de semaine.** `<input type="week">` n'a pas de sélecteur sur iOS Safari ni sur Firefox Android : il faut taper « 2027-W22 » à la main. Il faut un sélecteur de semaine maison, tactile, avec des cibles d'au moins 56 px et des libellés en français (« S22 · 31 mai »).
- **N1. Ancre hors lundi.** Une série importée dont l'ancre n'est pas un lundi est recalée au lundi dès qu'on l'enregistre, même si seule la longueur a changé. Il faut garder l'ancre d'origine tant que la semaine n'est pas touchée.
- **N2. Variété supprimée.** Si la variété d'une série a été supprimée de la bibliothèque, « Enregistrer » la remplace par `null` sans prévenir. Il faut la garder, ou prévenir avant.
- **N3. Décision de rotation périmée.** Si on change de culture ou si l'alerte rouge disparaît, l'ancien `rotation_acceptee` reste sur la série. Il faut l'effacer quand il ne correspond plus.
- **N5. Bandeau « Annuler » et autre téléphone.** Le bandeau rétablit toutes les colonnes, y compris `statut` et `supprime_le`. Si un autre téléphone a changé la série pendant ces 10 s, ses changements sont écrasés. Il faut vérifier que la ligne n'a pas changé depuis la saisie avant d'annuler, et prévenir sinon.

## Critères d'acceptation

- [ ] Sélecteur de semaine maison, testé à 360 px, sans champ `type=week`.
- [ ] Un test par constat N1, N2, N3 et N5.
- [ ] Formulaire toujours en moins de 300 ms, recalcul en moins de 100 ms (CPU ×4).

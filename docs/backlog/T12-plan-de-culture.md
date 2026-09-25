# T12 — Plan de culture : créer et modifier une série

**Objectif** : planifier une série en quelques gestes, en voyant tout de suite ses dates, les conflits de place et les alertes de rotation.

**Dépend de** : T04, T05, T11
**Périmètre** : `apps/web/src/ecrans/serie/**`, `apps/web/e2e/serie.e2e.ts`

## Règles

- Formulaire : culture (recherche dans la bibliothèque de la ferme), itinéraire (proposé selon la culture et la période), ancre (semis, plantation ou « récolte à partir de la semaine… »), emplacements et longueur.
- Dès qu'un champ change : dates recalculées (T02), besoins (T05), conflits (T03) et alertes de rotation (T04) affichés, sans bouton « calculer ».
- Une alerte rouge n'empêche pas d'enregistrer, mais demande une confirmation explicite ; la décision est gardée dans l'historique.
- Modifier une série crée une ligne de MODIFICATION ; annulation possible depuis l'historique.
- Création rapide depuis la vue 2D : appui long sur une case vide pré-remplit emplacement et semaine.

## Critères d'acceptation

- [ ] Test Playwright : créer la batavia de T02 en moins de 8 gestes depuis la vue 2D ; dates affichées conformes à T02.
- [ ] Test : placer des choux sur une planche de la chapelle C3 (jeu de test de T04) affiche l'alerte rouge et demande confirmation.
- [ ] Test : modifier puis annuler une série restaure l'état initial.
- [ ] Formulaire affiché en moins de 300 ms, recalcul en moins de 100 ms (CPU ralenti ×4).

**Hors périmètre** : création de cultures et d'itinéraires (l'import T14 les fournit), plantations pérennes (ticket suivant).

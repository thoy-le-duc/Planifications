# T24 — Écran : mes itinéraires et mes types d'intervention

**Objectif** : chaque ferme décrit sa façon de cultiver. Elle crée ses itinéraires ou part d'un itinéraire de la bibliothèque, règle les durées, la densité et les travaux prévus, et adapte la liste de ses types d'intervention.

**Dépend de** : T22, T23
**Périmètre** : `apps/web/src/ecrans/itineraires/**`, `apps/web/src/ecrans/ferme/**` (entrée depuis l'onglet Ferme), `apps/web/e2e/itineraires.e2e.ts`

## Règles (décisions de Théophane, 2026-09-30)

- **Liste des itinéraires par culture.** Ceux de la ferme sont modifiables. Ceux de la bibliothèque commune se consultent, et un bouton « Adapter pour ma ferme » les duplique.
- **Un itinéraire se règle en quelques gestes** : mode, durées, densité, puis les travaux prévus. Pour chaque travail : le type, « X jours avant ou après » un repère, la répétition éventuelle, le temps estimé facultatif.
- **Aperçu calculé en direct** : les dates des travaux pour un exemple de série, recalculées par le cœur, sans bouton « calculer ».
- **Modifier un itinéraire utilisé** :
  - les séries passées ne bougent jamais ;
  - pour les séries à venir, l'appli propose « appliquer aux N séries à venir ? » avec la liste des séries, et une confirmation explicite ;
  - tout s'écrit en une transaction, annulable.
- **Types d'intervention de la ferme** : ajouter, renommer ou masquer. Un type déjà utilisé ne se supprime pas, il se masque.
- **Travail qui ne tombe jamais** : un travail valide peut n'avoir aucune date (par exemple +60 j après la mise en place, répété jusqu'au début de récolte à +49 j). L'écran le signale au lieu de l'enregistrer en silence (relecture T22).
- **Au champ** : cibles d'au moins 56 px, et l'écran marche hors ligne.

## Critères d'acceptation

- [ ] e2e : adapter l'itinéraire « Batavia » de la bibliothèque, y ajouter « grelinette 10 j avant la mise en place » et « désherbage tous les 14 j » ; les tâches apparaissent dans Aujourd'hui pour une nouvelle série.
- [ ] e2e : modifier l'itinéraire et l'appliquer aux séries à venir ; les séries passées sont inchangées ; l'annulation rétablit tout.
- [ ] Formulaire en moins de 300 ms, aperçu recalculé en moins de 100 ms (CPU ×4).

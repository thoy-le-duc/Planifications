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

## Décisions du chef (après les tests)

Interprétations du testeur retenues :
1. « Adapter pour ma ferme » ouvre le formulaire prérempli (« <nom> (ma ferme) ») ; la copie ne s'écrit qu'à l'enregistrement, en une transaction.
2. Série « à venir » = statut « prévue », aucun réalisé ni récolte en vigueur, première date prévue ≥ aujourd'hui. Une série en retard sans saisie n'est pas modifiée (prudence).
3. Pas de confirmation si seul le nom change ; « Itinéraire seul » laisse les séries intactes.
4. Un travail qui ne tombe jamais est signalé, pas bloqué.
5. Série d'exemple de l'aperçu : lundi de début de la période d'usage (prochaine occurrence), sinon premier lundi après aujourd'hui.
6. Pas de suppression de type : on masque. Un type masqué reste affiché sur le travail qui l'utilise déjà.
7. Le bandeau « Annuler » (10 s) vit dans l'écran des itinéraires et couvre aussi les types.
8. L'e2e compare les textes du détail des barres de Planches avant et après.

## Décisions du chef (après la relecture)

9. **Annuler ne ramène que ce que l'écriture a changé** : colonne par colonne, et seulement si la valeur actuelle est encore celle que nous avions écrite ; sinon l'annulation de cette ligne est refusée avec un message (« modifié entre-temps sur un autre téléphone »). Vaut pour l'itinéraire, les séries et les occupations.
10. **Série « à venir »** : exclut aussi une série qui a une intervention en vigueur (un travail déjà fait).
11. **Revérification à l'écriture** : le caractère « à venir » est revérifié dans la transaction ; une série devenue commencée entre-temps n'est pas modifiée.
12. **Lot trop gros** : si itinéraire + séries + occupations dépassent 500 écritures, la confirmation le dit avant d'écrire (« trop de séries en une fois, utilisez Itinéraire seul »), au lieu d'un refus générique.

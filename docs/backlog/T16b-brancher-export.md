# T16b — Brancher l'export dans l'onglet Ferme

**Objectif** : le bouton « Exporter toute ma ferme » de l'onglet Ferme lance vraiment l'export (T15, T15b), hors ligne compris.

**Dépend de** : T11 (l'appli ouvre sa base locale)
**Périmètre** : `apps/web/src/ecrans/ferme/**`, `apps/web/src/ecrans/export/**`, le test d'empaquetage de T15, et `packages/sync/src/export.ts` (lecture de la base : décision du chef, voir plus bas)

## Règles

- L'écran Ferme obtient la porte de données et la ferme active ouvertes par l'appli (T11) et charge `EcranExport` à la demande.
- Le test d'empaquetage de T15 est revu : l'écran d'export peut atteindre PowerSync par la base déjà ouverte, mais rien de l'export ne doit entrer dans l'entrée principale.
- Aujourd'hui (T16), le bouton affiche « Pas encore branché ».

## Décisions du chef (2026-09-30, après les tests)

- **Lecture de la base dans le périmètre.** Mesuré dans le navigateur (hors ligne, CPU ×4, ferme T07), avec un branchement provisoire : 11,9 à 13,0 s du tap au téléchargement, et une tâche longue de 190 à 213 ms. Elle vient des 21 lectures parallèles d'`exporterFerme`, qui reviennent du worker PowerSync en un seul message. Les seuils des tests (10 s, aucune tâche de plus de 50 ms) sont justes : on corrige la lecture (par pages ou table par table), pas les seuils.
- **Interprétations des tests retenues :**
  - un seul tap lance l'export ;
  - un seul bouton « Exporter toute ma ferme » à l'écran ;
  - l'explication est présente dans l'écran, sans `aria-describedby` exigé ;
  - l'export est annulé avant l'effacement, et continue si la personne renonce à se déconnecter ;
  - le test unitaire de déconnexion simule l'effacement.

## Critères d'acceptation

- [ ] e2e : export depuis l'onglet Ferme, hors ligne, archive valide téléchargée.
- [ ] Budget de démarrage inchangé.

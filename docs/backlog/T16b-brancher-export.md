# T16b — Brancher l'export dans l'onglet Ferme

**Objectif** : le bouton « Exporter toute ma ferme » de l'onglet Ferme lance vraiment l'export (T15, T15b), hors ligne compris.

**Dépend de** : T11 (l'appli ouvre sa base locale)
**Périmètre** : `apps/web/src/ecrans/ferme/**`, `apps/web/src/ecrans/export/**`, le test d'empaquetage de T15

## Règles

- L'écran Ferme obtient la porte de données et la ferme active ouvertes par l'appli (T11) et charge `EcranExport` à la demande.
- Le test d'empaquetage de T15 est revu : l'écran d'export peut atteindre PowerSync par la base déjà ouverte, mais rien de l'export ne doit entrer dans l'entrée principale.
- Aujourd'hui (T16), le bouton affiche « Pas encore branché ».

## Critères d'acceptation

- [ ] e2e : export depuis l'onglet Ferme, hors ligne, archive valide téléchargée.
- [ ] Budget de démarrage inchangé.

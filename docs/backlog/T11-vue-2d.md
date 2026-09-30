# T11 — Vue 2D planches × semaines

**Objectif** : l'écran principal de planification : toutes les planches en lignes, les semaines en colonnes, chaque culture en barre, les conflits en évidence.

**Dépend de** : T03, T10
**Périmètre** : `apps/web/src/ecrans/plan/**`, `apps/web/e2e/plan.e2e.ts`, et l'ouverture de la base locale dans l'appli (`apps/web/src/donnees/**`, `apps/web/src/App.tsx`)

## Règles

- Lignes groupées par zone puis chapelle ; une ligne par emplacement actif sur la saison affichée.
- Barres : une par occupation, couleur par famille botanique, libellé culture + variété ; prévu et réel distingués (réel plein, prévu hachuré).
- Conflits de T03 en rouge sur la barre et sur la ligne.
- Semaine courante marquée ; changement de saison sans rechargement.
- Lecture seule dans ce ticket : toucher une barre ouvre le détail de la série.
- Défilement fluide sur 400 lignes : seules les lignes visibles sont dessinées.

## Ouverture de la base locale (ajout du 2026-09-30)

T11 est le premier écran qui lit des données : il ouvre la base locale PowerSync dans l'appli (session et ferme active connues, porte `@planif/sync`), chargée à la demande hors de l'entrée principale, et la garde ouverte pour les écrans suivants (T13, T16b, T14b). L'état de la synchro reste visible.

## Critères d'acceptation

- [ ] Avec le jeu de T07 et CPU ralenti ×4 : écran affiché en moins de 300 ms depuis la navigation, depuis le cache, hors ligne (test Playwright).
- [ ] Défilement vertical de haut en bas sans image perdue au-delà de 50 ms (mesure dans le test).
- [ ] Fonctionne hors ligne, à 360 px de large (mode sombre : ticket T18, pour tous les écrans).
- [ ] Budget de démarrage : toute hausse au-delà de 70 Kio est justifiée dans la PR ; PowerSync et le WASM restent hors de l'entrée principale.
- [ ] Test : un conflit du jeu de données est visible et nommé.

**Hors périmètre** : édition des séries (T12), vue 3D (phase 3).

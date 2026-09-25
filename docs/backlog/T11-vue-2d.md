# T11 — Vue 2D planches × semaines

**Objectif** : l'écran principal de planification : toutes les planches en lignes, les semaines en colonnes, chaque culture en barre, les conflits en évidence.

**Dépend de** : T03, T10
**Périmètre** : `apps/web/src/ecrans/plan/**`, `apps/web/e2e/plan.e2e.ts`

## Règles

- Lignes groupées par zone puis chapelle ; une ligne par emplacement actif sur la saison affichée.
- Barres : une par occupation, couleur par famille botanique, libellé culture + variété ; prévu et réel distingués (réel plein, prévu hachuré).
- Conflits de T03 en rouge sur la barre et sur la ligne.
- Semaine courante marquée ; changement de saison sans rechargement.
- Lecture seule dans ce ticket : toucher une barre ouvre le détail de la série.
- Défilement fluide sur 400 lignes : seules les lignes visibles sont dessinées.

## Critères d'acceptation

- [ ] Avec le jeu de T07 et CPU ralenti ×4 : écran affiché en moins de 300 ms depuis la navigation, depuis le cache, hors ligne (test Playwright).
- [ ] Défilement vertical de haut en bas sans image perdue au-delà de 50 ms (mesure dans le test).
- [ ] Fonctionne hors ligne, à 360 px de large, en mode sombre et clair.
- [ ] Test : un conflit du jeu de données est visible et nommé.

**Hors périmètre** : édition des séries (T12), vue 3D (phase 3).

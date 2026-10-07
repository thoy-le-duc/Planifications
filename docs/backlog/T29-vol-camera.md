# T29 — Vue 3D : la caméra vole vers une serre ou une zone

**Objectif** : cliquer sur « serre M3 », dans la scène ou dans la liste, et la caméra vole et se cale pile sur cette serre (Q30).

**Dépend de** : T27b (mêmes fichiers ; marche déjà sur les socles de T27, puis sur les serres réelles de T28c sans autre travail)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/e2e/vue-3d.e2e.ts`

## Règles

- **Cadrage** : fonction pure `cadrage(boite, champVertical, rapportEcran, direction)` → `{ position, cible }` : la boîte englobante de la zone (ou du bâtiment) tient entière à l'écran avec 10 % de marge, vue de biais (environ 45° de plongée), dans le sens de la caméra actuelle (pas de demi-tour inutile).
- **Vol** : interpolation de la position et de la cible en 600 ms au plus, départ et arrivée en douceur ; un nouveau clic pendant le vol repart de là où on est.
- `prefers-reduced-motion: reduce` → saut direct, sans animation.
- **Déclencheurs** : clic sur une zone ou un bâtiment dans la scène ; bouton dans la liste texte (alternative accessible), avec Entrée au clavier ; « Vue d'ensemble » revient au cadrage de toute la ferme.
- Rendu à la demande conservé : la boucle d'images ne tourne que pendant le vol.

## Critères d'acceptation

- [ ] Tests de `cadrage` : boîte carrée, boîte très allongée (tunnel de 50 m × 8 m), écran étroit, boîte tournée ; la boîte projetée tient dans l'écran avec sa marge.
- [ ] Test de l'interpolation : durée 600 ms, début et fin exacts, reprise en cours de vol.
- [ ] e2e (ordinateur) : cliquer « M3 » dans la liste → au plus 600 ms + 1 image plus tard, la caméra est sur le cadrage attendu ; pas de rafale de plus de 2 images perdues pendant le vol.
- [ ] e2e avec `reducedMotion: 'reduce'` : saut direct.
- [ ] Budget `jsVue3dGzKio` tenu.

**Hors périmètre** : sélection d'une planche et détail d'une série, recherche par la voix (« montre-moi M3 »).

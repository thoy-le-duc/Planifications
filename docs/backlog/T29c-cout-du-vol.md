# T29c — Vue 3D : coût propre au vol de caméra

**Objectif** : pendant un vol de caméra, la vue reste aussi fluide que la navigation, pour que le critère de fluidité des vols tienne à chaque lancement.

**Constat** (T29b) : sous SwiftShader, les intervalles entre images font environ 50 ms pendant un vol, contre 17 à 33 ms en navigation sur la même scène (ferme T07, 2 appels de dessin). Le critère « au plus 1 vol saccadé sur 5 à chaque lancement » n'est tenu que 3 fois sur 5 (0, 1, 2, 2, 1 vol saccadé sur 5). Le coût propre au vol n'est pas encore nommé.

**Dépend de** : T29b (fait)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`

## Règles

- **Mesurer avant de changer** : relever, sur la même scène et la même machine, ce qui diffère entre une image de vol et une image de navigation (mise à jour de la projection, écritures `data-*` dans le DOM, double invalidation de la toile, rendu plein écran, etc.). Le résultat (la cause, avec les chiffres avant et après) est écrit dans la PR et dans le journal.
- **Réduire le coût identifié** sans changer ce que voit le maraîcher : même cadrage, même courbe et même durée de vol (600 ms au plus, T29), même rendu à la demande (la boucle d'images ne tourne que pendant le vol).
- **Seuils et garde-fous de T29b inchangés** : `IMAGES_PERDUES_MAX`, `PASSAGES_SACCADES_ECHEC`, `RAFALES_TOTAL_MAX`, garde-fous de `apps/web/e2e/fluidite-3d.ts`. Aucun seuil relevé, aucun test désactivé.
- Si la cause est le rendu logiciel lui-même et non le code, le ticket se termine par un constat chiffré et une question dans `docs/questions.md`, sans relever les seuils.
- Budget `jsVue3dGzKio` tenu ; si le JavaScript de la vue change, le chiffre est justifié dans la PR.

## Critères d'acceptation

- [ ] La différence entre image de vol et image de navigation est nommée dans la PR, avec des chiffres mesurés avant et après correction.
- [ ] Un test unitaire couvre la correction (par exemple : pendant un vol, pas de mise à jour inutile de la projection ou de l'écriture DOM par image, nombre borné).
- [ ] Aspect et durée inchangés : les tests de `cadrage` et d'interpolation (T29) restent verts sans modification.
- [ ] e2e `vue-3d-camera.e2e.ts`, cinq lancements consécutifs sur machine libre : au plus 1 vol saccadé sur 5 à chaque lancement (5 lancements sur 5).
- [ ] Seuils de nombre inchangés (vérifié par `git diff origin/main -- apps/web/e2e/ | grep -E 'IMAGES_PERDUES_MAX|PASSAGES_SACCADES_ECHEC|RAFALES_TOTAL_MAX'`).
- [ ] `pnpm verif` passe en entier.

## Risques

- Le gain dépend de la machine : sous SwiftShader, le rendu logiciel (18 à 24 ms par image) peut rester le goulot.
- Mesures bruitées : on compare des médianes sur plusieurs lancements, pas un lancement isolé (méthode de T31).

**Hors périmètre** : relever les seuils ou désactiver le test ; changer la durée ou la courbe du vol ; sélection d'une planche ; rendu sur carte graphique réelle.

## Résultat (2026-10-08) : constat, aucune correction de code

Mesuré sans rien modifier (scripts jetables) : **ce n'est pas le code.**

- Le « 17–33 ms en navigation » venait du glissé de l'e2e, rythmé par des allers-retours Playwright : entre deux mouvements, le rendu logiciel rattrape son retard. Une navigation **continue** (un mouvement à chaque image) coûte autant qu'un vol : médiane 38–39 ms, p90 ~58 ms, contre 28–45 ms pour le vol selon la charge.
- Vol et navigation font exactement le même travail par image : un rendu par rAF, 2 appels de dessin, ~0,6 ms de JS, aucun layout, projection recalculée en quelques microsecondes.
- Sans les appels de dessin, les intervalles retombent à 18–25 ms : le coût est le dessin de SwiftShader (rendu logiciel de la machine de test), pas la vue.
- Le critère « au plus 1 vol saccadé sur 5 » dépend surtout de la charge de la machine (28 ms contre 45 ms pour le même code à quelques minutes d'écart).

**Décision du chef** : pas de baisse de résolution pendant le vol (elle changerait ce que voit le maraîcher pour un défaut qui n'existe que sur une machine sans carte graphique ; la 3D est réservée à l'ordinateur). Les garde-fous stables de T29b (JS, appels de dessin, triangles) protègent le code ; le critère des 5 lancements n'est pas retenu comme arbitre. Ticket clos sur ce constat.

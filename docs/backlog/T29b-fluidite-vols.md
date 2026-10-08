# T29b — Vue 3D : fluidité des vols robuste

**Objectif** : que le vol de caméra reste fluide même quand la machine est chargée, en trouvant la cause du coût par image plutôt qu'en relevant les seuils. Aujourd'hui, le test de fluidité des vols échoue de façon aléatoire sous WebGL logiciel (SwiftShader) : on ne sait pas si c'est le code ou la machine, et le test ne peut pas servir de garde-fou tant que ce doute dure.

**Constat** : l'e2e `apps/web/e2e/vue-3d-camera.e2e.ts` (fluidité des vols : échec à 4 vols saccadés sur 5, ou plus de 6 intervalles fautifs) compte entre 0 et 4 vols saccadés selon la charge de la machine. Un lancement isolé peut échouer. Le coût par image pendant un vol n'a pas encore été mesuré.

**Dépend de** : T29, T28c (faits)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`

## Règles

- **Mesurer avant de changer** : profil par image pendant un vol (temps JavaScript, temps de rendu, nombre d'objets dessinés), relevé sur la même machine et les mêmes scénarios que l'e2e. Le résultat (la cause, avec les chiffres) est écrit dans la PR et dans le journal.
- **Réduire le coût identifié**, sans changer ce que voit le maraîcher : même cadrage, même durée de vol (600 ms au plus, T29), même rendu à la demande (la boucle d'images ne tourne que pendant le vol).
- **Seuils et test intouchés** : `IMAGES_PERDUES_MAX`, `PASSAGES_SACCADES_ECHEC`, `RAFALES_TOTAL_MAX` et le fichier `vue-3d-camera.e2e.ts` restent tels quels. Toute mesure temporaire reste hors du dépôt ou est retirée avant la PR.
- **Budget** : `jsVue3dGzKio` tenu ; si le JavaScript de démarrage change, le chiffre est justifié dans la PR.

## Critères d'acceptation

- [x] La cause est nommée dans la PR avec des chiffres mesurés (temps par image, nombre d'objets dessinés pendant un vol), avant et après correction.
- [x] Si une réduction de coût est faite, un test unitaire la couvre (par exemple : le nombre d'objets dessinés pendant un vol ne dépend pas des planches hors champ).
- [x] e2e `vue-3d-camera.e2e.ts`, cinq lancements consécutifs sur machine libre : au plus 1 vol saccadé sur 5 à chaque lancement.
- [x] Les seuils et le fichier e2e sont identiques à `main` (vérifié par `git diff origin/main -- apps/web/e2e/`, vide).
- [x] Tests de `cadrage` et d'interpolation (T29) inchangés et verts.
- [x] `pnpm verif` passe en entier.
- [x] Budget `jsVue3dGzKio` tenu.

## Risques

- Le gain dépend de la machine : sous SwiftShader, le rendu logiciel peut rester le goulot. Si la cause est le rendu lui-même et non le code, le ticket se termine par un constat chiffré et une question dans `docs/questions.md`, sans relever les seuils.
- Mesures bruitées : on compare des médianes sur plusieurs lancements, pas un lancement isolé.

**Hors périmètre** : relever les seuils ou désactiver le test ; changer la durée ou la courbe du vol ; sélection d'une planche (T29 hors périmètre) ; rendu sur carte graphique réelle.

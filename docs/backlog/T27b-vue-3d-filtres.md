# T27b — Vue 3D : filtres et couleurs lisibles

**Objectif** : juger d'un coup d'œil où sont les cultures d'une famille, d'une culture ou d'une zone, sans confondre une culture avec une planche vide (Q30). Aujourd'hui, sur la démo, courgette, asperge et fraise apparaissent grises comme le vide, et la légende recouvre la scène.

**Dépend de** : T27 (PR #108, en revue : partir de `ticket/T27-vue-3d` tant qu'elle n'est pas fusionnée)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/src/ui/jetons.ts` (+ son test), `apps/web/src/jetons.css` (généré), `apps/web/src/ecrans/plan/calculs.ts` (seulement `CleFamille` et `cleFamille`), `apps/web/e2e/vue-3d.e2e.ts`

## Constat

`CleFamille` ne connaît que 4 groupes (salades, solanacées, crucifères, racines) ; les 12 autres familles de la bibliothèque commune (Alliacées, Amaranthacées, Asparagacées, Convolvulacées, Cucurbitacées, Fabacées, Lamiacées, Paeoniacées, Poacées, Polygonacées, Rosacées, Valérianacées) tombent sur `COULEUR_NEUTRE`, la couleur du vide.

## Règles

- **Couleurs** : une couleur par famille de la bibliothèque commune (16), dans `FAMILLES` et `FAMILLES_SOMBRES` (`jetons.ts` reste la seule source des couleurs, règle de T16). Une famille propre à la ferme, ou une culture sans famille : couleur « autre famille », distincte du vide. La 2D (plan des planches) profite des mêmes couleurs sans autre changement.
- **Vide ≠ culture** : une planche vide reste neutre **et** plus basse (ou à plat) ; aucune famille n'a une couleur proche du neutre.
- **Filtres** : cases à cocher par famille, par culture (espèce) et par zone, avec « tout » / « rien » ; ce qui est décoché est estompé (neutre pâle), pas retiré, pour garder le repère. État local à l'écran, aucune écriture, rien de stocké.
- Les filtres s'appliquent aussi à l'alternative texte (liste des planches et cultures de la semaine).
- **Légende** : dans un panneau à côté de la scène (ordinateur), jamais par-dessus ; elle ne liste que les familles présentes la semaine affichée, et sert de filtre (taper une famille = la cocher ou décocher).
- Changer un filtre ne reconstruit pas la géométrie : seules les couleurs des instances changent.

## Critères d'acceptation

- [ ] Test (`jetons.test.ts`) : 16 familles + « autre », clair et sombre ; toutes différentes deux à deux et du neutre, écart de couleur (ΔE CIE76) au-dessus d'un seuil fixé dans le test (au moins 10 entre familles, 20 avec le neutre), justifié dans la PR ; texte posé dessus lisible à 4,5:1 comme aujourd'hui.
- [ ] Test de `cleFamille` : chaque famille de la bibliothèque commune a sa clé, sans accents ni casse ; famille inconnue → « autre » ; pas de famille (couverture) → « autre ».
- [ ] Test unitaire de l'adaptateur : courgette, asperge, fraise de la ferme de démo ne sont plus à la couleur du vide ; filtre famille, culture, zone, et leur combinaison ; « rien » coché → tout estompé.
- [ ] e2e (ordinateur, grande ferme) : changer un filtre en moins de 100 ms ; la légende ne recouvre aucun pixel de la scène (boîtes disjointes) ; mesures de T27 inchangées.
- [ ] Budget `jsVue3dGzKio` (200 Kio) tenu ; JS de démarrage inchangé.

## Risques

- 16 couleurs distinctes en clair et en sombre, c'est à la limite de ce que l'œil sépare : le filtre et la légende-filtre compensent. Si le seuil ΔE est intenable, regrouper des familles proches (le dire dans la PR, ne pas baisser le seuil en silence).

**Hors périmètre** : placement réel (T28*), vol de caméra (T29), filtres mémorisés entre deux visites.

# T28e — Éditeur de placement : suites de relecture

**Objectif** : corriger les points non bloquants relevés en relecture de T28b, pour que l'éditeur de placement se tienne au clavier, dise ce qui se passe et ne laisse pas une tuile en erreur attendre le réseau. Rien de cela ne change le calcul ni ce qui est écrit.

**Dépend de** : T28b (fait), T28d (à faire : même écran, à enchaîner après)
**Périmètre** : `apps/web/src/ecrans/placement/**`

## Règles

- **Clavier seul** : en mode pose, Entrée pose un nouveau bâtiment au centre de la vue ; un bouton « Poser au centre de la vue » fait la même chose à la souris et à l'écran tactile (tactile en lecture seule, voir T28b).
- **Zoom de départ** : tant que le point de départ n'est pas posé et que la ferme n'a pas de position, le zoom de départ est plus large qu'aujourd'hui. La valeur est une constante nommée, notée dans la PR.
- **Longueur et largeur** : bornées à 0,5 m minimum dans le panneau, comme les gestes (une saisie de 0,2 m donne 0,5 m).
- **Brouillon abandonné** : si la ferme active change pendant qu'un brouillon est ouvert, un message le dit : « Le brouillon en cours a été abandonné : la ferme active a changé. »
- **Confirmation d'abri** : le texte dit que les planches de la zone suivront la serre.
- **Tuiles en erreur** : une tuile en erreur est redemandée au plus tard après 5 secondes, sans attendre l'événement « en ligne ». Le nombre d'essais reste borné, et le message « Photo aérienne indisponible hors ligne » ne reste affiché que tant que la tuile manque.

## Critères d'acceptation

- [x] Test clavier : en mode pose, Entrée ajoute un bâtiment au centre de la vue ; le bouton fait la même chose ; le bâtiment est sélectionné après la pose.
- [x] Test : sans point de départ ni position de ferme, le zoom initial est la constante nommée, et elle est plus petite que le zoom actuel d'au moins deux niveaux.
- [x] Test : longueur 0,2 m saisie dans le panneau → 0,5 m ; largeur de même ; les gestes donnent le même minimum.
- [x] Test : changement de ferme active avec brouillon ouvert → brouillon fermé et message affiché, texte exact.
- [x] Test : confirmation d'abri contient « Les planches de la zone suivront la serre. ».
- [x] Test : une tuile dont la première requête échoue est redemandée en moins de 5 secondes, sans événement « en ligne » ; le même échec répété ne déclenche pas de rafale.
- [x] Aucun changement de calcul : les tests de `gestes`, `tuiles` et du placement existants restent verts sans modification.
- [x] `pnpm verif` passe en entier. JS de démarrage inchangé.

## Risques

- Sept points dans un seul ticket : si le testeur les juge trop nombreux pour une relecture propre, le chef coupe en deux (clavier et messages / tuiles et zoom) avant de commencer.
- Le zoom de départ est une question de goût : la valeur est proposée dans la PR, pas figée par ce ticket.

**Hors périmètre** : contours de zones (T28d), cache des tuiles hors ligne, import d'un plan cadastral, saisie au tactile.

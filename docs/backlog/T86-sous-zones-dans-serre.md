# T86 — Une serre à plusieurs tunnels : ses zones dessinées dedans

**Objectif** : demande de Théophane (2026-10-26) : « tri-tunnel, il y a Manon 1, 2 et 3 dedans. On devrait pouvoir placer tri-tunnel et faire ces zones-là à l'intérieur. » Même besoin pour les grandes serres de plusieurs hectares découpées en zones d'irrigation (Q54, point 2). Aujourd'hui, une serre abrite une seule zone et ses sous-zones (`zone_parente_id`, déjà saisissable dans Parcellaire, « Dans la zone ») ne se dessinent pas dans la serre.

**Dépend de** : T85 (même rangement des planches, mêmes fichiers)
**Périmètre** : `apps/web/src/ecrans/placement/**`, `apps/web/src/ecrans/plan3d/**` (affichage des bandes), `packages/core/src/placement/**` (calcul pur), tests
**Priorité** : haute (Q54). **Domaine critique** : non (aucune table ni colonne nouvelle : les bandes sont **calculées**, rien de neuf n'est stocké ; les emplacements des sous-zones sont déjà placés dans le repère de la zone racine, `apps/web/src/ecrans/plan/calculs.ts`).

## Règles

1. Une zone **abritée par un bâtiment** (tunnel ou serre) qui a des **sous-zones** non supprimées : la serre se dessine découpée en **bandes**, une par sous-zone, sur **toute la longueur** de la serre, **côte à côte** dans le sens de la largeur, dans l'ordre naturel des noms (Manon 1, Manon 2, Manon 3 ; Manon 10 après Manon 9). Bandes de **même largeur** : largeur de la serre ÷ nombre de sous-zones (un tri-tunnel de 28,8 m donne trois bandes de 9,6 m). Calcul pur dans le cœur, arrondi au millimètre.
2. Chaque bande porte le nom de sa sous-zone, dans l'éditeur, le plan et la 3D. Toucher une bande sélectionne la sous-zone.
3. Une sous-zone d'une zone abritée n'a **ni « Tracer le contour » ni « Dessiner depuis les planches »** : le panneau dit « Dans la serre Tri-tunnel, bande 2 sur 3 ».
4. **« Ranger les planches dans les bandes »** (panneau de la zone abritée, mode édition) : les emplacements de chaque sous-zone se rangent dans **sa** bande avec la règle de T85 (ordre naturel des codes, passe-pied saisi, 45 cm par défaut), le bloc centré dans la bande. Les emplacements rattachés directement à la zone parente gardent le rangement actuel. Un seul « Enregistrer », un seul appel à `porte.placer`, « Annuler » remet tout.
5. Déplacer ou tourner la serre déplace bandes et planches avec elle (déjà vrai pour les planches : repère du bâtiment).
6. Une sous-zone dont les planches ne tiennent pas dans sa bande (somme des largeurs + passe-pieds > largeur de bande, ou planche plus longue que la serre) : avertissement non bloquant « Manon 2 : 3 planches dépassent de la bande », comme « planches hors de la serre » (T81).
7. Une sous-zone qui a un contour tracé à la main (avant ce ticket) : son contour est ignoré à l'affichage dans la serre, et « Ranger les planches dans les bandes » propose de l'effacer (confirmation), dans le même enregistrement.

## Critères d'acceptation

- [ ] Test cœur : serre de 40 × 28,8 m, trois sous-zones → trois bandes de 40 × 9,6 m, centres à −9,6 m, 0, +9,6 m dans le repère de la serre ; ordre naturel des noms.
- [ ] Test cœur : rangement de 4 planches de 38 × 0,75 m (passe-pied 45 cm) dans la bande 2 → centres attendus (exemple chiffré dans le test) ; dépassement détecté avec 9 planches.
- [ ] Test d'écran : zone abritée avec trois sous-zones → trois bandes nommées ; « Ranger les planches dans les bandes » → un seul appel avec un placement par emplacement ; Annuler remet tout.
- [ ] Test d'écran : sous-zone d'une zone abritée → ni « Tracer le contour » ni « Dessiner depuis les planches ».
- [ ] 3D : les bandes sont visibles (limite au sol et nom), sans dépasser le budget de la vue.
- [ ] e2e de l'éditeur : placer la serre, ranger dans les bandes, recharger, tout est en place.
- [ ] Budgets respectés ; `pnpm verif` passe.

## Hors périmètre

Bandes de largeurs différentes, ou zones qui ne traversent pas la serre de bout en bout (à préciser par Théophane avec un exemple chiffré de grande serre, Q54). Vannes dessinées sur les bandes.

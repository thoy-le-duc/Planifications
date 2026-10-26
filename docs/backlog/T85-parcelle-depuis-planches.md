# T85 — Dessiner une parcelle d'un tap à partir de ses planches

**Objectif** : demande de Théophane (2026-10-26). Dans l'éditeur de placement, une zone de plein champ (ou hors-sol sans abri) sans contour ne propose que « Tracer le contour », sommet par sommet. Or l'appli connaît déjà ses planches, avec leur longueur et leur largeur : elle peut dessiner la parcelle seule. Théophane n'a plus qu'à la poser au bon endroit. La règle est universelle, pour toutes les fermes : elle ne dépend d'aucune zone en particulier.

**Dépend de** : T28d, T81
**Périmètre** : `apps/web/src/ecrans/placement/**`, `packages/core/src/placement/**` (calcul pur), tests
**Priorité** : haute (bloque l'usage quotidien, Q51 et Q54). **Domaine critique** : non (aucune table, aucun droit, aucune synchro touchés : l'écriture passe par `porte.placer` existant, contour de zone et placements d'emplacements, gérant seulement).

## Règles

1. Zone **non abritée**, sans contour, qui a au moins un emplacement en service (non supprimé, `actif_au` nul) : en mode édition, le panneau de la zone propose **« Dessiner depuis les planches »** au-dessus de « Tracer le contour » (qui reste proposé). Désactivé sans point de départ du plan, comme « Tracer le contour ».
2. Un champ **« Passe-pied (cm) »**, pré-rempli à **45 cm** (hypothèse déjà utilisée par la bibliothèque d'itinéraires : planche de 75 cm + passe-pied de 45 cm = entraxe de 120 cm, voir `packages/db/src/bibliotheque-ecart-rangs.test.ts`), entier de 0 à 500. La valeur n'est pas stockée (aucune colonne nouvelle).
3. **Calcul pur dans le cœur** (`packages/core/src/placement/`, sans React ni DOM) : les emplacements se rangent **parallèles, côte à côte**, dans l'**ordre naturel des codes** (P1, P2, …, P9, P10 ; sans tenir compte de la casse), P1 contre le bord ouest du rectangle ; même départ pour tous (alignés en bout côté sud). Un emplacement sans largeur compte pour 0,80 m (même valeur que la 3D, `LARGEUR_PAR_DEFAUT_M`). Rectangle : **longueur = la plus longue planche**, **largeur = somme des largeurs + (n − 1) × passe-pied**, sans marge autour. Arrondi au millimètre. Exemple chiffré à tester : 3 planches de 30 m × 0,75 m, passe-pied 45 cm → rectangle 30 m × 3,15 m, centres des planches à −1,2 m, 0 m, +1,2 m de l'axe.
4. Le rectangle se pose **au centre de la vue**, longueur vers le nord. Il va au brouillon comme contour de la zone (4 sommets) et chaque emplacement de la zone reçoit son placement au brouillon. Un emplacement déjà placé est **recalé** lui aussi (le geste range toute la zone) : le panneau l'annonce avant de dessiner (« 2 planches déjà placées seront rangées »).
5. **Déplacer et tourner le bloc** : une zone avec contour se déplace entière en glissant son intérieur (souris ou doigt), et tourne avec une poignée de rotation (comme un bâtiment, `gestes.ts` : `glisser`, `pivoter`, Maj par pas de 15°) et un champ « Orientation (°) ». Ses planches suivent : elles gardent leur position **dans la zone** (contrairement à un déplacement de sommet, T28d, où elles restent sur place). Cela vaut pour toute zone avec contour, pas seulement celles dessinées depuis les planches.
6. Un seul « Enregistrer » écrit contour et placements en **un** appel à `porte.placer` ; « Annuler » et Ctrl+Z remettent tout exactement (contour nul compris).
7. Au doigt (T28k) : mêmes gestes, poignée assez grande pour un pouce. En lecture seule (équipier, téléphone en lecture) : rien de nouveau n'apparaît.

## Critères d'acceptation

- [ ] Test cœur : l'exemple chiffré de la règle 3, plus l'ordre naturel (P10 après P9), une planche sans largeur (0,80 m), des planches de longueurs différentes (rectangle = la plus longue, toutes alignées en bout sud), passe-pied 0.
- [ ] Test d'écran : zone de plein champ sans contour avec planches → « Dessiner depuis les planches », passe-pied 45, Enregistrer → un seul appel avec le contour et un placement par planche.
- [ ] Test d'écran : glisser l'intérieur de la zone déplace contour et planches du même vecteur ; tourner de 90° tourne les deux autour du centre ; Annuler remet l'état d'avant.
- [ ] Test d'écran : zone sans emplacement → pas de « Dessiner depuis les planches » ; zone abritée → rien de nouveau.
- [ ] e2e de l'éditeur : dessiner depuis les planches, enregistrer, recharger, la parcelle et ses planches sont là.
- [ ] Budgets respectés (le calcul peut se charger à la demande si le morceau de l'éditeur déborde) ; `pnpm verif` passe.

## Hors périmètre

Serres à plusieurs tunnels ou chapelles, sous-zones dans un bâtiment : T86. Stocker un passe-pied par zone ou par ferme (colonne nouvelle, domaine critique) : à proposer si Théophane le demande. Planches en plusieurs colonnes dans une même zone.

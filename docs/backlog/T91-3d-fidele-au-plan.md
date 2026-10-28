# T91 — La 3D montre exactement le plan, rien d'inventé

**Objectif** : retour de Théophane (2026-10-28) : « quand je fais la vue 3D, ça ne met même pas… La 3D de la zone, c'est assez bizarre comment c'est conçu. » Aujourd'hui, une zone sans forme est rangée en 3D dans une grille inventée, à l'est de la ferme (héritage du prototype T27) ; une sous-zone hors serre n'a rien ; une planche placée dans une sous-zone hors serre est lue dans le repère de la racine en 3D mais dans celui de la sous-zone dans l'éditeur (`EditeurPlacement.tsx` vers les l. 632-666 contre `plan/calculs.ts` vers les l. 140-148) : elle peut être à deux endroits différents.

**Dépend de** : T88
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/src/ecrans/plan/calculs.ts`, `apps/web/src/ecrans/placement/**` (repère des sous-zones), tests
**Priorité** : haute (chantier du plan). **Domaine critique** : non (lecture seulement ; si le correctif de repère exige de réécrire des placements stockés, le signaler au chef : ce serait critique).

## Règles

1. La 3D dessine **seulement ce qui est placé**, à sa place : bâtiments, zones avec contour, cases des serres (T88), planches placées. Une zone sans contour ni serre **n'apparaît plus** dans la scène.
2. Un bouton **« À placer (n) »** liste les zones non placées ; un tap ouvre l'éditeur sur cette zone (en modification si gérant). Plus de grille inventée.
3. **Un seul repère** pour les placements des planches d'une sous-zone hors serre, le même dans l'éditeur, le plan 2D et la 3D : celui de la sous-zone si elle a un contour, sinon celui de la racine. Test qui prouve qu'une planche est au même point dans l'éditeur et en 3D.
4. Une sous-zone avec contour hors serre a son socle en 3D, comme une zone.
5. On ne modifie rien depuis la 3D (seul « Modifier le plan » ouvre l'éditeur, comme aujourd'hui).

## Critères d'acceptation

- [ ] Test : ferme avec une zone placée et une non placée → la scène ne contient que la première ; « À placer (1) ».
- [ ] Test : même planche, mêmes coordonnées dans l'éditeur et dans la scène 3D (sous-zone avec contour, et sans).
- [ ] e2e 3D et démo adaptés ; budget de la vue tenu ; `pnpm verif` passe.

## Hors périmètre

Nouvelles fonctions 3D.

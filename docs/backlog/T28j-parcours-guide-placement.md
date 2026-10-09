# T28j — Placement : un parcours guidé en étapes

**Objectif** (Q36) : qu'on sache quoi faire en ouvrant l'éditeur. « Je ne vois toujours pas comment placer ma serre aux bons endroits. » Aujourd'hui, les boutons sont grisés tant que le point de départ n'est pas posé, sans dire pourquoi, et « Nouveau bâtiment » puis « toucher la photo » n'est annoncé nulle part.

**Dépend de** : T28h
**Périmètre** : `apps/web/src/ecrans/placement/**`

## Règles

- Un bandeau d'étapes en haut de l'éditeur, toujours visible, l'étape en cours mise en avant et la suivante annoncée :
  1. **Trouver la ferme** (recherche d'adresse T28h ou déplacement de la carte) ;
  2. **Poser le point de départ** (toucher la photo au centre de la ferme, ou « Utiliser la position de la ferme ») ;
  3. **Ajouter une serre ou un bâtiment** (« Nouveau bâtiment », puis toucher la photo à son emplacement ; message pendant la pose : « Touchez la photo où se trouve la serre ») ;
  4. **Ajuster et tracer les zones** (déplacer, tourner, « Tracer le contour » d'une zone) puis **Enregistrer**.
- Une étape franchie se coche ; on peut toujours revenir à une étape. Une ferme déjà placée ouvre directement sur l'étape 4.
- Tout bouton grisé dit pourquoi (texte à côté ou `aria-describedby`), par exemple « Posez d'abord le point de départ (étape 2) ».
- Lisible au téléphone ; aucun calcul nouveau.
- Budget de l'éditeur (20 Kio, 0,1 de marge) : tenu ou hausse chiffrée et justifiée dans la PR.

## Critères d'acceptation

- [ ] Test : ferme sans origine → étape 1 en cours ; origine posée → étape 3 ; un bâtiment posé → étape 4.
- [ ] Test : « Nouveau bâtiment » grisé sans origine, avec la raison lisible.
- [ ] Test : pendant la pose, le message « Touchez la photo où se trouve la serre » est affiché.
- [ ] `pnpm verif` passe en entier.

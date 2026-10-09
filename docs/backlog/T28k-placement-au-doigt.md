# T28k — Placement au doigt sur le téléphone

**Objectif** (Q36) : placer ses serres et bâtiments depuis le téléphone, au doigt, sans ordinateur. Aujourd'hui l'éditeur est en lecture seule sous 1 024 px (« à faire sur ordinateur »).

**Dépend de** : T28j
**Périmètre** : `apps/web/src/ecrans/placement/**`, e2e de placement (téléphone simulé)

## Règles

- Le gérant peut éditer sur téléphone et tablette. Gestes : un doigt sur la carte la déplace ; un doigt sur l'élément sélectionné le déplace ; deux doigts pincent pour zoomer ; deux doigts qui tournent font tourner l'élément sélectionné. Boutons larges (gants) en bas : « Tourner −5° / +5° », « Annuler », « Enregistrer ».
- Sommets d'un contour de zone : poignées d'au moins 44 px de côté, déplaçables au doigt ; ajout d'un sommet par appui long sur un côté.
- Aucun déplacement involontaire : un tap simple sélectionne, il ne déplace pas ; le défilement de la page ne se déclenche pas sur la carte.
- Les règles d'enregistrement, d'annulation et de droits (gérant seulement) ne changent pas.
- Budget de l'éditeur : tenu ou hausse chiffrée et justifiée.

## Critères d'acceptation

- [ ] e2e (viewport téléphone, écran tactile simulé) : poser le point de départ, ajouter une serre, la glisser, la tourner à deux doigts, enregistrer → position et cap enregistrés.
- [ ] Test : un tap sur un élément le sélectionne sans le déplacer.
- [ ] Test : équipier sur téléphone → lecture seule comme aujourd'hui.
- [ ] `pnpm verif` passe en entier.

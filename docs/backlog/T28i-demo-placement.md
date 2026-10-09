# T28i — Démo : essayer le placement d'une serre sur une vraie photo

**Objectif** (Q36) : qu'un visiteur de la démo (et Théophane) voie tout de suite comment on place une serre. Aujourd'hui la démo n'a pas de photo aérienne (fond neutre) et rien n'invite à essayer.

**Dépend de** : T28h
**Périmètre** : `apps/web/src/demo/**`, `apps/web/src/ecrans/placement/**` (seulement ce qui distingue la démo), e2e de la démo

## Règles

- La ferme fictive de la démo a une origine du plan dans un lieu agricole réel et plausible (coordonnées dans la démo, aucune donnée réelle d'une ferme existante).
- **Photo IGN dans la démo quand le réseau est là** ; hors ligne, le fond neutre actuel, sans erreur (la démo reste utilisable sans réseau : les e2e de la démo simulent l'absence de réseau et doivent passer).
- Le visiteur de la démo est gérant : il peut ajouter une serre, la déplacer, la tourner, enregistrer ; tout reste local à la démo et « Réinitialiser la démo » efface ses essais.
- Une invitation dans la vue 3D et dans l'éditeur de la démo : « Essayez : ajoutez une serre et posez-la sur la photo ».
- Recherche d'adresse (T28h) disponible dans la démo quand le réseau est là.

## Critères d'acceptation

- [ ] e2e démo (réseau simulé par `page.route`) : ouvrir l'éditeur, ajouter une serre, la poser, enregistrer → elle apparaît dans la 3D.
- [ ] e2e démo hors ligne : fond neutre, aucune erreur, placement toujours possible.
- [ ] « Réinitialiser la démo » retire la serre ajoutée.
- [ ] `pnpm verif` passe en entier ; budgets tenus.

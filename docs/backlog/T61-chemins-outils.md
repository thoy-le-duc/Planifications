# T61 — Jumeau 3D : chemins, bâtiments et rangement des outils

**Objectif** : réponse à Q44 (« les chemins et les outils, où ils sont rangés »). Un nouvel ouvrier doit trouver **son chemin** et **l'outil** demandé dans sa consigne (T60) sans demander.

**Dépend de** : T28 (placement), T60 (consignes), T22 (outil des travaux prévus)
**Périmètre** : `packages/db` (éléments du plan, lieux de rangement, outils, migration), `apps/api/src/sync/**`, `apps/web/src/ecrans/placement/**`, `apps/web/src/ecrans/plan3d/**`, `apps/web/src/ecrans/ferme/**`, tests, `docs/modele-donnees.md`
**Priorité** : basse. **Modèle** : Opus (3D).

## Règles

1. **Éléments du plan**, posés au doigt dans l'éditeur de placement : **chemins** (ligne tracée point par point, largeur), **bâtiments** (hangar, local, chambre froide, magasin : rectangle et nom), **points d'eau** et autres repères nommés.
2. **Lieux de rangement** : un bâtiment ou un point du plan, avec des emplacements nommés à l'intérieur (« hangar — mur nord »).
3. **Outils** de la ferme (la liste des travaux prévus en contient déjà les noms) : chacun a un lieu de rangement. La consigne du jour (T60) affiche « Grelinette — hangar, mur nord », et un tap montre le chemin dans la 3D.
4. **3D** : chemins au sol, bâtiments en volumes simples, étiquettes à la demande. Le chemin le plus court, du lieu de rangement à la planche, n'est **pas** dans ce ticket : on surligne seulement les deux points.
5. Budgets : poids de la vue 3D et temps d'affichage respectés, ou relevés avec justification.

## Critères d'acceptation

- [ ] Tests : chemin et bâtiment posés, relus, synchronisés ; outil avec son lieu de rangement.
- [ ] Test d'écran : consigne qui affiche l'outil et son lieu ; tap → les deux points surlignés en 3D.
- [ ] Migration testée en intégration ; budgets respectés ; `pnpm verif` passe.

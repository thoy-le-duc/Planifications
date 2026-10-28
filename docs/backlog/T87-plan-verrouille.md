# T87 — Le plan est verrouillé : « Modifier le plan » pour bouger quelque chose

**Objectif** : demande de Théophane (2026-10-28) : « on ne peut pas verrouiller les trucs. Tout à l'heure, sans faire exprès, j'ai bougé une serre, juste en naviguant sur la ferme. » Aujourd'hui, à la souris, glisser sur un bâtiment ou une planche le déplace aussitôt, sans sélection préalable (`EditeurPlacement.tsx`, `commencer`) ; il n'existe aucun mode lecture pour un gérant. Premier ticket du chantier « plan simple et rationnel » (T87 à T92, Q55).

**Dépend de** : —
**Périmètre** : `apps/web/src/ecrans/placement/**` (éditeur, gestes, barre du bas, étapes), tests
**Priorité** : haute (chantier du plan, bloque l'usage quotidien). **Domaine critique** : non (aucune écriture nouvelle, aucun droit changé : seul l'enchaînement des gestes change).

## Règles

1. L'éditeur s'ouvre **verrouillé**, pour tout le monde, gérant compris : on fait défiler, on zoome, on tourne la vue, un tap sur un élément le **choisit** et montre sa fiche (nom, dimensions, zone abritée) en lecture. Aucun glisser, aucune poignée, aucun bouton qui modifie.
2. Gérant seulement : un bouton **« Modifier le plan »** (bien visible, en haut ou dans la barre du bas) déverrouille. Le bandeau dit « Modification du plan ». Le bouton devient **« Terminer »**.
3. En modification, **souris comme doigt** : un glisser ne déplace qu'un élément **déjà choisi** (comme T28k au doigt). Glisser sur un élément non choisi fait défiler la carte. Plus aucun déplacement au premier contact.
4. « Terminer » avec des changements non enregistrés : proposer « Enregistrer » ou « Abandonner les changements » (mêmes actions que la barre actuelle) ; sans changement, reverrouille aussitôt. « Annuler l'enregistrement » reste proposé après « Terminer », pendant son délai actuel.
5. Le parcours guidé (étapes T28j) passe en modification de lui-même aux étapes « Poser le point de départ », « Ajouter une serre ou un bâtiment » et « Ajuster et tracer les zones » : une ferme neuve n'a pas à chercher le bouton.
6. Fermer l'éditeur puis le rouvrir : il est de nouveau verrouillé.

## Critères d'acceptation

- [ ] Test d'écran : gérant, ouverture → aucun bouton de modification, glisser à la souris sur un bâtiment ne change rien (aucun brouillon), un tap ouvre sa fiche en lecture.
- [ ] Test d'écran : « Modifier le plan » → glisser sur un bâtiment non choisi fait défiler la carte ; le choisir puis glisser le déplace ; « Terminer » sans changement reverrouille.
- [ ] Test d'écran : changement en cours puis « Terminer » → choix « Enregistrer » / « Abandonner les changements », chacun avec son effet attendu.
- [ ] Test d'écran : équipier → pas de « Modifier le plan ».
- [ ] e2e de l'éditeur adapté (les parcours existants passent par « Modifier le plan »).
- [ ] Budgets respectés ; `pnpm verif` passe.

## Hors périmètre

Cadenas par élément (une serre bloquée même en modification) : seulement si Théophane le demande (Q55).

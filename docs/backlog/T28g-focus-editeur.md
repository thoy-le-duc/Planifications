# T28g — Éditeur : rendre le focus à la fermeture

**Objectif** : que le clavier et les lecteurs d'écran retrouvent leur place à la fermeture de l'éditeur de placement, qu'il ait été ouvert depuis la 3D ou depuis l'onglet Ferme. Aujourd'hui le focus se perd au retour, et l'encart de la 3D n'annonce pas ses changements. Relecture de T28f.

**Dépend de** : T28f (en revue : même écran d'accès, à enchaîner après sa fusion)
**Périmètre** : `apps/web/src/ecrans/placement/**`, `apps/web/src/ecrans/plan3d/Vue3d.tsx` (encart seulement), `apps/web/src/ecrans/ferme/EcranFerme.tsx` (bouton d'ouverture, cible du retour seulement)

## Règles

- **Retour du focus** : à la fermeture de l'éditeur, le focus revient sur le bouton qui l'a ouvert (« Ouvrir l'éditeur » dans la 3D, « Placer sur la photo aérienne » dans l'onglet Ferme).
- **Repli** : si ce bouton n'existe plus (ferme changée, onglet quitté), le focus va sur « Modifier le plan » ; à défaut, sur la toile du plan.
- **Encart de la 3D** : l'encart qui annonce un changement (vol, zone choisie, éditeur fermé) est en `role="status"` pour que les lecteurs d'écran le lisent, sans voler le focus.
- Aucun changement de calcul, de données ou de droits.

## Critères d'acceptation

- [ ] Test : ouverture depuis la 3D, puis fermeture → le focus est sur le bouton « Ouvrir l'éditeur » de la 3D.
- [ ] Test : ouverture depuis l'onglet Ferme, puis fermeture → le focus est sur « Placer sur la photo aérienne ».
- [ ] Test : bouton d'origine absent à la fermeture → le focus est sur « Modifier le plan ». Si celui-ci est absent aussi → sur la toile.
- [ ] Test : l'encart de la 3D a `role="status"` et le texte annoncé change quand une zone est choisie.
- [ ] Les tests de l'éditeur (`editeur.test.tsx`, `suites.test.tsx`, `contours-editeur.test.tsx`) passent ; aucune assertion de fond modifiée.
- [ ] `pnpm verif` passe en entier. Démarrage JS inchangé.

## Risques

- T28f modifie les mêmes boutons d'accès : ne pas commencer avant sa fusion, ou se caler sur sa branche et le dire dans la PR.
- Le focus doit se poser après le rendu de la fermeture : utiliser le même mécanisme que T28e (cible mémorisée, posée après le rendu), pas un `setTimeout`.

**Hors périmètre** : nouveau point d'accès à l'éditeur (T28f), raccourcis clavier de la 3D, lecture vocale de l'encart, focus pendant les vols de caméra (T29).

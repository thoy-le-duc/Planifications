# T37c — Suites de la relecture T37b

**Objectif** : fermer les écarts non bloquants de la relecture de T37b.

**Dépend de** : T37b
**Périmètre** : `apps/web/src/ecrans/plan3d/**`

## Règles

- **Numéros après « Voir les autres »** : au-delà de 25 tâches en retard, les numéros de la 3D doivent rester ceux de l'écran Aujourd'hui une fois la liste dépliée (même ordre que l'écran déplié).
- **Liste des planches et lecteurs d'écran** : panneau replié, l'alternative texte de la toile reste lisible par un lecteur d'écran (liste visuellement masquée, pas retirée de l'arbre d'accessibilité).
- **Poteaux** : la relecture note que poteaux de gouttière et de pergola sont devenus des fuseaux pointus, sans traverse en T. À montrer à Théophane avec une capture avant de changer quoi que ce soit (question à poser).

## Critères d'acceptation

- [ ] Test : 30 tâches en retard, liste dépliée → numéros identiques entre l'écran et la 3D.
- [ ] Test : panneau replié → la liste des planches est dans l'arbre d'accessibilité.
- [ ] `pnpm verif` passe en entier ; vue 3D et démarrage sans relevé non justifié.

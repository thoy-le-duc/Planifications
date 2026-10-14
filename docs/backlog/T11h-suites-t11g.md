# T11h — Suites de T11g : instantané de Planches vraiment en lecture seule

**Objectif** : fermer les remarques non bloquantes de la relecture de T11g (PR #188).

**Dépend de** : T11g
**Périmètre** : `apps/web/src/ecrans/plan/**`
**Priorité** : normale, petit ticket sans risque (affichage seulement).

## Règle

1. Tant que l'écran montre l'instantané (même si la base vient d'arriver), le bouton « Modifier la série » du détail d'une barre est masqué (`lectureSeule ? null : modifierSerie`).
2. Une barre ouverte en détail sur l'instantané se ferme (ou se met à jour) quand le plan relu remplace l'instantané.
3. Tant que la grille montre l'instantané, le sélecteur de saison (désactivé) affiche la saison de l'instantané, pas la saison par défaut lue entre-temps.

## Critères d'acceptation

- [ ] Test : instantané affiché, base arrivée mais plan pas encore relu : pas de bouton « Modifier la série ».
- [ ] Test : détail d'une barre ouvert sur l'instantané, puis plan relu : le détail n'affiche plus la barre de l'instantané.
- [ ] Test : saisons lues avant le plan : le sélecteur montre la saison de l'instantané.
- [ ] Octets de démarrage inchangés ou en baisse ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm budget` passent ; e2e `plan-performances` (premier tap) toujours vert.

# T04b — Pas d'alerte de rotation sur le hors-sol

**Objectif** : le hors-sol (abri `hors_sol` ou emplacement `gouttiere`) ne déclenche aucune alerte de rotation (Q17).

**Dépend de** : T04
**Périmètre** : `packages/core/src/planification/rotation.ts`, `apps/api/src/sync/serie.ts` si besoin

## Critères d'acceptation

- [ ] Fraisiers sur gouttière deux années de suite : aucune alerte.
- [ ] Fraisiers en pleine terre deux années de suite : alerte Rosacées (4 / 5 ans) inchangée.
- [ ] Le formulaire de série (T12) n'affiche pas d'alerte sur un emplacement hors-sol.

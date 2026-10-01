# T04b — Pas d'alerte de rotation sur le hors-sol

**Objectif** : le hors-sol (abri `hors_sol` ou emplacement `gouttiere`) ne déclenche aucune alerte de rotation (Q17).

**Dépend de** : T04
**Périmètre** : `packages/core/src/planification/rotation.ts`, `apps/api/src/sync/serie.ts` si besoin

## Critères d'acceptation

- [ ] Fraisiers sur gouttière deux années de suite : aucune alerte.
- [ ] Fraisiers en pleine terre deux années de suite : alerte Rosacées (4 / 5 ans) inchangée.
- [ ] Le formulaire de série (T12) n'affiche pas d'alerte sur un emplacement hors-sol.

## Décisions du chef (après les tests)

1. **Abri pris en compte** : celui de la zone directe de l'emplacement (son abri actuel).
2. **Zone inconnue** : l'alerte est gardée (mieux vaut une alerte en trop), sauf sur une gouttière.
3. **Types d'entrée** : `sorte` et `typeAbri` facultatifs dans les entrées du moteur ; absents = pleine terre (comportement d'avant). Aucun test existant à modifier.
4. **Historique hors-sol** : une culture passée sur un emplacement hors-sol (gouttière ou zone `hors_sol`) ne compte jamais dans l'historique d'une planche de pleine terre, même par le lien « remplace » : pas de sol, pas de fatigue de sol.
5. Le serveur ne recalcule pas la rotation : rien à aligner côté API.

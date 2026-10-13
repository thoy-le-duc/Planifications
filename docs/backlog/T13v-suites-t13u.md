# T13v — Suites de T13u : préchargement du plan pressable de bout en bout, tests probants

**Objectif** : fermer les remarques non bloquantes de la relecture de T13u (PR #185).

**Dépend de** : T13u
**Périmètre** : `apps/web/src/ecrans/plan/cache.ts`, `apps/web/src/ecrans/plan/*.test.ts`, `apps/web/src/ecrans/aujourdhui/occupations-index.test.ts`
**Priorité** : normale, petit ticket.

## Règle

1. **Deux préchargements pour la même ferme** (`App.tsx` relance `prechargerPlan` à chaque nouvel objet `ferme`) : le second ne doit plus rendre le premier impossible à presser. L'écran Planches qui attend le plan presse tous les lecteurs en cours (ensemble de fonctions `presser` dans le cache, ou chaînage).
2. **`porteQuiCede`** : quand une lecture est levée par `presser`, l'attente de `cederAuxSaisies` (observateur et minuteur) est libérée tout de suite, pas 2 s plus tard.

## Critères d'acceptation

- [x] Test : deux `prechargerPlan` en même temps pendant une saisie ; l'écran Planches (`obtenirDebutDePlan`) rend le plan sans attendre `CESSION_MAX_MS`.
- [x] Test : après `presser`, aucun minuteur ni observateur de `cederAuxSaisies` ne reste actif.
- [x] Test : `SQL_OCCUPATIONS` (UNION ALL) rend exactement les mêmes lignes que l'ancienne requête en `OR`, avec une occupation de série et une occupation de plantation (sans série).
- [x] Test : passage « pressé » au milieu de la lecture des emplacements par pages : toutes les lignes lues, une seule fois.
- [x] Octets de démarrage inchangés ; `pnpm test`, `pnpm typecheck`, `pnpm lint` passent ; e2e `aujourdhui-premier-fait` et `plan-performances` toujours verts.

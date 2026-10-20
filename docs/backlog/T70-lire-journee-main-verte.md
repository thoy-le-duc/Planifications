# T70 — Main verte : `lireJournee` sur la grande ferme après T69

**Objectif** : depuis la fusion de T69 (PR #224, 8c2b9a3), `apps/web/src/ecrans/aujourdhui/grande-ferme.test.ts` (« lireJournee en moins de 250 ms ») est rouge en CI : 258 / 282 / 273 / 213 / 227 ms, médiane 258. Main était verte sur 6cd7a87 (T66). Trouver la cause, sans relever la borne ni sauter le test.

**Dépend de** : T69
**Périmètre** : `apps/web/src/ecrans/aujourdhui/grande-ferme.test.ts` (et `calculs.ts` si une régression est trouvée)
**Priorité** : urgente (règle « main verte » de `docs/boucle.md`).

## Règles

1. Mesurer `lireJournee` sur 8c2b9a3, 6cd7a87 et a55d6d0 (T52), au moins 10 passages de 5 mesures chacun, en alternance, dans les mêmes conditions.
2. Écart attribuable à T68 ou T69 : profiler et corriger le code, borne inchangée.
3. Aucun écart : le test suit la règle de T31 (`mesurerAsync` : échauffement, médiane de 7 en min(mural, CPU), jusqu'à 3 manches), dans un commit justifié, borne inchangée ; ou bien `lireJournee` est réellement allégée si c'est sûr.

## Critères d'acceptation

- [x] Mesures chiffrées par version : aucun écart (médianes des médianes 139 / 133 / 144 ms à vide, 167 / 162 / 171 ms sous 4 boucles `yes`). Ni T68 ni T69 ne touchent le chemin de `lireJournee`.
- [x] Le test passe par `mesurerAsync`, borne de 250 ms inchangée, commit séparé et justifié.
- [x] Sous 8 boucles `yes` : ancien test rouge 6/6, nouveau vert 6/6. À vide : 10/10.
- [x] Typage, lint, tests web d'Aujourd'hui, budget.

## Risques

- Une charge très forte peut encore gonfler le CPU lui-même : les manches réduisent le risque, ne le suppriment pas (T31).
- Alléger `lireJournee` (pages de séries ≈ 45 ms, réalisés ≈ 20 ms, interventions, récents et chaînes ≈ 14 ms chacun sur ce banc) toucherait des requêtes réglées pour le SQLite du navigateur (T13u) : non fait ici, hors d'un ticket qui mesure aussi dans le navigateur.

# T45 — CI en parallèle : de ~35 min à ~12 min

**Objectif** : demande de Théophane (2026-10-19, « on a perdu en efficacité »). Aujourd'hui `.github/workflows/ci.yml` enchaîne tout dans un seul job (typage, lint, tests unitaires et d'intégration avec Postgres, build, build des essais, budget, e2e temps et hors ligne, build et e2e de la démo, e2e de synchro avec PowerSync) : 30 à 40 minutes par PR.

**Dépend de** : T20 (main verte), T31 (tests de temps fiables)
**Périmètre** : `.github/workflows/ci.yml`, `.github/workflows/migrations-production.yml` (seulement si le nom du workflow CI ou la condition doit suivre), tests qui lisent ces YAML (`packages/db/src/migrations-production.test.ts`…), `docs/boucle.md` (section Fusion + jauge), `CLAUDE.md` (tableau des commandes si besoin)
**Priorité** : haute.

## Règle

1. Découper en **jobs parallèles**, chacun avec son cache pnpm : (a) typage + lint + tests unitaires ; (b) tests d'intégration Postgres (wal_level=logical, comme aujourd'hui) ; (c) build + build des essais + budget + e2e de temps et hors ligne (Chromium) ; (d) build et e2e de la démo ; (e) e2e de synchro (Docker : Postgres + PowerSync + API). Rien n'est retiré : toutes les vérifications d'aujourd'hui tournent toujours, et `pnpm verif` en local reste identique.
2. Un **job final « CI verte »** qui dépend de tous les autres et échoue si l'un échoue : c'est lui que regardent la boucle et le workflow des migrations (garder le nom du workflow `CI` et une conclusion globale `success` seulement si tout est vert).
3. Les tests de temps gardent leurs conditions (CPU ralenti, budgets inchangés) ; aucun budget relevé.
4. `concurrency` inchangée (annuler les lancements dépassés d'une même branche).
5. Mesure : durée totale avant/après relevée dans la PR (sur la PR elle-même).
6. `docs/boucle.md` : (a) Fusion : les remarques de relecture se corrigent **dans la PR du ticket avant la fusion**, pas dans un ticket de suite (sauf vrai hors-périmètre) ; les petites demandes d'une même zone sont regroupées en un ticket ; (b) Budget : dernière jauge connue **20 % le lundi 19 octobre 2026** (semaine du mercredi 14 octobre 10 h).

## Critères d'acceptation

- [ ] Test (lecture du YAML) : jobs parallèles présents, chacun avec ses étapes ; job final qui dépend de tous ; même ensemble de commandes qu'avant (aucune vérification perdue).
- [ ] Le workflow des migrations de production se déclenche toujours sur la CI verte de main (test de T44 vert).
- [ ] Durée de la CI de la PR mesurée et notée (cible ≤ 15 min).
- [ ] `pnpm verif` passe en local.

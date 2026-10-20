# T50 — Planches : impossible de descendre sur le téléphone (bug bloquant)

**Objectif** : retour de Théophane (2026-10-19, premier vrai test, juste après T49) : « j'ai la page Planches qui bug, on ne peut pas descendre sur le téléphone ». Sa ferme est neuve : saison créée, zones et planches créées par « Ma ferme » (T49), peut-être aucune série encore ; bandeau « Démarrer votre ferme » probablement affiché.

**Dépend de** : T11 (plan virtualisé), T11b/T11e, T49 (bandeau et états vides)
**Périmètre** : `apps/web/src/ecrans/plan/**`, `apps/web/src/ecrans/demarrer/**`, `apps/web/src/App.tsx` et CSS de mise en page si la cause y est, e2e
**Priorité** : urgente.

## Règle

1. **Reproduire** au téléphone simulé (Playwright, viewport 390×844 et 360×800, `hasTouch`, défilement au doigt par `touchscreen` / gestes, pas seulement la molette), sur une ferme neuve comme celle de Théophane : saison, 2 à 4 zones, 10 à 40 planches, **sans série**, puis avec 1 série ; avec et sans bandeau « Démarrer votre ferme ». Aussi sur la ferme de T07 (non-régression).
2. Trouver la cause (hauteur fixe / `overflow: hidden`, conteneur virtualisé de hauteur nulle, `touch-action`, gestionnaire de toucher qui `preventDefault`, bandeau qui prend la hauteur, état vide dans un conteneur non défilant…), la corriger à la source.
3. Ajouter un e2e qui fait défiler Planches **au doigt** sur un téléphone simulé et vérifie que la dernière planche devient visible, dans les deux cas (ferme neuve sans série, ferme T07).
4. Budgets et tests de temps inchangés.

## Critères d'acceptation

- [ ] Cause écrite dans le journal (fichier, mécanisme).
- [ ] e2e de défilement au doigt (téléphone simulé) vert sur ferme neuve et sur T07 ; rouge avant la correction.
- [ ] `pnpm verif` (ou étapes équivalentes) passe.

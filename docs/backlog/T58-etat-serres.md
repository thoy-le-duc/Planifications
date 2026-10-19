# T58 — État des serres : ouvrants, chauffage, bâches, dans la 3D

**Objectif** : réponse à Q44. Savoir **serre par serre** ce qui est ouvert ou fermé (ouvrants, portes), chauffé ou non, bâché ou non, et le voir dans le jumeau 3D. Le soir, on vérifie d'un coup d'œil que tout est fermé.

**Dépend de** : T28c (serres en 3D), T49 (zones)
**Périmètre** : `packages/core` (état courant à une date), `packages/db` (événement ou détail, migration si besoin), `apps/api/src/sync/**`, `apps/web/src/ecrans/plan3d/**`, `apps/web/src/ecrans/aujourdhui/**`, tests, `docs/modele-donnees.md`
**Priorité** : moyenne. **Modèle** : Opus.

## Règles

1. Une zone abritée (serre, tunnel) a des **équipements** déclarés : ouvrants latéraux, ouvrants de faîtage, portes, chauffage, voile ou filet. Liste par défaut selon le type d'abri, modifiable.
2. Un changement d'état est un **événement du journal** (« ouvrants latéraux ouverts, 9 h ») : saisie en un tap depuis la 3D ou depuis Aujourd'hui, hors ligne. L'état courant est le dernier événement en vigueur (cœur, testé).
3. **3D** : ouvrants ouverts dessinés relevés, porte ouverte, chauffage en pastille. Un filtre « Serres » montre tout ce qui est ouvert en couleur vive.
4. Aujourd'hui, à partir de 18 h : rappel « 2 serres encore ouvertes », s'il y en a.
5. Pas de capteur ni de pilotage dans ce ticket (phase 3).

## Critères d'acceptation

- [ ] Tests cœur : état courant d'après la suite des événements ; correction ou annulation prise en compte.
- [ ] Tests d'écran : changement d'état en un tap hors ligne ; rappel du soir.
- [ ] Tests 3D : ouvrants ouverts visibles ; filtre « Serres ».
- [ ] Budgets respectés ; `pnpm verif` passe.

# T35b — Jumeau 3D : plants posés selon la disposition des rangs

**Objectif** (Q34) : que la 3D pose les plants comme l'itinéraire le dit, alignés ou en quinconce.

**Dépend de** : T35a, T32d
**Périmètre** : `apps/web/src/ecrans/plan3d/**` (adaptateur des plants et lecture des données), tests associés

## Règles

- L'adaptateur `plantsDePlanche` lit la `disposition` de l'itinéraire de la série (instantané) ; en quinconce, les plants des rangs pairs sont décalés d'un demi-pas le long du rang, sans sortir de la planche.
- Plafonds, triangles et budgets de T32b et T32d inchangés.

## Critères d'acceptation

- [ ] Test : 2 rangs en quinconce → positions du rang 2 décalées d'un demi-pas ; alignés → mêmes positions qu'avant.
- [ ] Test : aucun plant hors de la planche dans les deux cas.
- [ ] `pnpm verif` passe en entier.

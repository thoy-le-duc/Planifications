# T84 — E-Phy : chercher un produit par culture, ravageur ou maladie

**Objectif** : demande de Théophane (réponse à Q48, 2026-10-23) : « il faut pouvoir aussi faire une recherche par nom ; parfois on cherche un produit, on regarde par exemple tomate ; et par ravageur aussi, ou par maladie ». Aujourd'hui, la recherche E-Phy (T53) ne trouve un produit que par son nom, son AMM ou sa substance. Le catalogue contient déjà, pour chaque usage, la culture et la cible : on peut donc s'en servir pour la recherche.

**Dépend de** : T53, T75, T76
**Périmètre** : `packages/core/src/phyto/ephy.ts` (recherche), `apps/web/src/ecrans/ferme/phyto/RechercheEphy.tsx` (affichage des résultats), tests de ces deux dossiers
**Priorité** : moyenne. **Domaine critique** : non (lecture seule du catalogue public, aucune écriture, aucune table).

## Règles

1. Un mot de la recherche peut correspondre au **nom, à l'AMM ou à la substance** (comme aujourd'hui), à la **culture d'un usage**, ou à la **cible d'un usage** (ravageur, maladie, adventice). La comparaison se fait sans accents ni majuscules, avec `normaliserEphy`.
2. Culture : un nom d'espèce de la ferme ou courant est traduit en culture e-phy par la correspondance existante (`culturesEphyPourEspece`). Ainsi « tomate » trouve les usages « Tomate - Aubergine » ; un mot qui figure tel quel dans le nom de culture e-phy compte aussi.
3. Plusieurs mots se combinent **sur un même usage** : « tomate pucerons » ne garde que les produits qui ont un usage dont la culture est la tomate **et** dont la cible contient « pucerons ». Un mot qui correspond au nom ou à la substance du produit vaut pour tous ses usages (« soufre oïdium » : produits à base de soufre qui ont un usage contre l'oïdium).
4. Ordre des résultats : d'abord les produits autorisés (règle existante), puis ceux dont le nom commence par la recherche, puis l'ordre alphabétique. Au plus 8 résultats, et sous la liste « N autres produits : précisez la recherche » quand il y en a plus.
5. Quand un produit a été trouvé par la culture ou par la cible, la ligne du résultat montre **l'usage trouvé** sous le nom du produit (« Tomate - Aubergine · Pucerons · DAR 3 j »), ou le premier s'il y en a plusieurs, suivi de « + N usages ».
6. Rien ne change à la sélection : un tap remplit la fiche comme aujourd'hui (T76, T79).
7. Exemple chiffré pour les tests : un catalogue figé de 4 produits. A (soufre, usages tomate/oïdium et vigne/oïdium), B (deltaméthrine, usage tomate/pucerons), C (spinosad, usage fraisier/thrips), D (retiré, usage tomate/pucerons). Résultats attendus : « tomate » → B, A, D (autorisés d'abord) ; « pucerons » → B, D ; « tomate pucerons » → B, D ; « soufre oidium » → A ; « fraise thrips » → C ; « tomate thrips » → aucun.

## Critères d'acceptation

- [ ] Tests cœur sur le catalogue figé de la règle 7 (tous les cas listés).
- [ ] Test : la recherche par nom, AMM et substance donne les mêmes résultats qu'avant (tests T53 inchangés).
- [ ] Test d'écran : « tomate pucerons » → la ligne du produit montre l'usage trouvé ; un tap remplit la fiche.
- [ ] Test : plus de 8 résultats → « N autres produits : précisez la recherche ».
- [ ] Recherche sur le catalogue réel du dépôt en moins de 50 ms (test de temps avec le helper commun, médiane de 5 au moins).
- [ ] Budgets respectés (le catalogue reste chargé à la demande) ; `pnpm verif` passe.

## Hors périmètre

Filtrer par mention bio ou par type de produit (ticket à part si Théophane le demande). Synonymes de cibles (« puceron » au singulier trouve « pucerons » par inclusion ; « aleurode » / « mouche blanche » non traités).

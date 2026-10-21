# T76 — E-Phy : proposer le délai avant récolte selon la culture traitée, pas toutes les cultures de la ferme

**Objectif** : relecture de T75 (2026-10-21). `propositionUsage` (packages/core/src/phyto/ephy.ts) reçoit **toutes les espèces de la ferme** (séries et plantations) et propose un DAR dès que les usages retenus concordent. Avec tomates et fraises sur la ferme, un produit homologué **sur fraisier seulement** propose donc le DAR de la fraise, alors qu'il pourrait servir sur tomate où il n'est pas autorisé. Règle sanitaire : le DAR proposé doit venir de l'usage de **la culture réellement traitée**.

**Dépend de** : T52 (traitements), T53, T75
**Périmètre** : `packages/core/src/phyto/**`, `apps/web/src/ecrans/ferme/phyto/**`, `apps/web/src/ecrans/aujourdhui/traitement/**`, tests
**Priorité** : haute (sécurité sanitaire). **Domaine critique** : oui (agents `-critique`).

## Règles

1. Dans la fiche produit (niveau ferme), la recherche E-Phy remplit AMM, substances, mention bio, mais **ne fixe plus un DAR unique** quand les cultures de la ferme ont des usages différents ou absents : elle affiche les usages par culture.
2. À la **saisie d'un traitement** (T52), si le produit vient d'E-Phy, le DAR proposé est celui de l'usage correspondant à la culture traitée ; aucun usage pour cette culture → avertissement « produit non homologué sur cette culture » (non bloquant, le maraîcher reste maître), DAR à saisir.
3. Aucun DAR deviné ; Q47 (DAR absent dans E-Phy : laisser vide) s'applique.

## Critères d'acceptation

- [ ] Test : ferme tomate + fraise, produit homologué sur Fraisier seul → traitement sur tomate : avertissement, aucun DAR proposé ; sur fraise : DAR de l'usage Fraisier.
- [ ] Test : deux usages de DAR différents pour la culture traitée → l'utilisateur choisit.
- [ ] `pnpm verif` passe.

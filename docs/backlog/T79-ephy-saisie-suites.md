# T79 — Saisie d'un traitement : suites de la relecture de T76

**Objectif** : trois remarques non bloquantes de la contre-relecture de T76 (2026-10-21), sur `SaisieTraitement.tsx`.

**Dépend de** : T76
**Périmètre** : `apps/web/src/ecrans/aujourdhui/traitement/**`, tests
**Priorité** : moyenne. **Domaine critique** : oui (DAR, registre légal ; agents `-critique`).

## Règles

1. **AMM inconnu du catalogue chargé** (produit retiré d'un catalogue plus récent, ou AMM tapé à la main) : le DAR de la fiche est repris, mais avec l'avis « AMM inconnu d'e-phy : vérifiez le DAR pour cette culture » (non bloquant). Il a pu être fixé avant T76 pour une autre culture.
2. **Libellé pendant le chargement** : « chargement d'e-phy… » tant que le catalogue charge ; « e-phy indisponible sur ce téléphone : vérifiez le DAR pour cette culture » seulement après un échec.
3. **Après un échec** : un bouton « Réessayer » dans l'avis (le dialogue ne retente pas seul).

## Critères d'acceptation

- [ ] Test : catalogue chargé sans l'AMM du produit → DAR de la fiche prérempli et avis « AMM inconnu ».
- [ ] Test : pendant le chargement, libellé « chargement » ; après échec, libellé « indisponible » et « Réessayer » relance le chargement.
- [ ] `pnpm verif` passe.

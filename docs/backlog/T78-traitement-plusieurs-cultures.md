# T78 — Traitement : un même produit sur plusieurs cultures en une saisie

**Objectif** : demande de Théophane (2026-10-21) : « Decis Protech, je l'utilise pour plusieurs cultures » ; il veut cocher plusieurs cultures dans la saisie d'un traitement au lieu de saisir le même passage plusieurs fois.

**Dépend de** : T52, T76
**Périmètre** : `packages/core/src/phyto/**`, `apps/web/src/ecrans/aujourdhui/traitement/**`, tests
**Priorité** : haute (usage quotidien). **Domaine critique** : oui (registre légal, DAR ; agents `-critique`).

## Règles

1. À la saisie d'un traitement, on peut cocher **plusieurs cultures** (et leurs emplacements) en une fois ; le produit, la date et la dose sont communs.
2. L'écran de confirmation (un tap, annulable) liste **chaque culture** avec son propre DAR : celui de l'usage E-Phy de cette culture (règle T76), pas un DAR commun. Culture sans usage homologué : avertissement non bloquant, DAR à saisir pour elle.
3. Chaque culture produit **son propre événement `traitement`** (un par emplacement), avec son DAR figé : le registre et le blocage de récolte restent par emplacement. Annuler la saisie annule tous les événements du lot.
4. Aucun DAR deviné ; Q47 s'applique par culture.

## Critères d'acceptation

- [ ] Test : produit homologué sur tomate (DAR 3) et fraise (DAR 1), traitement coché sur les deux le 10/05 → récolte tomate autorisée le 13/05, fraise le 11/05.
- [ ] Test : une des cultures non homologuée → avertissement pour elle seule, DAR demandé pour elle, les autres inchangées.
- [ ] Test : annulation du lot → tous les emplacements redeviennent libres.
- [ ] `pnpm verif` passe.

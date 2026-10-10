# T32h — Toutes les espèces de la ferme dans l'écran Itinéraires (Q40)

**Objectif** : que le gérant règle la croissance d'une espèce de sa ferme même si elle n'a pas encore d'itinéraire.

**Dépend de** : T32c
**Périmètre** : `apps/web/src/ecrans/itineraires/**`

## Règles (Q40, 2026-10-10)

- Chaque espèce de la ferme (non supprimée) a son groupe dans l'écran Itinéraires, avec le bouton « Croissance », même sans itinéraire ; dessous : « Aucun itinéraire ».
- Les espèces de la bibliothèque commune sans itinéraire de la ferme restent absentes (sinon la liste serait immense).
- L'écran reste sous 300 ms (budget habituel), y compris avec une centaine d'espèces.

## Critères d'acceptation

- [ ] Test : une espèce de la ferme sans itinéraire a son groupe, « Aucun itinéraire » et « Croissance ».
- [ ] Test : une espèce de la bibliothèque sans itinéraire de la ferme n'a pas de groupe. Le test de T24 sur le Radis (`ecran.test.tsx`) est revu en conséquence, justifié dans la PR (Q40).
- [ ] `pnpm verif` passe en entier.

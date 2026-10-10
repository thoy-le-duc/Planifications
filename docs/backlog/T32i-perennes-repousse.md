# T32i — Pérennes : repousse en douceur avant la récolte (Q41)

**Objectif** : qu'une pérenne ne surgisse plus d'un coup en pleine végétation 28 jours avant sa récolte.

**Dépend de** : T32f
**Périmètre** : `packages/core/src/croissance/calcul.ts` et ses tests, `apps/web/src/ecrans/plan3d/**` si besoin

## Constat (T32f)

Une campagne qui commence entre fin janvier et début avril, rattachée à l'année d'avant ou non « en cours » au 31 décembre, laisse la plante « au repos » (invisible), puis la fait passer d'un coup en pleine végétation à J−28.

## Règles (Q41, 2026-10-10)

- Pendant les 28 jours qui précèdent le début de récolte, une pérenne au repos redémarre progressivement : débourrement, puis végétation, hauteur croissante de 0 à sa hauteur de récolte.
- Aucun changement hors de ces 28 jours ; les règles de T32a (repos avant le débourrement) et de T32f (continuité au 31 décembre) restent vraies ailleurs. Si un test existant de T32a les contredit sur ces 28 jours, le signaler avant de le modifier.
- Calcul pur et testé ; garde-fous 3D tenus ; aucun budget relevé si possible.

## Critères d'acceptation

- [ ] Test : kiwi, récolte le 20 mars : hauteur nulle au 20 février, croissante chaque semaine jusqu'au 20 mars, jamais de saut au-delà d'un pas fixé.
- [ ] Test : fraise d'hiver de T32f inchangée.
- [ ] `pnpm verif` passe en entier.

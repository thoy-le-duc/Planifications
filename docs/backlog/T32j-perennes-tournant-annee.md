# T32j — Pérennes : repousse continue au tournant de l'année (relecture T32i)

**Objectif** : plus aucun saut de hauteur d'une pérenne autour du 1er janvier.

**Dépend de** : T32i
**Périmètre** : `packages/core/src/croissance/calcul.ts` et ses tests

## Constat (relecture T32i)

1. Une pérenne dont le début de récolte tombe au plus tard le 28 janvier (campagne rattachée à l'année de la récolte) passe encore d'un coup de 0 à pleine hauteur à J−28 (en décembre ou le 31 décembre) : la rampe de T32i ne traverse pas le changement d'année. Exemples : fraisier d'hiver récolté dès le 10 janvier ; kiwi récolté dès le 28 janvier.
2. Kiwi dont la campagne est rattachée à l'année d'avant et dont la récolte commence l'année suivante : reste à pleine hauteur jusqu'au 31 décembre, tombe à 0 m le 1er janvier, puis repousse à partir de J−28.
3. Aucun test au seuil où J−28 égale le débourrement du profil.

## Règles

- La rampe de J−28 au début de récolte (Q41) s'applique aussi quand J−28 tombe l'année précédente ; aucune chute à 0 m au 1er janvier.
- Le reste du comportement de T32i inchangé.

## Critères d'acceptation

- [ ] Test : fraisier d'hiver (récolte du 10 janvier) rattaché à l'année de la récolte : hauteur croissante du 13 décembre au 10 janvier, sans saut.
- [ ] Test : kiwi rattaché à l'année d'avant, récolte en février de l'année suivante : jamais 0 m au 1er janvier s'il était en végétation le 31 décembre.
- [ ] Test au seuil J−28 = débourrement.
- [ ] `pnpm verif` passe en entier.

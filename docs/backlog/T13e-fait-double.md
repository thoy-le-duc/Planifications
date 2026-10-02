# T13e — « Fait » en double sur une relecture tardive

**Objectif** : un second tap sur « Fait » ne peut jamais écrire un deuxième réalisé pour la même tâche.

**Dépend de** : T13c
**Périmètre** : `apps/web/src/ecrans/aujourdhui/EcranAujourdhui.tsx`, `cache.ts`

## Constat (relecture T13c, déjà possible sur `main`)

Une relecture complète qui a lu le journal avant l'écriture d'un « Fait » et livre sa journée après fait tomber le masque : la tâche réapparaît jusqu'à la relecture suivante, et un second tap écrit un deuxième réalisé. La relecture de sécurité toutes les 4 s rend le cas plus fréquent.

## Piste

Garder le masque tant que la journée relue contient encore la tâche ET que l'écriture est récente (relecture lancée avant l'écriture).

## Critères d'acceptation

- [x] Test : relecture lancée avant l'écriture du « Fait », livrée après → la tâche reste masquée, un second tap n'écrit rien.
- [x] Test : après une annulation venue d'ailleurs, « Fait » redevient possible (T13c, inchangé).

## Décision (chef, 2026-10-02)

Chaque lecture de la journée porte le numéro de son départ, chaque « Fait » le numéro de la fin de son écriture : le masque tient tant que la journée affichée vient d'une lecture commencée avant l'écriture. Cas restants, déjà possibles avant, renvoyés à T13f.

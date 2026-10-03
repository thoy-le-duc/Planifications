# T13f — « Fait » en double : changement d'onglet et relecture partielle

**Objectif** : aucun cas, même rare, ne permet d'écrire deux réalisés pour la même tâche.

**Dépend de** : T13e
**Périmètre** : `apps/web/src/ecrans/aujourdhui/EcranAujourdhui.tsx`, `cache.ts`

## Constat (relecture T13e, déjà possible avant)

- Les masques vivent dans l'état de l'écran : « Fait », puis changement d'onglet avant la relecture, puis retour → l'écran se remonte avec une journée en cache encore sans le réalisé ; un second « Fait » écrit un doublon.
- Une relecture incrémentale (synchro d'une autre culture) lancée après la fin d'un « Fait » mais avant que son changement soit annoncé porte un numéro plus récent sans avoir relu la culture du « Fait » : le masque tombe un instant.

## Piste

Garder les masques dans le cache, par ferme et par jour, plutôt que dans l'écran ; ne numéroter une relecture incrémentale que pour les cultures qu'elle a relues.

## Critères d'acceptation

- [x] Test : « Fait », changement d'onglet, retour avant la relecture → la tâche reste masquée, un second « Fait » n'écrit rien.
- [x] Test : synchro d'une autre culture entre l'écriture et l'annonce → la tâche reste masquée.

# T24d — « Annuler » bloqué en silence : prévenir le maraîcher

**Objectif** : quand une annulation des itinéraires est bloquée par une synchro arrivée entre la lecture et l'écriture (garde du WHERE, T24c), l'écran le dit (« modifié entre-temps ») au lieu de laisser croire que tout est défait.

**Dépend de** : T24c
**Périmètre** : `apps/web/src/ecrans/itineraires/ecritures.ts`

## Constat (relecture T24c)

`ecrireEnsemble` ne rend pas le nombre de lignes modifiées : une ligne bloquée par la condition du WHERE passe inaperçue, `ramener` rend `null` et aucun message ne s'affiche. La fenêtre est de quelques millisecondes et l'état reste cohérent.

## Piste

Après l'écriture, relire les lignes visées et compter celles qui n'ont pas pris les valeurs ramenées ; si au moins une, afficher le message « modifié entre-temps ».

## Critères d'acceptation

- [ ] Test : synchro injectée entre lecture et écriture (harnais du test N3 de T24c) → message affiché.

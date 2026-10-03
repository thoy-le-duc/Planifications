# T13l — Aujourd'hui : « Annuler » et gestes pendant la file des « Fait »

**Objectif** : aucun geste n'est ignoré en silence pendant que des « Fait » s'écrivent.

**Dépend de** : T13g
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`

## Constat (relecture T13g)

- Pendant une écriture, « Annuler » (bandeau et historique), « Changer la date » et la récolte sont ignorés sans rien dire. Avec la file, cette fenêtre dure plusieurs lectures ciblées : un « Annuler » tapé juste après trois « Fait » ne fait rien.
- Tests manquants : erreur d'écriture au milieu de la file (les suivants s'écrivent, le message reste) ; « Annuler » pendant la file ; « autre utilisateur, même ferme » avant la base.
- Cosmétique : l'en-tête de `e2e/aujourdhui-grande-ferme.e2e.ts` colle deux puces sur une ligne.

## Règles

- « Annuler » passe dans la file, après le « Fait » qu'il annule.
- Sinon, les autres gestes sont visiblement inactifs tant que la file tourne.

## Critères d'acceptation

- [ ] Test : trois « Fait » puis « Annuler » tout de suite → le dernier est annulé.
- [ ] Test : une erreur au milieu de la file n'arrête pas les suivants et reste affichée.
- [ ] Test : instantané d'un autre utilisateur sur la même ferme jamais affiché avant la base.

# T15e — Export : continue en arrière-plan

**Objectif** : changer d'onglet pendant l'export de toute la ferme ne l'arrête plus (Q28).

**Dépend de** : T15c
**Périmètre** : `apps/web/src/ecrans/export/**`, `apps/web/src/App.tsx`

## Règles

- L'export continue quand on quitte l'onglet Ferme ; le téléchargement arrive quand il est prêt.
- Un bandeau « Export en cours » (avec avancement) est visible sur les autres écrans ; un geste permet d'annuler.
- Un seul export à la fois.

## Critères d'acceptation

- [ ] e2e : lancer l'export, aller sur Aujourd'hui, revenir : l'archive est téléchargée, identique à un export sans changement d'onglet.
- [ ] Test : le bandeau apparaît sur les autres écrans et disparaît à la fin ; « Annuler » arrête proprement.
- [ ] Aucune tâche > 50 ms ajoutée ; JS de démarrage non relevé.

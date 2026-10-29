# T92 — Plan : retirer les anciens chemins, une seule façon de faire chaque chose

**Objectif** : fin du chantier « plan simple et rationnel » (Q55). Après T87 à T91, l'éditeur garde des chemins en double qui embrouillent : « Remplacer par une serre », la liste « Zone abritée » qui accepte n'importe quel bâtiment, le type saisi deux fois (zone et bâtiment), la consigne de l'étape 4.

**Dépend de** : T89, T90, T91
**Périmètre** : `apps/web/src/ecrans/placement/**`, `apps/web/src/ecrans/parcellaire/**` (libellés), tests
**Priorité** : moyenne. **Domaine critique** : non.

## Règles

1. « Remplacer par une serre » disparaît : une zone tunnel ou serre avec un contour tracé propose « Placer la serre » (fiche T89), qui efface le contour dans le même enregistrement après confirmation.
2. La liste « Zone abritée » d'un bâtiment n'est proposée que pour un type serre (tunnel, chapelle), et ne liste que les zones tunnel ou serre sans bâtiment.
3. Le type d'abri d'une zone abritée suit son bâtiment (tunnel ↔ `serre_tunnel`, serre ↔ `serre_chapelle`) : modifié dans Parcellaire, il n'est plus proposé pour une zone abritée (« Défini par la serre X »).
4. Étapes du parcours guidé (T28j) : « Ajouter une serre, une parcelle ou un bâtiment », la consigne cite « Ajouter », « Dupliquer » et « Modifier le plan ».
5. « Aller à » et « Toute la ferme » incluent les serres et leurs zones (aujourd'hui seulement les zones de premier niveau avec contour).

## Critères d'acceptation

- [ ] Tests d'écran pour chacune des cinq règles.
- [ ] Budgets respectés ; `pnpm verif` passe.

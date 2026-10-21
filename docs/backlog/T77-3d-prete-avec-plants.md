# T77 — Jumeau 3D : ne se dire « prête » qu'une fois les plants posés

**Objectif** : relecture de T71 (2026-10-21). La vue 3D se marque « prête » sans attendre la couche des plants (chargée à part depuis T71, déjà tardive avant) ; les plants se posent ~450 ms plus tard, en pleine mesure des changements de semaine, ce qui rend les e2e de temps 3D instables (pics au 3e changement de semaine, sur main comme sur la branche).

**Dépend de** : T71
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, e2e `vue-3d*` (diagnostic seulement), tests
**Priorité** : moyenne. **Domaine critique** : non (performance d'interface ; agent `developpeur` sonnet, relecture `relecteur`).

## Règles

1. L'état « prête » (attribut lu par les e2e et par l'écran) n'est posé que lorsque la couche des plants est chargée et montée (ou a échoué : la vue reste utilisable sans plants).
2. Le premier affichage de la vue ne doit pas ralentir (budget « affichage après chargement du module » inchangé).
3. Aucun seuil ni test de fluidité modifié.

## Critères d'acceptation

- [ ] Test : « prête » attend la couche ; échec de la couche → « prête » quand même, sans plants.
- [ ] e2e `vue-3d-jumeau` : le 3e changement de semaine ne montre plus de pic lié à la pose des plants (mesure avant/après dans le journal).
- [ ] Budgets inchangés ; `pnpm verif` passe.

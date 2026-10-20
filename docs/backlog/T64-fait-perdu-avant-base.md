# T64 — Un « Fait » tapé avant que la base soit prête ne doit jamais se perdre

**Objectif** : T62 l'a mesuré le 20/10 : sous charge, dans **6 passages sur 20**, `e2e/aujourdhui-grande-ferme.e2e.ts` échoue à l'étape **T13k** : un « Fait » tapé dans Aujourd'hui avant que la base locale soit prête **réapparaît « à faire » après rechargement**. T47 et T52 l'avaient déjà vu, sans cause établie. Si la saisie est réellement perdue, c'est une atteinte au principe 3 (rien ne se perd, tout est annulable) et à la confiance du maraîcher. **Priorité absolue sur les nouvelles fonctions.**

**Dépend de** : T13k (fait avant base), T13u (premier fait à froid), T62 (mesures)
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**` (file des gestes avant base, écriture), `apps/web/src/donnees/**`, `packages/sync/**` si la cause est là, `apps/web/e2e/aujourdhui-grande-ferme.e2e.ts` (diagnostic seulement), tests
**Priorité** : très haute. **Modèle** : Opus (synchro, persistance).

## Règles

1. Établir d'abord **ce qui se passe** : le « Fait » est-il écrit puis effacé, jamais écrit, écrit dans une file perdue au rechargement, ou bien écrit mais relu avant d'être visible ? Rejouer l'étape T13k 20 fois sous charge (4 processus) avec des traces ; conserver l'état de la base locale et de la file avant et après le rechargement.
2. Corriger la **cause** dans le code : un geste accepté à l'écran doit être soit écrit durablement, soit refusé visiblement. Jamais accepté puis oublié.
3. Si la cause est la mesure (par exemple, un rechargement fait avant que l'écriture, déjà acceptée, ait fini), corriger alors le test **et** vérifier que le maraîcher ne peut pas tomber dans la même situation (fermeture de l'appli juste après le tap).
4. Interdit : relever un budget, sauter ou désactiver le test.

## Critères d'acceptation

- [ ] Cause écrite dans `docs/mesures/T64.md`, avec les traces.
- [ ] Test d'acceptation qui reproduit la perte (rouge avant le correctif), puis vert.
- [ ] `aujourdhui-grande-ferme` : 20 passages sur 20 sans charge et au moins 19 sur 20 sous charge, l'étape T13k comprise.
- [ ] Temps d'Aujourd'hui inchangés ; `pnpm verif` passe.

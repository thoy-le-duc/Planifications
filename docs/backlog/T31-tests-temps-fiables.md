# T31 — Tests de temps fiables sous charge

**Objectif** : que les tests unitaires qui vérifient un temps (« moins de 60 ms », etc.) n’échouent plus au hasard quand la machine est chargée, sans relever aucune borne. Un test qui échoue « parfois » apprend à tout le monde à ignorer le rouge, et la boucle autonome ne peut pas arbitrer avec un test pareil.

**Constat** : `packages/core/src/planification/travaux.test.ts` (« 3 000 séries avec 6 travaux prévus… moins de 60 ms ») a échoué trois fois les 7 et 8 octobre (61, 72 et 82 ms) sous charge, et passe seul. Il mesure en temps mural : le système préempte le processus, le temps s'allonge sans que le code calcule plus. D'autres tests de temps font de même ou mesurent une seule fois ; certains utilisent déjà une médiane de 5.

**Dépend de** : rien. **Périmètre** : fichiers de test et aides de test seulement (`packages/core/src/test/mesurer.ts` et son test, les `*.test.ts` de temps qui mesurent une seule fois ou en temps mural seul). Aucun fichier de production.

## Règles

- **Un helper commun** `packages/core/src/test/mesurer.ts`, importable par chemin relatif depuis les autres paquets : échauffement hors mesure, puis **médiane d'au moins 5 mesures** (7 par défaut), chaque mesure valant `min(temps mural, temps CPU du processus)` (méthode de T19). Version synchrone et asynchrone. Si la médiane dépasse la borne du test, la série est refaite (3 manches au plus) et la meilleure médiane est gardée : sous forte charge le temps CPU gonfle lui aussi, et la médiane seule échouait encore 2 fois sur 5. La borne ne change pas, un code vraiment trop lent la dépasse à chaque manche. Le message d'échec donne les séries mesurées.
- **Les bornes en ms ne bougent pas.** Un test touché change seulement sa façon de mesurer ; ses vérifications de fond (résultats attendus) restent les mêmes.
- Un code vraiment plus lent doit rester détecté : la médiane et le CPU ne masquent qu'une préemption, pas un algorithme quadratique (le helper a son propre test).
- Hors périmètre, parce que le temps mural y est la grandeur voulue : délais d'annulation (`export-rapide`, `export-robustesse`, « rejet en moins de 200 ms »), tests d'attente de condition, e2e Playwright. Déjà sur le CPU ou en médiane de 5 avec échauffement : `export.test.ts`, `export-leger.test.ts`, `import/robustesse.test.ts`, `en-vigueur.integration.test.ts`, `grande-ferme.test.ts`, `fait-unique-*.test.ts`, `en-vigueur.test.tsx` (mesures de lectures asynchrones en base, laissées telles quelles).

## Critères d'acceptation

- [ ] `mesurer.ts` existe, avec un test : médiane, échauffement, refus de moins de 5 mesures, code lent toujours détecté.
- [ ] Les tests de temps du cœur et de l'écran Plan qui mesuraient une seule fois ou en minimum de 5 passent par le helper (`travaux` ×2, `conflits`, `semainier`, `import/performance`, `plan/calculs`).
- [ ] `git diff origin/main` : aucune borne en ms modifiée dans ces tests.
- [ ] Chaque fichier touché, lancé 3 fois de suite avec 4 processus gourmands en CPU en arrière-plan, puis 3 fois à vide : tout vert.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` passent.

## Risques

- Le CPU du processus compte aussi les fils annexes (ramasse-miettes) : la mesure peut être un peu plus haute que le fil seul, jamais plus haute que le temps mural.
- Une charge très forte peut encore perturber le cache et le processeur : le helper réduit le risque, il ne le supprime pas. Si un test échoue encore sous charge, on enquête sur la cause (nouvelle question dans `docs/questions.md`), on ne relève pas la borne.

**Hors périmètre** : relever une borne, désactiver un test, les e2e de fluidité (T29b).

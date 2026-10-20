# T62 — Tests de temps instables : défilement de Planches, Aujourd'hui grande ferme

**Objectif** : la CI rougit au hasard sur des tests de temps, ce qui coûte une relance, et parfois une enquête, par PR. Il y a eu des rouges intermittents les 19 et 20 octobre, sur les PR #205, #209 et #210. Il faut trouver pour chacun **la vraie cause** : un vrai à-coup de l'appli, une mesure fragile ou la charge du runner. Ensuite, on la corrige, sans relever un budget ni sauter un test.

**Dépend de** : T31 (tests de temps fiables), T19
**Périmètre** : `apps/web/e2e/**` (mesure), `apps/web/src/ecrans/plan/**` et `apps/web/src/ecrans/aujourdhui/**` (seulement si un vrai à-coup est trouvé), `scripts/**`, `docs/mesures/T62.md`
**Priorité** : haute (coût de chaque PR). **Modèle** : Opus (performance).

## Tests visés

1. `e2e/plan-performances.e2e.ts`, défilement : « intervalles fautifs » au-delà du permis sous charge.
2. `e2e/aujourdhui-grande-ferme.e2e.ts:310`, relecture après « Fait » (garde-fou T13t : médiane et plus haute valeur).
3. `vue-3d-jumeau.e2e.ts:214` et `vue-3d.e2e.ts:235` (fluidité 3D) : rouges en local, en WebGL logiciel. Vérifier s'ils échouent aussi en CI, et pourquoi.

## Règles

1. Pour chaque test : instrumenter (Long Animation Frames, traces, comme T47), le rejouer au moins 20 fois en local, sous charge et sans charge, puis attribuer chaque dépassement à une cause : script de l'appli, rendu, ramasse-miettes, ou mesure (horloge, première image, chauffe).
2. Si c'est l'appli : corriger le code (principe 1 : moins de 300 ms).
3. Si c'est la mesure : rendre la mesure robuste (chauffe, médiane sur plusieurs passages, exclusion justifiée des images hors script), **sans** desserrer le budget. Toute modification de test est justifiée dans un commit séparé.
4. Interdit : relever un budget, sauter, désactiver ou mettre en quarantaine un test.
5. Résultats dans `docs/mesures/T62.md` : avant/après, nombre de passages, causes.

## Critères d'acceptation

- [ ] Chacun des tests visés passe 20 fois d'affilée en local (sans charge), et 18 sur 20 au moins sous charge (`stress` ou équivalent, 4 processus).
- [ ] Aucune hausse de budget, aucun test sauté.
- [ ] `docs/mesures/T62.md` rédigé ; `pnpm verif` passe.

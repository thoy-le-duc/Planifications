# T72 — Densité des engrais liquides (kg/L)

**Objectif** : les relectures de T54 et T56 l'ont relevé : un engrais **liquide** saisi en L ou en m³ est compté à 1 kg/L, alors qu'un engrais azoté liquide pèse plutôt 1,2 à 1,3 kg/L (azote sous-estimé d'environ 25 %). Un engrais **solide** saisi en L ou m³ ne compte aucune unité, sans rien dire à l'écran. Théophane a validé un champ « Densité (kg/L) » sur la fiche produit.

**Dépend de** : T54 (cahier de fertilisation), T56 (fertirrigation)
**Périmètre** : `packages/core/src/npk/**`, `packages/core/src/export/tables.ts`, `packages/db` (colonne, migration), `packages/sync/src/schema.ts`, `apps/api/src/sync/fertilisation.ts`, `apps/web/src/ecrans/ferme/fertilisation/**`, `apps/web/src/ecrans/aujourdhui/fertilisation/**`, tests, `docs/modele-donnees.md`. Hors périmètre : `plan3d`, le démarrage de l'appli (budget 71,2 Kio : rien ne passe au démarrage).
**Priorité** : moyenne. **Modèle** : Opus (base et synchro).

## Règles

1. **Champ facultatif** `densite_kg_par_l` sur `produit_fertilisant` : nombre de **0,5 à 2,5** kg/L, sinon refus en français (« densité : de 0,5 à 2,5 kg/L »). Réservé aux produits **liquides** : sur un solide, refus (`incoherent`). Mêmes bornes en base (CHECK).
2. **Calcul** (déterministe, cœur) : kg = volume en L × densité (m³ = 1 000 L) ; unités = kg × teneur ÷ 100. Sans densité : 1 kg/L, comme aujourd'hui (aucun bilan existant ne change).
3. **Écran, densité absente** : un apport (ou une dose de fertirrigation) d'un liquide en L ou m³ affiche « densité non renseignée : 1 kg/L supposé », à la saisie et au cahier. Le calcul n'est pas bloqué.
4. **Écran, solide en volume** : à la saisie, « produit solide saisi en volume : pas d'unités comptées, saisissez en kg ou t ». La valeur n'est **pas** refusée (elle reste comptée « sans unités », règle de T54).
5. **Fertirrigation (T56)** : mêmes règles pour les engrais des recettes (en L) et pour les doses figées de l'irrigation : le bilan et `unitesFertirrigation` utilisent la densité actuelle du produit.
6. **Fiche produit** : champ « Densité (kg/L) » visible seulement pour la forme liquide, clavier décimal (virgule acceptée) ; repasser en solide vide la densité.
7. **Base et synchro** : colonne facultative, migration générée par drizzle-kit après 0042, colonne dans le schéma local, le serveur (`validerProduitFertilisant`), l'export (`produit_fertilisant.csv`). La publication `powersync` est par table et le flux est un `SELECT *` : le garde-fou de T67 doit rester vert sans les toucher.

## Exemples chiffrés

- Liquide de densité 1,25, 100 L à 10 % N : 125 kg × 10 % = **12,5 kg N**.
- Même produit sans densité : 100 kg × 10 % = 10 kg N (inchangé) + mention « densité non renseignée ».
- 2 m³ à densité 1,25 : 2 500 kg.

## Critères d'acceptation

- [ ] Tests du cœur (`npk`, `fertirrigation`), du serveur (validation, colonne) et de l'écran (fiche produit, saisie d'apport, cahier) écrits d'abord, puis verts.
- [ ] Densité hors de 0,5 à 2,5 refusée avec un message en français (cœur, serveur, base).
- [ ] Budget : démarrage inchangé (70,0 Kio, plafond 71,2).
- [ ] `pnpm typecheck`, `lint`, `test`, `build:essais`, `budget` passent.

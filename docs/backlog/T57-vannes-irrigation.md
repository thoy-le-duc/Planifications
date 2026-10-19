# T57 — Vannes d'irrigation : secteurs, planches arrosées, vannes dans la 3D

**Objectif** : la ferme a 60 vannes. Le modèle prévoit déjà les secteurs d'irrigation (numéro de vanne, nom, débit) et leurs emplacements datés, mais aucun écran ne les montre. Ce ticket permet de **déclarer ses vannes**, de **dire ce que chacune arrose**, de les **placer dans le jumeau 3D**, et de voir d'un coup d'œil **ce qui a été arrosé aujourd'hui**.

**Dépend de** : T49 (parcellaire), T28 (placement et 3D), T37 (travaux du jour en 3D)
**Périmètre** : `apps/web/src/ecrans/parcellaire/**` (vannes), `apps/web/src/ecrans/placement/**`, `apps/web/src/ecrans/plan3d/**`, `apps/web/src/ecrans/aujourdhui/**` (saisie d'irrigation), `apps/api/src/sync/**` si validation manquante, tests
**Priorité** : haute après T60. **Modèle** : Opus (3D, synchro).

## Règles

1. **Vannes** (onglet Ferme, « Saisons, zones et planches » → « Vannes ») : numéro, nom, débit (L/h, facultatif). Création **en lot** (« 60 vannes, V1 à V60 »). Pour chaque vanne, on coche les planches ou gouttières qu'elle arrose (plusieurs zones possibles). Le lien est daté (du / au) : un changement de réseau garde l'historique.
2. **Placement** : dans l'éditeur de placement, une vanne se pose au doigt sur le plan, près de ses planches. Sans placement, elle s'affiche en tête de sa première planche.
3. **3D** : chaque vanne est un petit repère numéroté. Un tap met en évidence ses planches et ouvre « V12 — arrose P3, P4, P5 — dernière irrigation : aujourd'hui 7 h, 20 min ». Un filtre « Irrigation » colore les planches selon la dernière irrigation : aujourd'hui, hier, plus ancienne.
4. **Saisie** : « Irrigation » depuis Aujourd'hui ou depuis le repère 3D (vanne, durée), hors ligne.
5. L'état ouvert ou fermé **en direct** (Modbus) n'est pas dans ce ticket : c'est la phase 3. On montre ce qui a été saisi.
6. Budgets : poids de la vue 3D et temps d'affichage respectés, ou relevés avec justification.

## Critères d'acceptation

- [ ] Tests : création de 60 vannes en lot, codes uniques ; lien daté vanne ↔ emplacements, historique gardé quand on change.
- [ ] Test : une vanne qui arrose deux zones.
- [ ] Tests 3D : repère de vanne, tap → ses planches mises en évidence ; filtre « Irrigation » selon la date de la dernière irrigation.
- [ ] Test d'écran : irrigation saisie hors ligne depuis le repère.
- [ ] Budget `jsVue3dGzKio` respecté ; `pnpm verif` passe.

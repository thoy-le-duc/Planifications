# T11f — Suites de la relecture T11b

**Objectif** : fermer les écarts non bloquants trouvés par la relecture de T11b.

**Dépend de** : T11b
**Périmètre** : `apps/web/e2e/**`, `apps/web/src/donnees/**`, `apps/web/src/ecrans/plan/calculs.ts`, `apps/web/src/ecrans/plan3d/donnees-plants.ts`, `apps/web/src/rechargement.ts`, `apps/web/src/ecrans/aujourdhui/**`

## Règles

- **Garde-fou des mesures partout** : `jugerSerie` (maximum ≤ 1,5 fois le budget, en plus de la médiane) appliqué à tous les e2e qui mesurent un temps (Aujourd'hui, Série, Itinéraires, démarrage, export…), pas seulement à `plan.e2e.ts`.
- **Zones supprimées, fin du ménage** : `lireStructure` filtre aussi les bâtiments rattachés à une zone supprimée ; `plan3d/donnees-plants.ts` (~172) ne lit pas les zones supprimées.
- **Écritures en cours au changement d'onglet** : un « Fait » qui s'écrit encore quand on quitte Aujourd'hui doit retenir le rechargement automatique (compteur global d'écritures en cours plutôt qu'un attribut posé sur l'écran).

## Critères d'acceptation

- [ ] Test : chaque e2e de temps juge sa série avec `jugerSerie`.
- [ ] Test : bâtiment d'une zone supprimée absent du plan et de la 3D ; zone supprimée absente de la 3D.
- [ ] Test : « Fait » en cours d'écriture, changement d'onglet, morceau introuvable → pas de rechargement avant la fin de l'écriture.
- [ ] `pnpm verif` passe en entier ; démarrage : aucun octet ajouté sans justification chiffrée (marge de 2 octets après T11b).

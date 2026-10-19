# T56 — Fertirrigation : recettes et apports par vanne, hors-sol et pleine terre

**Objectif** : réponse de Théophane à Q44 : il fait de la fertirrigation en hors-sol **et** parfois en pleine terre, en plus des apports solides. Ce ticket permet d'enregistrer une **recette** (la solution nutritive) et ses **apports par vanne**, et de les verser dans le cahier de fertilisation (T54).

**Dépend de** : T57 (vannes et secteurs), T54 (bilan N-P-K)
**Périmètre** : `packages/core` (calcul des unités apportées), `packages/db` (recette, détail de l'événement irrigation, migration), `apps/api/src/sync/**`, `apps/web/src/ecrans/aujourdhui/**`, `apps/web/src/ecrans/ferme/**`, tests, `docs/modele-donnees.md`
**Priorité** : moyenne. **Modèle** : Opus.

## Règles

1. **Recette** de la ferme : nom (par ex. « Fraise floraison »), engrais solubles avec leur quantité pour 1 000 L de solution mère, taux d'injection (%) **ou** quantités par m³ d'eau, EC cible et pH cible (facultatifs).
2. Une **irrigation** (événement existant : secteur, durée) peut porter une recette. Le volume est saisi, ou calculé avec durée × débit du secteur (T57). On peut aussi relever l'EC et le pH mesurés (facultatif).
3. **Calcul** (cœur, testé) : unités N, P₂O₅ et K₂O apportées = volume × concentration de la recette × teneurs des engrais (T54). L'apport est réparti sur les emplacements du secteur à la date de l'irrigation, au prorata de leur surface.
4. Saisie rapide au champ : « Fertirrigation » depuis Aujourd'hui (vanne, recette, durée) en trois taps, hors ligne. Une irrigation répétée chaque jour se recopie depuis la veille en un tap.
5. Pas de pilotage des vannes (Modbus) dans ce ticket : c'est la phase 3.

## Critères d'acceptation

- [ ] Tests cœur : recette de 10 kg de nitrate de calcium (15,5 % N) pour 1 000 L de mère, injection 1 %, 2 m³ d'eau → 0,31 kg N ; répartition sur deux emplacements de 50 et 150 m².
- [ ] Test : irrigation sans recette → aucun apport compté.
- [ ] Tests d'écran : fertirrigation en trois taps hors ligne, recopie de la veille.
- [ ] Migration testée en intégration ; `pnpm verif` passe.

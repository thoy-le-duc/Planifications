# T47 — Export en arrière-plan : tâche longue intermittente (249 ms) en CI

**Objectif** : l'e2e `apps/web/e2e/export-arriere-plan.e2e.ts` (T15e) échoue par intermittence en CI à l'étape « export de référence, sans changer d'onglet » : `tâche longue pendant l'export de référence`, 249 ms pour une limite de 50 ms (CI de la PR #202, 2026-10-19, part 1/4, runners passant à Ubuntu 26 ; un précédent à 52 ms le 14 octobre). Un échec intermittent n'est pas du bruit tant qu'il n'est pas expliqué (règle de la boucle) : trouver la cause.

**Dépend de** : T15d, T15e, T31 (tests de temps fiables)
**Périmètre** : `apps/web/src/ecrans/ferme/export/**`, `apps/web/e2e/export-arriere-plan.e2e.ts`, `apps/web/e2e/outils.ts` (sonde des tâches longues), tests
**Priorité** : normale.

## Règle

1. Reproduire (CPU ×4, ferme de T07, hors ligne) en boucle locale (au moins 20 passages) et **attribuer** chaque tâche longue > 50 ms : script de l'appli (quelle fonction : écriture du zip, `Blob`, `URL.createObjectURL`, clic de téléchargement, rendu du bandeau), ramasse-miettes, ou tâche du navigateur hors page (téléchargement, service worker).
2. Si c'est l'appli : corriger (découper, céder, déplacer dans le worker) pour qu'aucune tâche de la page ne dépasse 50 ms.
3. Si c'est le navigateur (tâche hors script de la page) : la sonde doit l'écarter **explicitement** (attribution `PerformanceLongTaskTiming`/`long-animation-frame` scripts) et le test le dire dans son message ; ne jamais relever la limite ni rendre le test plus tolérant sans preuve.
4. Le test garde ses budgets (50 ms) et ses conditions.

## Critères d'acceptation

- [x] Note de mesure (`docs/mesures/T47.md`) : 20 passages avant/après, cause attribuée.
- [x] Correction de l'appli ou de la sonde, justifiée par la mesure ; budgets inchangés.
- [ ] 20 passages locaux consécutifs verts ; `pnpm verif` passe. **Non atteint** : 18 sur 20 (avant : 12 sur 20). Un rouge vient du retour sur l'onglet Ferme (rendu d'`EcranFerme`, 57 ms, cause distincte de l'export, déjà présente avant : ticket à part), un autre (496 ms) n'est pas attribué. Voir `docs/mesures/T47.md`.

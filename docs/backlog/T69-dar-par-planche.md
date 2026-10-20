# T69 — Délai avant récolte : bloquer les planches traitées, pas toute la culture

**Objectif** : réponse de Théophane à Q46 (2026-10-20) : « on peut récolter les autres ». Quand une culture n'est traitée que sur une partie de ses planches (2 planches de tomates sur 5), seules les planches traitées sont sous délai avant récolte (DAR). Aujourd'hui (T52, relecture) bloque toute la culture dès qu'un traitement la vise : c'est trop strict, et la 3D (T55) dit l'inverse.

**Dépend de** : T52, T55
**Périmètre** : `packages/core/src/phyto/**` (`interdictionRecolte` et ce qui l'appelle), `apps/web/src/ecrans/aujourdhui/**` (alerte et confirmation à la récolte), `apps/web/src/ecrans/plan3d/dar3d.ts` (seulement si la règle partagée change sa signature), tests, `docs/modele-donnees.md`
**Priorité** : haute (règle sanitaire affichée chaque jour). **Modèle** : Opus.

## Règle

1. Un traitement **qui désigne des planches** (emplacements) interdit la récolte **sur ces planches seulement**, jusqu'à la date de récolte autorisée (exclue).
2. Un traitement **sans planche** (culture sans emplacement : kiwis, asperges, campagne de pérenne) interdit la récolte de **toute la culture** (série ou campagne), comme aujourd'hui.
3. Une récolte saisie **sur des planches précises** n'est alertée que si l'une d'elles est sous DAR. Une récolte saisie **sur la culture sans préciser de planche**, alors qu'une partie seulement est traitée : alerte avec confirmation, le message nomme les planches interdites (« Récolte interdite sur P3, P4 jusqu'au 13/05 »).
4. Même règle dans le cœur pour Aujourd'hui, la 3D et le registre : une seule fonction, testée.

## Critères d'acceptation

- [ ] Tests cœur : 5 planches, 2 traitées → récolte sur une non traitée autorisée, sur une traitée interdite ; culture sans planche traitée → toute la culture interdite ; récolte sans planche sur culture en partie traitée → alerte qui nomme les planches.
- [ ] Tests d'écran Aujourd'hui : pas d'alerte en pesant une planche non traitée ; alerte en pesant une planche traitée.
- [ ] 3D et Aujourd'hui donnent la même réponse sur le même jeu (test croisé).
- [ ] Budgets inchangés ; `pnpm verif` passe.

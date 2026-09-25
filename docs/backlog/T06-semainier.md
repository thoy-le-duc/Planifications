# T06 — Semainier

**Objectif** : chaque lundi, la liste de ce qu'il y a à faire dans la semaine, générée depuis le plan, sans rien ressaisir.

**Dépend de** : T02
**Périmètre** : `packages/core/src/planification/semainier.ts` et ses tests

## Règles métier

- Tâches d'une semaine ISO : semis en pépinière, semis direct, plantation, début de récolte, arrachage (fin d'occupation), pour chaque série dont la date prévue (recalée par les réalisés, T02) tombe dans la semaine ; début de récolte des campagnes de pérennes.
- Une tâche disparaît dès qu'un réalisé de la même étape existe pour la série.
- Une tâche prévue avant la semaine et non réalisée apparaît **en retard**, avec son nombre de jours de retard.
- Chaque tâche porte : étape, série (culture, variété), emplacements concernés, longueur ou nombre de plants, date prévue.
- Ordre : en retard d'abord, puis par date, puis par zone et code d'emplacement.

## Critères d'acceptation

- [ ] `semainier(semaineIso, series, campagnes, realises, dateDuJour)` pure.
- [ ] Tests : batavia de T02 (semis pépinière en 2027-S10, plantation en 2027-S14, début de récolte en 2027-S21) ; plantation réalisée qui retire la tâche ; plantation non faite qui apparaît en retard en S15 avec 7 jours (date du jour `2027-04-12`) ; semaine 53 de 2026 ; série abandonnée absente.
- [ ] 3 000 séries traitées en moins de 30 ms.

**Hors périmètre** : tâches manuelles hors plan, affectation aux personnes, interface (T13).

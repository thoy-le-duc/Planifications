# T02 — Dates d'une série, planification à rebours et décalage

**Objectif** : calculer toutes les dates prévues d'une série depuis son itinéraire et une seule date d'ancre, et les faire glisser quand le réel s'écarte du prévu.

**Dépend de** : T01
**Périmètre** : `packages/core/src/planification/dates-serie.ts` et ses tests

## Règles métier

Paramètres de l'itinéraire (copiés dans l'instantané de la série) : mode (`semis_direct`, `plant_maison`, `plant_achete`), durée en pépinière (jours, plant maison seulement), durée avant récolte (jours, comptée depuis la mise en place), fenêtre de récolte (jours).

- Mise en place = semis direct, ou plantation.
- Semis pépinière = mise en place − durée en pépinière (plant maison uniquement).
- Début de récolte = mise en place + durée avant récolte.
- Fin de récolte = début de récolte + fenêtre de récolte.
- L'ancre peut être le semis, la mise en place ou le début de récolte : les autres dates s'en déduisent, en avant ou à rebours.
- **Décalage** : quand une étape réelle est saisie à une date différente de la date prévue, toutes les étapes suivantes glissent du même nombre de jours. Les étapes déjà réalisées ne bougent jamais.

Exemple de référence : batavia, plant maison, pépinière 28 j, avant récolte 49 j, fenêtre 14 j.

| Ancre | Semis pépinière | Plantation | Début récolte | Fin récolte |
| --- | --- | --- | --- | --- |
| plantation `2027-04-05` | `2027-03-08` | `2027-04-05` | `2027-05-24` | `2027-06-07` |
| début de récolte en semaine 22 de 2027 | `2027-03-15` | `2027-04-12` | `2027-05-31` | `2027-06-14` |
| plantation prévue `2027-04-05`, **réalisée** `2027-04-12` | `2027-03-08` (inchangé) | `2027-04-12` (réel) | `2027-05-31` | `2027-06-14` |

## Critères d'acceptation

- [ ] Fonction pure `calculerDatesSerie(parametres, ancre)` qui renvoie les dates prévues ; les étapes sans objet (semis pépinière en semis direct) sont absentes, pas `null`.
- [ ] Fonction pure `appliquerRealises(datesPrevues, realises)` qui renvoie les dates recalées.
- [ ] Les trois lignes du tableau ci-dessus sont des tests, plus : semis direct (pas de pépinière), plant acheté, ancre sur le semis pépinière.
- [ ] Pérennes : `calculerDatesCampagne(plantation, annee)` avec les années avant première production (asperges : 2 ans sans récolte après plantation, puis période de récolte annuelle de l'itinéraire). Test : asperges plantées en 2026, pas de récolte prévue en 2026 et 2027, récolte prévue en 2028.
- [ ] Propriété testée : pour toute durée positive et toute ancre, les dates sont dans l'ordre semis ≤ mise en place ≤ début ≤ fin.

**Hors périmètre** : occupations (T03), stockage, interface.

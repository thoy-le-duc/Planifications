# T06b — Semainier : une seule ligne en retard par série

**Objectif** : un semainier lisible au champ, même quand une série a été oubliée ou qu'un plan est importé en cours de saison.

**Dépend de** : T06
**Périmètre** : `packages/core/src/planification/semainier.ts` et ses tests

## Règles métier

- Réponse de Théophane à Q12 : une série en retard n'apparaît qu'**une fois** dans le semainier, avec la **plus ancienne** étape non faite ; son retard se compte depuis la date prévue de cette étape.
- Les étapes suivantes de la même série, en retard elles aussi, ne sont pas listées tant que la plus ancienne n'est pas réalisée.
- Une étape de la semaine (pas encore en retard) reste listée normalement, même si la série a déjà une ligne en retard.
- La règle de Q11 est inchangée : une étape antérieure non saisie compte comme faite dès qu'une étape postérieure est réalisée.

Exemple : batavia de T02 (semis pépinière le 2027-03-08, plantation le 2027-04-05, début de récolte le 2027-05-24), rien de réalisé, consultée en 2027-S22 (date du jour 2027-05-31) : une seule ligne, « semis en pépinière », 84 jours de retard. Si le semis est saisi le 2027-03-08 : une seule ligne, « plantation », 56 jours de retard.

## Critères d'acceptation

- [ ] L'exemple ci-dessus en test, plus : série sans retard inchangée ; campagne de pérenne inchangée ; deux séries en retard donnent deux lignes.
- [ ] Les tests existants de T06 qui listaient plusieurs retards pour une même série sont mis à jour, et la PR le justifie par Q12.
- [ ] 3 000 séries toujours traitées en moins de 30 ms.

**Hors périmètre** : interface (T13).

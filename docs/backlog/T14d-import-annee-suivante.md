# T14d — Import : saison à cheval sur deux années

**Objectif** : une série semée en S40 et plantée en S2 est comprise comme plantée l'année suivante (Q18).

**Dépend de** : T14
**Périmètre** : `packages/core/src/import/**`

## Règles

- Dans une ligne, les étapes se suivent : si une semaine retombe avant la précédente, on passe à l'année suivante.
- L'aperçu de l'import le signale (« plantation en 2028 ») au lieu d'une erreur `dates_incoherentes`.
- Une ligne qui franchirait plus d'une année reste en erreur.

## Critères d'acceptation

- [ ] S40 → S2 → S20 : semis année N, plantation et récolte année N+1, signalé.
- [ ] Une série qui s'étalerait sur plus de 52 semaines reste en erreur.

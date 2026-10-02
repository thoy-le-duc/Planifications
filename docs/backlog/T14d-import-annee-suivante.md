# T14d — Import : saison à cheval sur deux années

**Objectif** : une série semée en S40 et plantée en S2 est comprise comme plantée l'année suivante (Q18).

**Dépend de** : T14
**Périmètre** : `packages/core/src/import/**`

## Règles

- Dans une ligne, les étapes se suivent : si une semaine retombe avant la précédente, on passe à l'année suivante.
- L'aperçu de l'import le signale (« plantation en 2028 ») au lieu d'une erreur `dates_incoherentes`.
- Une ligne qui franchirait plus d'une année reste en erreur.

## Critères d'acceptation

- [x] S40 → S2 → S20 : semis année N, plantation et récolte année N+1, signalé.
- [x] Une série qui s'étalerait sur plus de 52 semaines reste en erreur.

## Décisions (chef, 2026-10-02)

- La bascule ne vaut que pour les dates données en semaines ; des dates complètes dans le désordre restent en erreur.
- L'aperçu porte un avertissement `annee_suivante` (« plantation en 2028 ») sur la date qui change d'année, l'année étant celle de la semaine (saison 2025, S50 puis S1 : 2026). La ligne reste valide.
- Plus de 364 jours entre la première et la dernière date d'une ligne qui a basculé, ou deux retombées : erreur sur la date qui dépasse. La limite ne s'applique pas aux lignes sans bascule (pour ne pas refuser des lignes acceptées aujourd'hui).
- L'affichage de l'avertissement à l'écran est dans T14b.

# T48 — Écart entre rangs : libellés plus clairs au champ

**Objectif** : relecture de T43 (PR #200). Pour une culture à un seul rang par planche, l'écran affiche « 1 rang, 120 cm entre rangs » : au champ, on lit « 120 cm entre planches » (entraxe). Et le message serveur unique pour trois erreurs différentes de l'écart est trop générique.

**Dépend de** : T43
**Périmètre** : `apps/web/src/ecrans/itineraires/**` (libellés, aide du champ), `apps/api/src/sync/messages.ts` (messages), tests
**Priorité** : normale, petit ticket sans risque.

## Règle

1. Un rang : libellé « 1 rang, 120 cm entre planches » partout (liste, lecture, formulaire, aide du champ) ; l'aide du champ explique que pour un rang l'écart vaut la distance d'une planche à l'autre.
2. Messages serveur distincts : hors bornes (5 à 200 cm), valeur non numérique, écart donné pour un semis à la volée.
3. Aucun changement de donnée ni de calcul.

## Critères d'acceptation

- [ ] Tests d'écran : libellé « entre planches » à 1 rang ; « entre rangs » à 2 rangs et plus.
- [ ] Tests serveur : trois messages distincts.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, e2e itineraires verts ; démarrage inchangé.

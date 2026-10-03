# T13h — « Fait » unique vérifié au moment d'écrire

**Objectif** : jamais deux réalisés pour la même étape d'une culture, quelle que soit la source de l'écriture (écran, voix, agent, deux onglets).

**Dépend de** : T13f
**Périmètre** : `apps/web/src/ecrans/aujourdhui/ecritures.ts` (et la couche d'écriture de `packages/sync` si c'est là que vit la transaction)

## Constat (relecture T13f)

La garantie repose sur les masques de l'écran Aujourd'hui : elle ne couvre pas les autres sources d'écriture ni deux onglets ouverts.

## Règles

- Dans la même transaction que l'écriture, vérifier qu'un réalisé non annulé n'existe pas déjà pour cette culture et cette étape (ou ce travail) ; s'il existe, ne rien écrire et le dire (« déjà fait »).
- Deux téléphones hors ligne restent possibles : la règle est locale ; le serveur garde son comportement actuel.

## Critères d'acceptation

- [ ] Test : deux appels à `marquerFait` sur la même étape → un seul réalisé, le second rend « déjà fait ».
- [ ] Test : après annulation du réalisé, un nouveau « Fait » s'écrit.
- [ ] Aujourd'hui reste sous 300 ms (grande ferme).

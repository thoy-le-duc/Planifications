# T75 — e-phy : correspondance espèce → culture sur les noms de 2026

**Objectif** : le premier catalogue réel (base e-phy du 2026-10-20, PR #231) nomme les cultures autrement que la base de 2020 sur laquelle T53 s'appuyait (« Tomate - Aubergine », « Cucurbitacées à peau comestible », « Choux pommés »…). Pour une tomate, l'appli dit aujourd'hui « aucun usage autorisé » avec Success 4, alors que le produit est homologué sur « Tomate - Aubergine » avec un DAR de 3 jours. Faux négatif grave ; un faux positif (DAR d'une autre culture) le serait plus encore.

**Dépend de** : T53
**Périmètre** : `packages/core/src/phyto/ephy.ts`, `packages/core/src/phyto/ephy.test.ts`, `packages/core/src/phyto/test/` (fixture), journal.
**Priorité** : haute. **Modèle** : Opus.

## Règles

1. `CORRESPONDANCES` vise les noms de cultures du catalogue réel de 2026, la plus précise d'abord, « Cultures légumières » en repli pour les légumes seulement (comme T53). Les anciennes formes de 2020 (« Tomate », « Melon »…) restent acceptées, déclarées à part dans `ANCIENNES_FORMES`.
2. Comparaison sans casse, sans accents, sans pluriel, tiret ou espace indifférents (« Haricots et Pois non écossés frais » = « Haricots et pois non écossés frais »).
3. Un nom ambigu ne reçoit que la culture générique (« Chou » → « Choux », pas « Choux pommés ») : jamais le DAR d'une autre culture.
4. Le repli « premier mot » de T53 est encadré : seulement pour une liste de têtes sûres (tomate, laitue, fraise…), jamais pour les exceptions connues (« Tomate en arbre » = tamarillo) ; « Melon d'eau » est rattaché explicitement à la pastèque.

## Critères d'acceptation

- [ ] Tests sur les vrais noms de 2026 : tomate, aubergine, fraise, laitue, batavia, salade, courgette, concombre, melon, pastèque, choux, haricot vert, kiwi, pivoine, asperge, carotte, poivron, poireau, oignon, épinard, betterave.
- [ ] Test de cohérence : chaque culture visée par `CORRESPONDANCES` (hors anciennes formes) existe dans la liste figée des 126 cultures du catalogue du 2026-10-20 (`packages/core/src/phyto/test/cultures-ephy-2026.ts`).
- [ ] Tests du repli premier mot : têtes sûres oui, « Melon d'eau » jamais « Melon », « Chou chinois » jamais « Choux pommés ».
- [ ] Typage, lint, tests core/phyto et ecrans/ferme, budget passent.

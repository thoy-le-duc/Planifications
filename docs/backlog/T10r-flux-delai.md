# T10r — Réponses en flux : délai jusqu'au premier morceau

**Objectif** : une réponse en flux dont la source ne produit rien ne garde pas une requête ouverte sans fin.

**Dépend de** : T10q
**Périmètre** : `apps/api/src/serveur.ts`

## Constat (relecture T10q)

Le délai de 300 s de Node ne couvre que la réception de la requête. Depuis T10q, le serveur attend le premier morceau avant de répondre : une source muette garde la requête (et ses ressources) jusqu'au départ du client. Aucune route n'en produit aujourd'hui.

## Règles

- Au plus `DELAI_PREMIER_MORCEAU_MS` (60 s) d'attente du premier morceau : au-delà, source annulée, 504 propre, une ligne au journal.
- Au plafond HTTP/1.0 (T10q), tirer un morceau de plus plutôt qu'attendre un tour de boucle, pour un résultat exact (piste de la contre-relecture).

## Critères d'acceptation

- [ ] Test : source muette → 504 après le délai (option de délai court pour le test), `cancel` appelé, une ligne au journal.
- [ ] Test : source d'exactement le plafond, fermée plus tard → 200 avec Content-Length exact.

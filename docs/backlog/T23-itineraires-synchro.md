# T23 — Synchro : le serveur accepte les itinéraires et les types d'intervention des téléphones

**Objectif** : une ferme crée ou modifie ses itinéraires et ses types d'intervention depuis l'appli, même hors ligne, sans jamais toucher à la bibliothèque commune ni à une autre ferme.

**Dépend de** : T10e, T22
**Périmètre** : `apps/api/src/sync/**`, `packages/core/src/saisies/**`, le banc `e2e:synchro`

## Règles

- `itineraire` et le type d'intervention s'ouvrent à l'écriture, sur le modèle de T10e :
  - PUT, PATCH, suppression douce ; DELETE refusé ;
  - ferme du jeton seulement ;
  - l'historique `modification` est écrit par le serveur.
- **Bibliothèque commune** (`ferme_id` nul) : en lecture seule. Pour l'adapter, on la duplique dans la ferme.
- Les travaux prévus sont validés par le cœur (T22) : repères, décalages, répétitions et temps plausibles, et type d'intervention de la ferme.
- **Tout ou rien** : l'itinéraire et, le cas échéant, les séries à venir mises à jour avec lui (T24) s'écrivent en une seule transaction.

## Critères d'acceptation

- [ ] Un test d'intégration par règle, dont l'écriture dans la bibliothèque commune (refusée) et celle d'une autre ferme (refusée).
- [ ] e2e à deux téléphones : un itinéraire créé hors ligne sur A arrive chez B.

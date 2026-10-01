# T24b — « Annuler » des itinéraires : série supprimée ailleurs

**Objectif** : l'annulation de l'écran « Mes itinéraires » ne rend jamais active une occupation dont la série a été supprimée entre-temps sur un autre téléphone.

**Dépend de** : T24
**Périmètre** : `apps/web/src/ecrans/itineraires/ecritures.ts` (`ramener`)

## Constat (relecture T12b)

Dans `ramener`, quand la série n'est pas dans l'état ramené (`serie === undefined`), les occupations sont jugées valides et peuvent être rétablies sous une série supprimée ; le serveur refuse alors le lot en fin de lot (« série supprimée alors qu'une de ses occupations reste active »).

## Critères d'acceptation

- [ ] Test : appliquer l'itinéraire aux séries à venir, une série est supprimée ailleurs (série et occupations), « Annuler » : aucune occupation de cette série n'est réactivée, message « modifié entre-temps », le reste est défait.

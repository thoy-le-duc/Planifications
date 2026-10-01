# T24c — « Annuler » des itinéraires : types d'intervention et course lecture/écriture

**Objectif** : l'annulation de l'écran « Mes itinéraires » n'écrit jamais un itinéraire ou un type que le serveur refuserait, même si un autre téléphone a changé les types entre-temps.

**Dépend de** : T24b
**Périmètre** : `apps/web/src/ecrans/itineraires/**`

## Constats (relecture T24b, défauts antérieurs)

- **N1 — types périmés** : `ramener` valide l'itinéraire ramené avec la liste des types connue au moment de l'enregistrement. Si un type retiré par la modification est supprimé ailleurs entre-temps, l'annulation remet un type supprimé et le serveur refuse le lot. Relire `type_intervention` en base au moment d'annuler.
- **N2 — annuler un renommage de type** : deux refus serveur ne sont pas anticipés — le nouveau libellé est devenu utilisé ailleurs (« type utilisé, ne se renomme pas »), ou l'ancien libellé a été recréé ailleurs (« existe déjà dans cette catégorie »). Vérifier ces deux règles avant d'écrire, sinon laisser la ligne avec le message « modifié entre-temps ».
- **N3 — course lecture/écriture** : les lectures et `ecrireEnsemble` ne sont pas une seule transaction ; une synchro reçue entre les deux échappe aux vérifications. Faire lectures et écritures dans la même transaction, ou porter la condition « valeur actuelle = valeur écrite » dans le WHERE de chaque UPDATE.

## Critères d'acceptation

- [ ] Un test par constat (N1, N2 ×2, N3).
- [ ] Le témoin « rien n'a bougé ailleurs » défait toujours tout.

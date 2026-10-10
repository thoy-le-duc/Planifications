# T32g — « Personnaliser » une espèce de la bibliothèque (Q39)

**Objectif** : que le gérant puisse régler la croissance d'une espèce de la bibliothèque commune en en faisant une copie propre à sa ferme.

**Dépend de** : T32c
**Périmètre** : `apps/web/src/ecrans/itineraires/**`, `packages/sync/src/porte*` (écriture de la copie), `apps/api/src/sync/**` (droits), `docs/modele-donnees.md`

## Règles (Q39, 2026-10-10)

- Sur une espèce de la bibliothèque, dans l'écran Itinéraires : bouton « Personnaliser », gérant seulement. Il crée en une écriture une espèce de la ferme, copie de l'espèce de la bibliothèque (nom, champs, profil de croissance par défaut compris, règle de l'asperge comprise), puis ouvre son réglage de croissance.
- Les cultures et itinéraires existants restent liés à l'espèce d'origine (rien n'est réécrit en silence). L'écran le dit en une phrase.
- Deux copies de la même espèce : refusées (« Tomate est déjà personnalisée »), sauf si la première a été supprimée.
- Hors ligne d'abord : la copie s'écrit par la porte et se synchronise ; un équipier ne peut pas personnaliser (refus serveur aussi).

## Critères d'acceptation

- [ ] Test : le gérant personnalise la Tomate de la bibliothèque → une espèce « Tomate » de la ferme, profil par défaut de la Tomate, réglable ensuite.
- [ ] Test : l'asperge personnalisée garde « pas de fougère pendant la récolte ».
- [ ] Test serveur : un équipier qui envoie la copie → refus ; le gérant → accepté.
- [ ] Test : deuxième personnalisation de la même espèce refusée avec message.
- [ ] `pnpm verif` passe en entier.

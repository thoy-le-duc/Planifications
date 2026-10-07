# T14e — Import : écriture des séries importées

**Objectif** : les séries d'un fichier importé deviennent de vraies séries de la ferme (itinéraire déduit des dates, saisons créées), annulables comme le reste de l'import.

**Dépend de** : T14b, T10s
**Périmètre** : `apps/web/src/ecrans/import/**`, `packages/core/src/import/**`

## Constat (testeur T14b)

L'écriture des séries importées est le plus gros morceau de T14b ; ses tests sont isolés et passent dans ce ticket. L'annulation d'un import dont les lignes ont servi depuis (une série posée sur une planche importée) n'est pas encore couverte.

## Critères d'acceptation

- [ ] Les tests « séries » écrits pour T14b passent.
- [ ] Test : annuler un import dont une planche porte depuis une série saisie à la main → refus explicite, rien n'est retiré.

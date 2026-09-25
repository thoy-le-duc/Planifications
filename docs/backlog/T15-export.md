# T15 — Export complet JSON + CSV

**Objectif** : principe 5 : le maraîcher récupère toutes les données de sa ferme en un geste, sans condition, même hors ligne.

**Dépend de** : T10
**Périmètre** : `packages/core/src/export/**`, `apps/web/src/ecrans/export/**`

## Règles

- Un bouton « Exporter toute ma ferme » produit une archive ZIP : un fichier JSON complet et un CSV par table, avec un `LISEZMOI.txt` qui décrit chaque colonne.
- Export construit sur le téléphone depuis la base locale : fonctionne hors ligne.
- Dates en `AAAA-MM-JJ`, nombres avec un point décimal dans le JSON, CSV en UTF-8 avec BOM et `;` (lisible directement dans Excel).
- Aucune donnée d'une autre ferme, aucun jeton, aucun secret dans l'archive.

## Critères d'acceptation

- [ ] Test : export du jeu de T07, puis relecture des CSV et du JSON : même nombre de lignes par table que la base.
- [ ] Test : l'export ne contient aucun identifiant d'une autre ferme.
- [ ] Export de la ferme complète en moins de 10 secondes, CPU ralenti ×4.

**Hors périmètre** : réimport de l'archive (plus tard), exports réglementaires (registre phyto, phase 3).

# T14c — Import : suites de la relecture

**Objectif** : fermer les derniers écarts non bloquants trouvés par la quatrième relecture de T14.

**Dépend de** : T14
**Périmètre** : `packages/core/src/import/**`

## Règles

- Échappements OOXML : `_x0000_` et une moitié de paire seule (`_xD83D_`) refusés comme les références `&#…;`.
- Caractères de contrôle interdits en XML 1.0 (`&#1;` à `&#8;`, etc.) refusés.
- `creerModele` refuse (ou signale) une correspondance qui associe un champ à deux colonnes, pour qu'un modèle enregistré reste toujours relisible par `lireModele`.
- Fin de fichier UTF-16 corrompue : le repli manuel produit le même nombre de U+FFFD que le décodeur natif (norme WHATWG).
- Mémoire du plan par ligne en erreur : 400 000 lignes à 5 erreurs doivent tenir dans 512 Mo.

## Critères d'acceptation

- [ ] Un test par règle, en exécution isolée pour la mémoire.

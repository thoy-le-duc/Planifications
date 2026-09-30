# T14b — Import : le parcours à l'écran

**Objectif** : le maraîcher importe ses fichiers en quelques gestes, avec le moteur d'import de T14.

**Dépend de** : T14, T16
**Périmètre** : `apps/web/src/ecrans/import/**`, `packages/sync` (écriture de l'import), `docs/import/`

## Règles

Le parcours du ticket T14 (déposer, dire ce que c'est, faire correspondre colonnes et valeurs, aperçu, importer), habillé comme la maquette « Import » :
- le lecteur Excel (`packages/core/src/import/xlsx.ts`) se charge seulement quand un fichier `.xlsx` est déposé, hors budget de démarrage ;
- la préparation tourne dans un Web Worker (1 million de lignes prend environ 15 s) ;
- « Importer » écrit en une seule opération dans la base locale via `@planif/sync`, annulable depuis l'historique ;
- le modèle d'import validé est enregistré pour la ferme ;
- une zone par défaut est proposée quand le parcellaire n'a pas de colonne de zone ;
- les doublons sont aussi cherchés contre la base, pas seulement dans le fichier ;
- `docs/import/` explique en une page comment importer ses fichiers.

## Suites de la relecture de T14c

- Les modèles d'import relus depuis la base (JSON, IndexedDB) passent par une garde à l'exécution avant `creerModele`, qui ne lève jamais tant que ses entrées respectent leurs types.
- L'aperçu montre la cellule fautive à côté du message (`lignes[ligne - 1][colonne]`), y compris une zone reprise de la ligne du dessus.
- Rapprochement des cultures : 400 000 cultures toutes différentes prennent 26 s et 500 Mo ; limiter le nombre de valeurs distinctes à rapprocher, ou le faire dans le Web Worker avec un plafond.

## Critères d'acceptation

- [ ] e2e : chaque fichier du jeu de T14 importé de bout en bout, dont quatre sans correction manuelle.
- [ ] Import annulé : aucune trace ; modèle réutilisé sur un second fichier.
- [ ] Ferme complète (jeu de T07 exporté en tableur) importée en moins de 60 s, CPU ralenti ×4, sans geler l'écran.

**Hors périmètre** : correspondance proposée par l'IA (phase 2).

# T14 — Import de n'importe quel tableur

**Objectif** : qu'une ferme soit opérationnelle en moins d'une heure en important ses propres fichiers, quelle que soit leur forme : l'appli s'adapte au tableur de la ferme, pas l'inverse.

**Découpage (2026-09-29)** : cette branche ne fait que le moteur pur dans `packages/core/src/import/**`. Les écrans, l'écriture en base, l'annulation et `docs/import/` sont dans T14b ; les derniers écarts de relecture dans T14c.

**Dépend de** : T10
**Périmètre** : `packages/core/src/import/**` (lecture, correspondance, normalisation, validation : pur et testé), `apps/web/src/ecrans/import/**`, `docs/import/`

## Parcours

1. **Déposer un fichier** : CSV ou Excel (`.xlsx`). Le lecteur Excel se charge seulement à ce moment-là, hors du budget de démarrage.
2. **Dire ce qu'il contient** : parcellaire, cultures et itinéraires, séries, ou assolement passé. L'appli propose un choix d'après les en-têtes.
3. **Faire correspondre les colonnes** : chaque colonne du fichier est associée à un champ de l'appli, ou ignorée. L'appli pré-remplit la correspondance à partir d'un dictionnaire de synonymes (« Planche », « N° planche », « Bed », « Longueur (m) », « Long. »…). L'utilisateur corrige d'un geste.
4. **Faire correspondre les valeurs** : les noms de cultures inconnus sont rapprochés de la bibliothèque (« Batavia blonde » → batavia) ; l'utilisateur valide, choisit une autre culture ou en crée une nouvelle.
5. **Aperçu** : lignes valides, lignes en erreur avec le motif, doublons. Rien n'est écrit avant « Importer ».
6. **Importer** : une seule opération, annulable depuis l'historique.

La correspondance validée est enregistrée comme **modèle d'import** de la ferme : le fichier suivant de même forme s'importe sans rien reprendre.

## Règles de normalisation

- Séparateur `;`, `,` ou tabulation détecté ; encodage UTF-8 ou Windows-1252 (exports Excel) détecté.
- Nombres à virgule ou à point ; unités reconnues dans l'en-tête ou la cellule (m, cm ; kg, g).
- Dates : `JJ/MM/AAAA`, `AAAA-MM-JJ`, date Excel (nombre de jours), ou semaine (`S14`, `sem 14`) avec l'année de la saison.
- Hiérarchie du parcellaire : une colonne par niveau (zone, sous-zone, emplacement), de un à trois niveaux selon la ferme ; lignes vides et lignes de total ignorées.
- Bibliothèque : familles botaniques avec délais de retour par défaut, fournis avec l'appli et modifiables. Les valeurs par défaut sont proposées à Théophane avant d'être figées.

## Critères d'acceptation

- [ ] Jeu de test d'au moins six fichiers de formes différentes dans `packages/core/src/import/__fixtures__/` : en-têtes français et anglais, Excel Windows-1252 avec `;` et virgules décimales, `.xlsx` avec une ligne de titre au-dessus des en-têtes, parcellaire à deux et à trois niveaux, dates en semaines, colonnes en trop et dans le désordre.
- [ ] Chaque fichier du jeu s'importe correctement après validation de la correspondance proposée, sans correction manuelle pour au moins quatre d'entre eux.
- [ ] Tests : ligne invalide signalée sans bloquer les autres ; culture inconnue qui demande une décision ; import annulé qui ne laisse aucune trace ; modèle d'import réutilisé sur un second fichier.
- [ ] Import d'une ferme complète (jeu de T07 exporté en tableur) en moins de 60 secondes, CPU ralenti ×4.
- [ ] `docs/import/` explique en une page, pour un maraîcher, comment importer ses fichiers.

**Hors périmètre** : proposition de la correspondance par l'IA (phase 2, validée en un geste comme toute proposition), modèles d'import prêts pour Elzéard, Qrop et Brinjel (phase 4).

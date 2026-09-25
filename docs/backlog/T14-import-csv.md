# T14 — Import CSV

**Objectif** : qu'une ferme soit opérationnelle en moins d'une heure, en important son parcellaire, ses cultures, ses séries et son assolement passé.

**Dépend de** : T10
**Périmètre** : `packages/core/src/import/**` (lecture et validation, pur), `apps/web/src/ecrans/import/**`, `docs/import/` (modèles de fichiers)

**Statut : à préciser.** Il faut d'abord les fichiers réels des Jardins de Garonne pour caler les colonnes (voir `docs/questions.md`).

## Règles

- Quatre fichiers modèles, colonnes en français, documentés dans `docs/import/` : parcellaire (zone, chapelle, emplacement, sorte, longueur, largeur), cultures et itinéraires, séries, assolement passé.
- Séparateur `;` ou `,` détecté ; nombres à virgule française acceptés ; encodage UTF-8 ou Windows-1252 (exports Excel).
- Aperçu avant import : lignes valides, lignes en erreur avec le motif, doublons. Rien n'est écrit avant « Importer ».
- L'import est une seule opération annulable depuis l'historique.
- Bibliothèque : familles botaniques avec délais de retour par défaut, fournis avec l'appli et modifiables. Les valeurs par défaut sont proposées à Théophane avant d'être figées.

## Critères d'acceptation

- [ ] Les fichiers réels des Jardins de Garonne s'importent sans erreur (test avec une copie anonymisée si besoin).
- [ ] Tests : fichier Excel Windows-1252 avec `;` et virgules décimales ; ligne invalide signalée sans bloquer les autres ; import annulé qui ne laisse aucune trace.
- [ ] Import de la ferme complète en moins de 60 secondes, CPU ralenti ×4.

**Hors périmètre** : imports Elzéard, Qrop et Brinjel (phase 4).

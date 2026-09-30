# T15c — Export : sous 10 secondes sur un téléphone moyen

**Objectif** : l'export complet de la ferme T07 tient en moins de 10 s dans le navigateur (hors ligne, CPU ×4), sans aucune tâche de plus de 50 ms.

**Dépend de** : T16b
**Périmètre** : `packages/core/src/export/**`, `packages/sync/src/export.ts`, `apps/web/src/ecrans/export/**`, `apps/web/vite.config.ts` (nom du worker)

## Constat (T16b)

Du tap au téléchargement : 11,5 à 15,4 s selon la charge de la machine.

| Étape | Durée |
| --- | --- |
| Lecture de la base (IndexedDB) | ≈ 6 s |
| Construction de l'archive, après la lecture, sur le fil principal | ≈ 3,7 à 5,5 s |

La borne de l'e2e a été relevée à 15 s dans T16b, provisoirement.

## Règles

- **Lecture et construction en parallèle** : `@planif/core` construit l'archive table par table, au fil de la lecture. Visé : environ 6 s, soit le temps de la lecture seule.
- **Archive identique au bit près** à celle d'aujourd'hui (tests T15, T15b, T19).
- **Retour de la borne de `export.e2e.ts` à 10 s.**
- **Suites de la relecture T16b** :
  - le worker de compression est rangé hors d'`assets/sqlite/`, avec un test sur le précache ;
  - si le worker ne se charge pas, repli sur la compression au fil principal ;
  - contre-pression vers le worker, avec un pic mémoire mesuré ;
  - tests de l'annulation entre deux pages, et d'une table de 2 000 puis 2 001 lignes ;
  - contour de focus du bouton d'export actif.
- **À confirmer avec Théophane** : changer d'onglet annule l'export sans le dire.

## Critères d'acceptation

- [ ] `export.e2e.ts` passe avec `DUREE_MAX_MS = 10_000` et `TACHE_MAX_MS = 50`.
- [ ] Un test par règle.

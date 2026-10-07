# T15d — Export : jamais de tâche longue sur le fil principal

**Objectif** : l'export reste fluide sur un téléphone moyen, et son test e2e ne vacille plus en CI.

**Dépend de** : T15c
**Périmètre** : `apps/web/src/ecrans/ferme/**` (export), `packages/sync/src/export*.ts`

## Constat (CI de main, 2026-10-02, commit 1c36125)

`e2e/export.e2e.ts` (« fil principal jamais gelé », CPU ×4, ferme de T07) a mesuré une tâche de 57 ms pour 50 ms permis ; les passages suivants étaient verts. Une vraie tâche longue existe donc par moments pendant l'export.

## Règles

- Trouver la tâche (profil Chrome sous CPU ×4) et la découper (travail par tranches, ou dans le worker) ; ne pas relever le seuil de 50 ms.

## Critères d'acceptation

- [ ] `export.e2e.ts` passe 10 fois de suite en local sous CPU ×4 sans dépasser 50 ms.

## Suites de la relecture T15c

- La lecture n'a pas de contre-pression vers la construction : les tables lues restent en mémoire tant que la construction est en retard (pas pire qu'avant). Attendre l'ajout de la table k−1 avant de lire k+1.
- Un worker tué après « pret » sans aucun événement : couvert par le chien de garde de 15 s, mais la barre reste figée pendant ce temps.
- La barre d'avancement donne une part fixe à chaque table : elle avance par sauts pendant la lecture des événements.

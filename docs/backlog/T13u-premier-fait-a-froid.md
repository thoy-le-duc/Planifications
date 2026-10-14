# T13u — Aujourd'hui : le tout premier « Fait » d'un lancement à froid

**Objectif** : que le tout premier « Fait » tapé juste après l'ouverture de la base (grande ferme) apparaisse en moins de 500 ms.

**Dépend de** : T13t
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`, `packages/sync/**` (première écriture), e2e Aujourd'hui grande ferme

## Constat (T13t, 2026-10-11)

- Le tout premier « Fait » d'un lancement à froid, tapé sur l'instantané dans la seconde qui suit l'ouverture de la base, prend encore ≈ 1,0 à 1,2 s : la première requête de la relecture complète (3 000 séries, pages froides, ≈ 1,4 s) ne peut pas être interrompue, et la première écriture coûte ≈ 280 ms dans `packages/sync`.
- Relecture T13t : si la relecture complète est dans sa dernière requête au moment du « Fait », la ligne provisoire disparaît puis revient ; une écriture qui ne se termine jamais suspend aussi la relecture complète ; libellés « Annuler : … (2) » calculés séparément pour les saisies provisoires et l'instantané.

## Règles

- Mesurer d'abord (e2e dédié : premier « Fait » dans la seconde suivant l'ouverture de la base), puis découper la première requête de la relecture complète (pages) pour qu'elle puisse céder, et alléger la première écriture.
- Aucun budget relevé ; démarrage : quelques octets de marge seulement.

## Critères d'acceptation

- [x] e2e : premier « Fait » à froid sur la grande ferme, saisie dans l'historique < 500 ms (médiane), garde-fou 1,5 fois.
- [x] Test : la ligne provisoire ne disparaît jamais avant l'arrivée de la journée qui la contient.
- [ ] `pnpm verif` passe en entier.

## Mesures

Détail : `docs/mesures/T13u-avant.md`, `docs/mesures/T13u-apres.md`.

| Étape | Médianes (5 délais de tap) | Maximum |
| --- | --- | --- |
| Constat T13t | ≈ 1,0 à 1,2 s | — |
| Avant T13u | 1 500 à 1 648 ms | 2 098 ms |
| T13u, 1re passe (lecture ciblée, pages, écriture) | 616 à 714 ms | 1 143 ms |
| T13u, 2e passe (préchargement du plan qui cède, occupations par l'index, lectures ciblées ensemble) | **354 à 416 ms** | **684 ms** |

Planches, premier affichage juste après l'ouverture (ferme de T07) : 41 à 207 ms de médiane (avant 55 à 67). Démarrage : 72 801 octets pour 72 806.

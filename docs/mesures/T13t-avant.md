# Mesure : première relecture après « Fait », avant T13t

Mesure du 2026-10-11, avant toute correction, sur `main` (3f12b62).

## Conditions

- Chromium headless (Playwright), profil Pixel 7, conteneur de développement, sans autre e2e en parallèle. **Ce n'est pas un vrai téléphone.**
- CPU ralenti ×4 (`Emulation.setCPUThrottlingRate`) : seul le fil principal de la page est ralenti, pas le worker où tourne SQLite.
- Build des essais (`dist-essais`), grande ferme de T13b (3 000 séries actives, ≈ 51 000 événements), amorcée par `/diagnostic/amorcer.html`, hors ligne.
- Mesure : de l'appui (`pointerdown`) sur « Marquer fait » à l'arrivée de la saisie en tête de l'historique, comme `aujourdhui-grande-ferme.e2e.ts`.
- Banc de profil : un e2e jetable (non commité) qui reprend les mêmes étapes, avec des marques `performance.mark` provisoires dans `cache.ts`, `calculs.ts` (`lireCultures`, une marque par requête) et `ecritures.ts` (début et fin de la transaction), plus un profil CPU (CDP `Profiler`) du fil principal et les tâches longues (`PerformanceObserver`).

## Le constat (T11f)

`aujourdhui-grande-ferme.e2e.ts`, relecture après « Fait », cinq saisies d'affilée :

| Passage | 1re | 2e | 3e | 4e | 5e |
| --- | --- | --- | --- | --- | --- |
| a | **2 361** | 205 | 154 | 209 | 155 |
| b | **1 762** | 439 | 712 | 186 | 203 |
| c | **1 145** | 420 | 792 | 225 | 190 |

En ms, budget 500 ms, plafond 750 ms (1,5 × budget).

## Profil

### Sans passer par Planches (base ouverte, écran au repos depuis 2 s)

Instants depuis l'appui, en ms.

| Étape | 1re | 2e | 3e | 4e | 5e |
| --- | --- | --- | --- | --- | --- |
| début de l'écriture | 80 | 20 | 27 | 19 | 14 |
| fin de l'écriture (transaction) | 366 | 108 | 127 | 90 | 70 |
| avis de changement de la base | 459 | 177 | 167 | 127 | 105 |
| `lireCultures` : 3 requêtes | 460→516 | 178→221 | 167→202 | 127→157 | 105→135 |
| `recalculerCultures` | 534 | 237 | 208 | 162 | 140 |
| **saisie dans l'historique** | **570** | 287 | 239 | 173 | 173 |

La première écriture coûte 286 ms au lieu de 50 à 100 (premières requêtes de la porte dans le worker : requêtes à préparer, pages froides). `lireCultures` (≈ 56 ms la 1re fois, 30 à 43 ensuite) et `recalculerCultures` (18 ms, puis 5 à 16) pèsent peu. Dans cette situation, la 1re relecture reste sous le plafond : **570 ms**.

### Comme l'e2e : cinq allers-retours Planches → Aujourd'hui juste avant

C'est l'étape qui précède dans `aujourdhui-grande-ferme.e2e.ts` : le test tape « Marquer fait » dès que la première carte est visible après le dernier retour sur Aujourd'hui.

| Étape | 1re | 2e | 3e | 4e | 5e |
| --- | --- | --- | --- | --- | --- |
| fin de l'écriture | 320 | 92 | 86 | 145 | 95 |
| avis de changement | 395 | 130 | 125 | 180 | 130 |
| **début de `lireCultures`** | **1 024** | 131 | 125 | 180 | 130 |
| tâche longue sur le fil principal | **747 → 1 026 (279 ms)** | — | — | — | — |
| **saisie dans l'historique** | **1 072** | 269 | 203 | 267 | 194 |

## La cause

**La première relecture attend une relecture complète de la journée.** Rouvrir l'onglet « Aujourd'hui » dessine la journée gardée en cache (budget du tap), puis relit **toute** la journée (`lireJournee` : une dizaine de requêtes sur 3 000 séries, puis `calculerEtat`), au cas où la base aurait changé pendant que l'écran était fermé. Le « Fait » tapé tout de suite après tombe pendant cette relecture :

1. la relecture incrémentale de la culture touchée (T13c) ne démarre qu'à la fin de la relecture complète : une lecture à la fois (`cache.ts`, `relire`). Ici, l'avis de changement arrive à 395 ms, `lireCultures` ne démarre qu'à 1 024 ms ;
2. entre les deux, la journée complète est recalculée sur le fil principal (`calculerEtat` sur 3 000 séries : tâche longue de **279 ms** sous CPU ×4) ;
3. la saisie paraît dans l'historique à la fin de cette relecture complète (ses dernières requêtes, lancées après l'écriture, la voient déjà), soit **1 072 ms**, puis la relecture incrémentale repasse derrière.

Les relectures suivantes n'ont plus de relecture complète devant elles (150 à 290 ms). Les 712 à 792 ms vus en 3e position dans l'e2e n'ont pas été reproduits par le banc de profil (203 ms) ; piste la plus probable : le même effet en plus petit (une relecture complète, ou son recalcul, encore en cours au moment de l'appui).

Ce n'est **pas** :

- la préparation des requêtes de `lireCultures` : 56 ms la 1re fois contre 30 à 43 ensuite ;
- le recalcul incrémental : 18 ms la 1re fois, 5 à 16 ensuite ; il ne recalcule que la culture touchée ;
- le JIT ou le ramasse-miettes du fil principal : le profil CPU de la 1re relecture ne montre aucune fonction au-dessus de 13 ms (hors `(program)` et `(idle)`), et pas de ramasse-miettes notable.

Contribution secondaire : la première transaction d'écriture après l'ouverture de la base coûte 200 à 280 ms de plus que les suivantes (worker, hors du périmètre de T13t : `packages/sync`).

## Correction visée

Une relecture complète qui n'est pas indispensable à l'affichage (la journée en cache est déjà là) **cède la place** à une saisie de l'écran, comme le fait déjà la vérification de T13c : elle s'arrête à la requête suivante, la relecture incrémentale de la culture touchée passe tout de suite, puis la relecture complète reprend juste après. Rien de nouveau au démarrage.

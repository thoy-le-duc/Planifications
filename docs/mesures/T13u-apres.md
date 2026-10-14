# Mesure : premier « Fait » d'un lancement à froid, après T13u

Mesure du 2026-10-11, mêmes conditions que `T13u-avant.md` (Chromium headless, profil Pixel 7, CPU ×4 sur le fil principal, build des essais, grande ferme de T13b, hors ligne).

## L'e2e (`aujourdhui-premier-fait.e2e.ts --repeat-each=5`) : toujours rouge

Du tap à la saisie dans l'historique, en ms (budget 500 ms, plafond 750 ms) ; colonnes : délai du tap après l'ouverture de la base.

| Passage | 0 ms | 200 ms | 400 ms | 600 ms | 800 ms | Médiane |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 013 | 754 | 714 | 297 | 222 | 714 |
| 2 | 886 | 714 | 571 | 636 | 335 | 636 |
| 3 | 1 143 | 618 | 616 | 406 | 230 | 616 |
| 4 | 1 091 | 829 | 525 | 657 | 344 | 657 |
| 5 | 1 080 | 844 | 688 | 482 | 576 | 688 |

Avant : médianes **1 500 à 1 648 ms**, maximum 2 098 ms. Après : médianes **616 à 714 ms**, maximum 1 143 ms. 0 passage sur 5 vert : le critère (médiane < 500 ms, maximum ≤ 750 ms) n'est pas atteint.

## Ce qui a été corrigé (banc de profil, marques provisoires non commitées)

| Étape | Avant | Après |
| --- | --- | --- |
| lecture ciblée, requête de la série (par son id) | 500 à 860 ms (index ferme_statut, 3 000 séries parcourues) | 50 à 60 ms |
| première requête de la relecture complète | 3 000 séries d'une traite, 750 à 860 ms, ne cède pas | pages de 250 séries, 60 à 100 ms à froid, cède entre deux |
| écriture : relecture des lignes écrites | 220 à 290 ms (MERGE sur tout l'index des id) | ≈ 6 ms (plan relevé : deux recherches par rowid, `UNION ALL`) |
| écriture entière (transaction) | 300 à 330 ms | 35 à 60 ms |

## Ce qui reste : la file de la base au démarrage, hors du périmètre

La base n'a qu'une connexion dans le worker : les requêtes passent une à une, dans l'ordre d'arrivée. Pendant la première seconde, l'appli prépare aussi le plan de Planches (`prechargerPlan`, lancé par `App.tsx` dès la base ouverte ; la journée l'attend au plus 400 ms, T13c). Ses requêtes, à froid, tiennent la base :

- tap à 0 ms : les quatre premières requêtes du plan (zones, emplacements, cultures, saisons) finissent ≈ 300 ms après le tap ; la lecture ciblée passe ensuite, puis la requête des occupations du plan (≈ 330 à 440 ms à froid), arrivée entre deux requêtes de la lecture ciblée, passe devant la suivante ;
- tap à 200 ms : même requête des occupations (≈ 390 ms) glissée entre la 1re et la 2e requête de la lecture ciblée ;
- tap à 400 ms : la requête des occupations est en cours (≈ 280 ms encore), puis une page de séries de la relecture complète (≈ 100 ms), puis la lecture ciblée (≈ 180 ms) et l'écriture (≈ 60 ms).

Une saisie « Fait » sur l'instantané, c'est 8 requêtes de lecture ciblée puis une transaction d'écriture : chaque trou entre deux laisse passer une requête du plan. La relecture complète de la journée cède déjà sa place (T13t, pages T13u) ; le préchargement du plan, lui, ne sait pas céder, et il est hors du périmètre de T13u (`App.tsx`, `ecrans/plan/`).

Pistes (à trancher par le chef) :

1. le préchargement du plan cède à une saisie en cours (le compteur global `commencerEcriture` de `donnees/ecritures-en-cours.ts` existe déjà) entre ses requêtes, ou démarre après la première journée relue ;
2. lecture ciblée et écriture dans un seul verrou de la base (une transaction qui lit puis écrit) : plus aucun trou où une autre requête se glisse ; changement d'API de la porte (`packages/sync`), et les tests qui enveloppent `porte.lire` ne verraient plus ces lectures.

## Autres vérifications

- `aujourdhui-grande-ferme.e2e.ts` : vert. Relecture après « Fait » 228, 195, 268, 231, 294 ms (médiane 231) ; lancement à froid avec instantané, médiane 365 ms ; T13g, médiane 329 ms ; tap depuis Planches, médiane 18 ms.
- `aujourdhui.e2e.ts` : vert.
- Démarrage : 72 801 octets gzip pour une limite de 72 806 (71,1 Kio) : rien de nouveau au démarrage (le code touché est dans le morceau Aujourd'hui et dans `base-appli`).
- La relecture complète lit désormais toutes les séries de la base page par page (les terminées ne rendent que leur id) : ≈ 16 pages de 60 à 100 ms à froid sur la grande ferme, au lieu d'une requête de 750 à 860 ms ; elle cède à chaque page.
- `pnpm e2e` complet : 97 passés, 13 ignorés, 2 en échec : le nouvel e2e T13u (1 005, 759, 648, 467, 252 ms → médiane 648 ms) et `serie.e2e.ts` (« Nouvelle série », 1re répétition 468 ms pour un plafond de 450 ; médiane 120 ms). Relancé seul, `serie.e2e.ts` passe (359, 122, 143, 112, 89 ms) : écran hors du périmètre, aléa de la machine.

## Suite (2026-10-13) : la file de la base au démarrage, corrigée

Sonde provisoire (non commitée) : chaque requête de la porte horodatée, plus les tâches longues de la page, relevées autour du tap.

**Cause confirmée**, en deux parties :

1. Préchargement du plan coupé (expérience) : 817, 385, 492, 391, 531 ms, médiane 492 ms, maximum 817 ms. Le préchargement explique l'essentiel de l'écart, mais pas tout.
2. Dans la lecture ciblée, la requête des occupations (`SQL_OCCUPATIONS`, un `OR` entre séries et plantations) parcourait les ≈ 4 000 occupations de la ferme dans l'index ferme_culture : 110 à 150 ms à froid pour une seule série. Le plan des occupations du préchargement, lui, durait 0,55 à 0,75 s à froid d'une seule traite, et les emplacements 0,2 à 0,45 s : partis avant le tap, ils ne s'interrompent pas.

**Correctif** :

- `SQL_OCCUPATIONS` en deux branches `UNION ALL`, chacune cherchée dans l'index (ferme, série, plantation) ; une occupation n'a qu'un occupant (contrainte un_occupant) : 0,84 → 0,13 ms sur le banc, ≈ 15 ms à froid au lieu de 110 à 150 ;
- lecture ciblée : les lectures indépendantes partent ensemble (`Promise.all`) : moins d'allers-retours, rien ne se glisse entre elles ;
- préchargement du plan par une porte qui cède (`porteQuiCede`) : au plus 2 lectures parties à la fois, chacune attend qu'aucune écriture ne soit en cours (marqueur `data-saisie-en-cours` du compteur global, 2 s au plus) ; lu en petites requêtes (emplacements par pages de 150, occupations par lots de 4) ; l'écran Planches qui attend le début du plan le presse : plus d'attente, plus de découpe.

**Après** (`aujourdhui-premier-fait.e2e.ts`, du tap à la saisie dans l'historique, délais 0 / 200 / 400 / 600 / 800 ms) :

| Passage | 0 ms | 200 ms | 400 ms | 600 ms | 800 ms | Médiane |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (sonde active) | 668 | 322 | 416 | 333 | 457 | 416 |
| 2 | 638 | 280 | 570 | 354 | 330 | 354 |
| 3 | 575 | 252 | 438 | 333 | 398 | 398 |
| 4 (jeu e2e complet) | 684 | 273 | 377 | 317 | 565 | 377 |

Version intermédiaire (lectures du plan une à une) : médianes 347 à 406 ms, mais tap à 0 ms jusqu'à 770 ms (un passage rouge sur 3), et Planches ralenti (voir plus bas).

Avant : médianes 616 à 714 ms, maximum 1 143 ms. Après : médianes **354 à 416 ms**, maximum **684 ms** (plafond 750 ms), 4 passages verts sur 4. Le tap à 0 ms reste le plus lent : la première requête du plan est déjà partie, et la page a une tâche longue de démarrage (≈ 150 ms) au même moment.

**Planches** (`plan.e2e.ts`, premier affichage juste après l'ouverture de la base, ferme de T07) : avant 55 à 67 ms de médiane ; après 41, 145 et 207 ms de médiane, maximum 290 ms (budget 300). Une version où les lectures du plan passaient une à une montait à 241 à 303 ms : d'où deux lectures en vol et la pression de l'écran.

Démarrage : 72 801 octets gzip pour 72 806, inchangé (le plan lit le marqueur du DOM, il n'importe rien de `donnees/`).

Hors ticket, rouge aussi sur la base sans ce correctif (machine chargée) : défilement de `plan.e2e.ts` (5 passages saccadés sur 5 relevés avant le correctif).

# Mesure : premier « Fait » d'un lancement à froid, avant T13u

Mesure du 2026-10-11, avant toute correction, sur `main` (0e71fd1).

## Conditions

- Chromium headless (Playwright), profil Pixel 7, conteneur de développement, sans autre e2e en parallèle. **Ce n'est pas un vrai téléphone.**
- CPU ralenti ×4 sur le fil principal de la page (pas sur le worker de SQLite).
- Build des essais (`dist-essais`), grande ferme de T13b (3 000 séries actives, 1 000 terminées, ≈ 51 000 événements), hors ligne.
- Nouvel e2e `apps/web/e2e/aujourdhui-premier-fait.e2e.ts` : cinq lancements à froid avec instantané ; à chaque lancement, la page tape elle-même « Marquer fait » sur la première tâche 0, 200, 400, 600 puis 800 ms après l'ouverture de la base (`data-base="prete"`). Mesure : du tap à la saisie en tête de l'historique. Critère : médiane < 500 ms et maximum ≤ 750 ms (`jugerSerie`).
- Banc de profil : copie jetable de l'e2e (non commitée), marques `performance.mark` provisoires dans `calculs.ts` (`lireJournee`, `lireTacheCiblee`, une marque par requête), `cache.ts`, `EcranAujourdhui.tsx` et `packages/sync/src/porte.ts` (chaque lecture, chaque étape de l'écriture), plus `EXPLAIN QUERY PLAN` lu dans le navigateur.

## L'e2e : rouge

| Passage | 0 ms | 200 ms | 400 ms | 600 ms | 800 ms | Médiane |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | — | — | — | — | — | 1 648 (max 2 098) |
| 2 | 1 964 | 1 500 | 1 573 | 1 500 | 1 214 | 1 500 |

En ms, du tap à la saisie dans l'historique (colonne : délai du tap après l'ouverture de la base). Le premier passage n'a imprimé que le verdict (`médiane 1647.6 ms`, `plus haute valeur 2098 ms`). Échec pour la bonne raison : la saisie arrive, mais 2,5 à 4 fois trop tard.

## Où passe le temps (banc de profil, instants depuis le tap, en ms)

Tap 200 ms après l'ouverture de la base (relecture complète pas encore commencée) :

| Étape | Instant |
| --- | --- |
| lecture ciblée, requête 1 (la série par son id) | 16 → 759 |
| lecture ciblée, requête 2 (espèce), derrière une requête de Planches (occupations, 108 → 992) | 761 → 1 040 |
| lecture ciblée, requêtes 3 à 8 | 1 040 → 1 145 |
| écriture : vérification, ordres | 1 151 → 1 179 |
| écriture : relecture des lignes écrites (`sqlLignesEcrites`) | 1 179 → 1 414 |
| écriture : « déjà fait », fin de la transaction | 1 414 → 1 454 |
| saisie dans l'historique (provisoire, sur l'instantané) | ≈ 1 480 |

Tap 400 ms après l'ouverture (relecture complète commencée juste avant) : la requête 1 de la lecture ciblée attend la fin de la requête 1 de la relecture complète (les 3 000 séries, pages froides : **765 ms**), qui cède ensuite la place ; puis mêmes étapes.

Trois causes, toutes sous le fil de la base (le worker sert une requête à la fois) :

1. **La lecture ciblée lit la série par le mauvais index.** Plan relevé dans le navigateur : `SEARCH ps_data__serie USING INDEX ps_data__serie__ferme_statut` : pour une seule série, SQLite parcourt les 3 000 séries actives de la ferme (leurs `parametres` compris, ≈ 4,4 Mo), pages froides : 500 à 860 ms.
2. **La première requête de la relecture complète ne cède pas** : 3 000 séries en une requête, 750 à 860 ms à froid ; une requête SQLite ne s'interrompt pas, la lecture ciblée attend derrière.
3. **La relecture des lignes écrites coûte 220 à 290 ms à chaque écriture** (pas seulement la première) dans `packages/sync` (`sqlLignesEcrites`). Plan relevé dans le navigateur : `MERGE (UNION)` dont la partie gauche est `SCAN ps_data__evenement USING COVERING INDEX sqlite_autoindex_ps_data__evenement_1` : le SQLite du navigateur trie les deux sources par id pour l'`UNION` et parcourt tout l'index des 51 000 événements. Les mêmes lectures faites séparément (lignes de rowid au-delà, opérations de `ps_crud`, puis les lignes par id) prennent 2 + 2 + 2 ms. Le double de test sous Node choisit un autre plan (recherche par rowid) : ce coût ne se voit qu'au navigateur.

En plus : les requêtes de Planches lancées au démarrage passent dans la même file (≈ 230 ms pour les occupations).

## Ligne provisoire qui disparaît

Nouveau test unitaire `apps/web/src/ecrans/aujourdhui/ligne-provisoire.test.tsx` : la relecture complète est dans sa dernière requête (saisies récentes, lue avant l'écriture) quand « Fait » est tapé sur l'instantané. Rouge : la ligne provisoire disparaît à l'arrivée de cette journée relue sans la saisie (absences relevées : une mutation du DOM et deux tours), puis revient avec la relecture de la culture.

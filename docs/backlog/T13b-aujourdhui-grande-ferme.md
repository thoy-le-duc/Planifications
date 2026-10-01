# T13b — Aujourd'hui : rapide sur une grande ferme

**Objectif** : l'écran Aujourd'hui reste sous 300 ms, et se relit vite après une saisie, sur une ferme de 3 000 séries en cours.

**Dépend de** : T13
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`, le schéma local de `packages/sync` (index)

## Constat (relecture T13)

Mesure simulée (node:sqlite, index de `SCHEMA_LOCAL`) :

| Ferme | Lecture de la journée | Calcul |
| --- | --- | --- |
| 300 séries actives | 33 ms | 5 à 7 ms |
| 3 000 séries actives, 53 000 événements | 424 ms | 50 à 85 ms |

- Détail de la lecture sur la grande ferme :
  - `SQL_REALISES` : 211 ms (parcours complet du journal) ;
  - `SQL_RECENTS` : 85 ms (le `OR horodatage` empêche l'index).
- Sur un téléphone moyen, compter environ ×6 à ×8 : plusieurs secondes à froid, et à chaque relecture après une saisie ou une synchro.
- Le jeu T07 n'a aucun `mode` d'itinéraire, donc aucune tâche : il ne met pas le semainier à l'épreuve.

## Règles

- **Index locaux** sur `evenement(remplace_evenement_id)`, `evenement(serie_id)` et `mouvement_stock(recolte_id)`.
- **Requêtes allégées** (à mesurer avec la règle « en vigueur » de T10h, `CHAINES`, déjà en tête des requêtes) :
  - `SQL_RECENTS` découpée en deux requêtes indexées, réunies par UNION ;
  - `SQL_REALISES` restreinte aux séries actives par une jointure.
- **Robustesse (relecture T22b)** : un `detail` d'événement qui n'est pas du JSON fait lever `json_extract` et échouer toute la lecture de la journée. Filtrer par `json_valid(e.detail)` et tester avec une ligne corrompue. Lire `occurrenceVisee` avec `estDateValide` plutôt qu'une regex.
- **Un jeu d'essai avec des itinéraires valides** (3 000 séries actives, des milliers de tâches) et une mesure e2e de l'écran sur ce jeu.

## Hors périmètre (découpage du chef, 2026-10-01)

Le ticket d'origine mêlait la vitesse et plusieurs suites de relecture. Suivant la règle des tickets petits et bornés, ces points partent dans T13c : relecture incrémentale après une saisie, lancement sans attendre le préchargement de Planches, masque des tâches faites, focus après « Changer la date ». La question des deux annulations hors ligne d'une même récolte est déjà réglée : une annulation redondante est acceptée par le serveur (T10d, `verifierRemplacementRecolte`).

## Critères d'acceptation

- [x] Index locaux présents dans le schéma de `packages/sync`, et utilisés par les requêtes de la journée (plan de requête vérifié par un test).
- [x] Une ligne `evenement` au `detail` corrompu n'empêche pas la journée de s'afficher (test), et elle est ignorée.
- [x] Sur le grand jeu (node:sqlite, stockage PowerSync, 3 000 séries actives, ~50 000 événements) : lecture de la journée en moins de 250 ms (médiane de 5), mêmes résultats qu'avant l'allègement (empreintes figées).
- [x] Sur le grand jeu, e2e avec CPU ×4 : Aujourd'hui en moins de 300 ms au tap (médiane de 5). Le lancement à froid et la relecture après une saisie sont mesurés et notés dans la PR.
- [x] Isolement entre fermes : une saisie d'une autre ferme visant une culture de la ferme affichée est ignorée (test).

## Décisions (chef, 2026-10-01)

- Le budget d'origine (100 ms sous Node, 1 s à froid) n'est pas tenable par les requêtes seules : dans le navigateur, la première lecture des pages SQLite (vues JSON de PowerSync) coûte ×45 à ×100 le temps mesuré sous Node. La lecture passe de 854 ms à environ 120 ms ; 250 ms en est le garde-fou de régression. Le froid (8,8 s → 5,3 s) devient une mesure non bloquante ; le budget de 1 s part dans T13d.
- Une correction gagnante au `detail` corrompu : la chaîne n'a rien en vigueur (l'origine ne revient pas) ; une annulation corrompue annule toujours.

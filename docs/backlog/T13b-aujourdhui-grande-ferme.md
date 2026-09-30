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
- **Requêtes allégées** :
  - `SQL_RECENTS` découpée en deux requêtes indexées, réunies par UNION ;
  - `SQL_REALISES` restreinte aux séries actives par une jointure.
- **Relecture incrémentale** : après une saisie, ne recalculer que ce qui a changé.
- **Robustesse (relecture T22b)** : un `detail` d'événement qui n'est pas du JSON fait lever `json_extract` et échouer toute la lecture de la journée. Filtrer par `json_valid(e.detail)` et tester avec une ligne corrompue. Lire `occurrenceVisee` avec `estDateValide` plutôt qu'une regex.
- **Au lancement**, Aujourd'hui (écran d'accueil) ne doit plus attendre le préchargement de Planches.
- **Un jeu d'essai avec des itinéraires valides** (des milliers de tâches) et une mesure e2e de l'écran sur ce jeu.
- **Question de conflit** : deux téléphones qui annulent la même récolte hors ligne. Le second lot est refusé par le serveur (T10c). Accepter une annulation redondante sans mouvement ? À voir avec Q20.

- **Masque des tâches faites** (vérification T13) : le retirer dès qu'une journée relue arrive. Sinon, un réalisé annulé depuis un autre téléphone laisse « Fait » sans effet.
- **Focus après « Changer la date »** : le rendre à l'entrée corrigée ou au titre de l'historique, au lieu de le laisser tomber sur `body`.

## Critères d'acceptation

- [ ] Sur le grand jeu, CPU ×4 : Aujourd'hui en moins de 300 ms au tap et en moins de 1 s à froid, relecture après une saisie en moins de 500 ms.

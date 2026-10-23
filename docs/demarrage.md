# Démarrage d'une session de la boucle

Chaque session part de zéro : rien n'est gardé d'une session à l'autre, tout ce qui compte est dans le dépôt. Lis ce fichier, puis `CLAUDE.md`. Le détail est dans `docs/boucle.md`.

## Où trouver l'état

1. `docs/backlog/README.md` : **source de vérité** des statuts (« à faire », « en revue », « fait ») et de l'ordre de priorité.
2. Les 15 premières lignes de `docs/journal.md` : `head -15 docs/journal.md`.
3. Les questions ouvertes de `docs/questions.md` (sans « Réponse »).
4. Les PR ouvertes de la boucle (branches `ticket/…`, `boucle/…`). **Ne jamais toucher à la PR #75.**

## Règles de la session

- PR ouvertes d'abord (CI rouge, conflit, commentaire de Théophane), puis **3 tickets au plus**, dont **2 en parallèle au plus**, indépendants (ni dépendance ni fichier commun).
- **Pause du mardi 10 h au mercredi 10 h** (heure de Paris) : aucun nouveau ticket, on surveille et on fusionne seulement.
- **Budget** : avant tout nouveau ticket, la section « Budget » de `docs/boucle.md` (dernière jauge donnée par Théophane ; au-delà de 70 % avant mardi, aucun nouveau ticket).
- **Une seule session par ticket** : avant de prendre un ticket, `git fetch origin` et regarder les branches `ticket/<Txx>…`. Une branche **sans PR** dont le dernier commit date de **moins de 6 h**, ou qui pointe sur le même commit que `main`, appartient à une autre session en cours : prendre un autre ticket. Dès qu'il choisit un ticket, le chef pousse sa branche (`git push -u origin ticket/…`) avant de lancer les agents.
- **2 passages de relecture au plus** par ticket (relecture, puis contre-relecture des correctifs). Domaine critique : jusqu'à zéro faille.
- Backlog vide ou ticket flou : question dans `docs/questions.md` (branche + PR), puis arrêt.
- Une branche et une PR par ticket, jamais de push direct sur `main`, worktree dans `/home/user/wt-<ticket>`.

## Domaines critiques

Un ticket est **critique** s'il touche l'un de ces domaines (périmètre de fichiers ou critères du ticket) :

- **base** : `packages/db/` (schéma, migrations), requêtes SQL du serveur ;
- **synchro** : `packages/sync/`, `apps/api/src/sync/`, règles PowerSync (`powersync/`) ;
- **sécurité** : authentification, jetons, sessions, imports de fichiers, workflows GitHub avec secrets ;
- **isolement entre fermes** : tout filtre ou contrôle par ferme, côté serveur ou règles de synchro ;
- **stock et annulation** (décision du 2026-10-07).

En cas de doute, le ticket est critique. Le README du backlog indique « critique » dans la fiche du ticket quand c'est connu.

## Choix des agents (mécanique)

Le chef d'équipe (la session) orchestre et **ne code pas**. Chaque sous-agent est lancé avec son type, jamais sans modèle déclaré.

| Ticket | Tests | Code | Relecture |
| --- | --- | --- | --- |
| Normal | dans `developpeur` (commit de tests rouges séparé) | `developpeur` | `relecteur` |
| Critique | `testeur` | `developpeur-critique` | `relecteur-critique` |

CI rouge : le chef **n'appelle jamais `mcp__github__get_job_logs`** lui-même ; il lance `lecteur-ci` avec l'identifiant du run, qui renvoie un résumé de 20 lignes au plus.

## Fusion

`scripts/attendre-fusion.sh <branche> <numero_pr>` (en arrière-plan) : il vérifie que la PR est ouverte, vise `main` et a la bonne tête, attend le job « CI verte » et fusionne en « merge ». Puis vérifier la CI de `main`. Conditions complètes : `docs/boucle.md`, « Fusion ».

## Fin de session (obligatoire)

1. Statuts à jour dans `docs/backlog/README.md`.
2. Trois lignes par ticket en tête de `docs/journal.md` (fait, décidé, bloquant).
3. `docs/suivi/etat.json` à jour, page de suivi régénérée et republiée (`docs/boucle.md`, point 8).
4. Nettoyage : `git worktree remove` de chaque `/home/user/wt-*`.

## Échéances

- **1er novembre 2026 : le dépôt devient public.** Aucune valeur de jeton, de clé, de mot de passe ni de variable sensible dans un fichier, un commit, une PR ou un ticket : seulement leur nom et ce qu'il faut faire. Théophane saisit lui-même les secrets.

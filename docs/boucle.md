# La boucle autonome

Toutes les 5 heures, une session Claude Code démarre seule et travaille **en équipe** : un chef d'équipe répartit les tickets du backlog entre des agents testeur, développeur et relecteur, et ouvre une PR par ticket. Quand la CI est verte et que le relecteur n'a rien laissé de bloquant, la boucle fusionne elle-même la PR (décision de Théophane du 2026-09-29). Théophane relit après coup et répond aux questions. Les tests sont l'arbitre (voir `CLAUDE.md`, « Méthode de développement »).

## Où elle tourne

- **Sessions Claude Code on the web**, environnement cloud « Planification » : un conteneur isolé, recréé à chaque session et jeté ensuite.
- Aucun accès aux données ni aux secrets de production : il n'y en a pas dans cet environnement, et il ne faut jamais en ajouter.
- Au démarrage, le hook `.claude/hooks/session-start.sh` installe les dépendances et indique à Playwright le Chromium déjà présent.
- Déclenchement : une routine Claude Code toutes les 5 heures, qui crée une session neuve à chaque fois.

## Les branches

- `main` contient ce qui a été fusionné par PR. La boucle n'y pousse jamais directement : elle fusionne ses PR elle-même, uniquement par GitHub, quand les conditions de « Fusion » (plus bas) sont réunies.
- Une branche par ticket : `ticket/T01-types-et-dates`, etc.
- Un ticket dont une dépendance est encore en revue part de la branche de cette dépendance, et sa PR vise cette branche. Quand la dépendance est fusionnée, la boucle redirige la PR suivante vers `main` (la boucle ne peut pas supprimer de branche), intègre `main` dans sa branche si besoin, attend la CI verte, puis la fusionne à son tour.
- Un ticket sans dépendance en revue part de `main`.

## Ce que fait chaque session

1. Lire `CLAUDE.md`, `docs/backlog/README.md`, les dernières entrées de `docs/journal.md` et `docs/questions.md`.
2. **PR ouvertes d'abord** : CI rouge, conflit ou commentaire de Théophane sur une PR de la boucle → la corriger avant tout nouveau ticket.
3. **Choisir les tickets** : le premier « à faire » du tableau dont chaque dépendance est « fait » ou « en revue » avec une CI verte, et au plus un second ticket **indépendant** (aucune dépendance entre eux, aucun fichier en commun dans leurs périmètres). Aucun ticket éligible, ou ticket flou → écrire la question dans `docs/questions.md` et s'arrêter.
4. **Pour chaque ticket, l'équipe** (voir ci-dessous) : le testeur écrit les tests d'acceptation, le développeur fait passer `pnpm verif` en entier, le relecteur relit, le développeur corrige.
5. **Commits atomiques**, push, PR avec un résumé en français : ce qui est fait, ce qui a été décidé, ce que le relecteur a trouvé et comment c'est corrigé, comment vérifier. Jamais de test modifié pour passer sans le justifier dans la PR.
6. Statut du ticket passé à « fait » dans `docs/backlog/README.md` (« en revue » s'il ne peut pas être fusionné), trois lignes dans `docs/journal.md`, dans la PR elle-même.
7. **Fusion** : voir la section « Fusion ».
8. **Page de suivi** : en fin de session, le chef d'équipe régénère et republie la page de suivi de Théophane (https://claude.ai/artifact/GmRGZyPSajnNNHCobAgBpM), à partir de `docs/backlog/README.md`, `docs/questions.md` et `docs/journal.md`, avec des captures des écrans qui existent. Même lien à chaque fois.
9. Trois tickets au plus par session. Mieux vaut trois tickets nets que dix vagues.

## L'équipe

Dans chaque session, la session elle-même est le **chef d'équipe** ; les autres rôles sont des sous-agents qu'il lance, un jeu neuf par ticket.

| Rôle | Fait | Ne fait jamais |
| --- | --- | --- |
| Chef d'équipe | Choisit les tickets, lance les coéquipiers, tranche les désaccords, ouvre les PR, tient les statuts et le journal | Écrire le code d'un ticket |
| Testeur | Écrit les tests d'acceptation à partir des règles et des exemples chiffrés du ticket, vérifie qu'ils échouent, les commite | Écrire le code de production |
| Développeur | Écrit le code jusqu'à ce que les tests et `pnpm verif` passent, dans sa propre copie de travail (worktree git) | Modifier un test du testeur ; s'il le croit faux, il le signale au chef, qui tranche et le justifie dans la PR |
| Relecteur | Relit le diff contre le ticket, les sept principes et `CLAUDE.md` ; cherche les bugs, les cas oubliés, les nombres à virgule flottante, les `Date` avec fuseau ; renvoie une liste | Corriger lui-même |

Déroulé d'un ticket : testeur → développeur → relecteur → corrections du développeur → nouvelle relecture si le relecteur a trouvé un problème bloquant → PR.

**Parallélisme** : deux tickets indépendants au plus en même temps, chacun dans sa propre copie de travail et sur sa propre branche. Des tickets qui dépendent l'un de l'autre passent l'un après l'autre, sur des branches empilées. Plus d'agents en parallèle ne rendrait pas la boucle plus sûre : les conflits coûteraient plus que le temps gagné.

Un conflit sur `docs/journal.md` ou `docs/backlog/README.md` entre deux PR se résout à la session suivante, en gardant les deux entrées.

## Fusion

Décision de Théophane (2026-09-29) : la boucle fusionne seule. Une PR est fusionnée par le chef d'équipe, méthode « merge » (commit de fusion), quand **toutes** ces conditions sont réunies :

- la CI GitHub est verte sur le dernier commit de la PR ;
- le relecteur n'a laissé aucun point bloquant ouvert ;
- aucun commentaire de Théophane n'attend de réponse sur la PR ;
- la PR vise `main` (une PR empilée attend que sa dépendance soit fusionnée, puis est redirigée vers `main`).

Jamais de fusion avec une CI rouge ou en cours, jamais de push direct sur `main`, jamais de test désactivé pour passer. Une PR qui ne remplit pas ces conditions reste ouverte, en « en revue », et le journal dit pourquoi. Les conflits sur `docs/journal.md`, `docs/backlog/README.md` ou `docs/questions.md` se résolvent en gardant toutes les entrées. Après la fusion, vérifier que la CI de `main` reste verte ; sinon, la corriger avant tout nouveau ticket.

## Statuts des tickets

`à faire` → `en revue` (PR ouverte) → `fait` (fusionné dans `main`). `à préciser` : en attente d'une réponse de Théophane.

## Message de la routine

Texte envoyé à chaque session neuve :

```text
Tu es le chef d'équipe de la boucle autonome du projet Planifications (dépôt GitHub thoy-le-duc/Planifications).
Si le dépôt n'est pas dans ta session, attache-le et clone-le, puis place-toi sur la branche main à jour.
Lis docs/boucle.md et suis à la lettre « Ce que fait chaque session » et « L'équipe » :
PR ouvertes de la boucle d'abord ; puis au plus trois tickets du backlog, deux indépendants en parallèle au plus ;
pour chaque ticket, un sous-agent testeur écrit les tests d'abord, un sous-agent développeur fait passer pnpm verif
dans sa propre copie de travail sans toucher aux tests, un sous-agent relecteur relit avant la PR.
Une branche et une PR par ticket, jamais de push direct sur main ; fusionne toi-même la PR quand la CI est verte (voir « Fusion »). Écris en français.
Si aucun ticket n'est éligible ou qu'un ticket est flou, écris ta question dans docs/questions.md
(sur une branche et une PR) et arrête-toi. Termine en ajoutant trois lignes par ticket à docs/journal.md.
```

## Arrêter ou modifier la boucle

- Arrêter : demander à Claude de désactiver la routine, ou la désactiver dans la liste des routines de claude.ai.
- Changer la fréquence ou le message : même chemin, sans perdre l'historique des exécutions.

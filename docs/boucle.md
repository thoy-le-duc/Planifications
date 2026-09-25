# La boucle autonome

Toutes les 5 heures, une session Claude Code démarre seule et travaille **en équipe** : un chef d'équipe répartit les tickets du backlog entre des agents testeur, développeur et relecteur, et ouvre une PR par ticket. Théophane relit et fusionne le matin. Les tests sont l'arbitre (voir `CLAUDE.md`, « Méthode de développement »).

## Où elle tourne

- **Sessions Claude Code on the web**, environnement cloud « Planification » : un conteneur isolé, recréé à chaque session et jeté ensuite.
- Aucun accès aux données ni aux secrets de production : il n'y en a pas dans cet environnement, et il ne faut jamais en ajouter.
- Au démarrage, le hook `.claude/hooks/session-start.sh` installe les dépendances et indique à Playwright le Chromium déjà présent.
- **Une session dédiée à la boucle**, « Boucle Planifications (équipe) », créée avec le dépôt `thoy-le-duc/Planifications` attaché : les dépôts d'une session sont choisis à son démarrage, et une routine qui crée une session neuve à chaque fois n'a ni le code ni les outils GitHub (constaté au premier essai, le 2026-09-25).
- **Déclenchement** : une routine toutes les 5 heures réveille cette même session avec le message ci-dessous. Chaque fenêtre commence par se remettre à jour sur `main`.
- Capacités vérifiées le 2026-09-25 : dépôt à jour, push de branches, outils GitHub pour les PR, sous-agents et copies de travail, tests. La session ne peut pas supprimer une branche distante : c'est Théophane qui les supprime en fusionnant.

## Les branches

- `main` contient ce que Théophane a relu et fusionné. La boucle n'y pousse jamais et ne fusionne jamais ses propres PR.
- Une branche par ticket : `ticket/T01-types-et-dates`, etc.
- Un ticket dont une dépendance est encore en revue part de la branche de cette dépendance, et sa PR vise cette branche. Quand Théophane fusionne la dépendance et supprime sa branche, GitHub redirige automatiquement la PR suivante vers `main`.
- Un ticket sans dépendance en revue part de `main`.

## Ce que fait chaque session

1. Lire `CLAUDE.md`, `docs/backlog/README.md`, les dernières entrées de `docs/journal.md` et `docs/questions.md`.
2. **PR ouvertes d'abord** : CI rouge, conflit ou commentaire de Théophane sur une PR de la boucle → la corriger avant tout nouveau ticket.
3. **Choisir les tickets** : le premier « à faire » du tableau dont chaque dépendance est « fait » ou « en revue » avec une CI verte, et au plus un second ticket **indépendant** (aucune dépendance entre eux, aucun fichier en commun dans leurs périmètres). Aucun ticket éligible, ou ticket flou → écrire la question dans `docs/questions.md` et s'arrêter.
4. **Pour chaque ticket, l'équipe** (voir ci-dessous) : le testeur écrit les tests d'acceptation, le développeur fait passer `pnpm verif` en entier, le relecteur relit, le développeur corrige.
5. **Commits atomiques**, push, PR avec un résumé en français : ce qui est fait, ce qui a été décidé, ce que le relecteur a trouvé et comment c'est corrigé, comment vérifier. Jamais de test modifié pour passer sans le justifier dans la PR.
6. Statut du ticket passé à « en revue » dans `docs/backlog/README.md`, trois lignes dans `docs/journal.md`.
7. Trois tickets au plus par session. Mieux vaut trois tickets nets que dix vagues.

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

## Statuts des tickets

`à faire` → `en revue` (PR ouverte) → `fait` (fusionné dans `main`). `à préciser` : en attente d'une réponse de Théophane.

## Message de la routine

Texte envoyé à la session de la boucle à chaque réveil :

```text
Nouvelle fenêtre de travail de la boucle. Tu es le chef d'équipe de la boucle autonome du projet Planifications (dépôt thoy-le-duc/Planifications).
Commence par te mettre à jour : git fetch, puis place-toi sur la branche main à jour (les fenêtres précédentes ont pu laisser des branches et des PR ouvertes).
Relis docs/boucle.md (il a pu changer) et suis à la lettre « Ce que fait chaque session » et « L'équipe » :
PR ouvertes de la boucle d'abord ; puis au plus trois tickets du backlog, deux indépendants en parallèle au plus ;
pour chaque ticket, un sous-agent testeur écrit les tests d'abord, un sous-agent développeur fait passer pnpm verif
dans sa propre copie de travail sans toucher aux tests, un sous-agent relecteur relit avant la PR.
Une branche et une PR par ticket, jamais de push ni de fusion sur main. Écris en français.
Si aucun ticket n'est éligible ou qu'un ticket est flou, écris ta question dans docs/questions.md
(sur une branche et une PR) et arrête-toi. Termine en ajoutant trois lignes par ticket à docs/journal.md.
```

## Arrêter ou modifier la boucle

- Arrêter : demander à Claude de désactiver la routine, ou la désactiver dans la liste des routines de claude.ai.
- Changer la fréquence ou le message : même chemin, sans perdre l'historique des exécutions.

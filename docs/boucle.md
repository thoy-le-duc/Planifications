# La boucle autonome

Toutes les 5 heures, une session Claude Code démarre seule, prend les tickets du backlog un par un, et ouvre une PR par ticket. Théophane relit et fusionne le matin. Les tests sont l'arbitre (voir `CLAUDE.md`, « Méthode de développement »).

## Où elle tourne

- **Sessions Claude Code on the web**, environnement cloud « Planification » : un conteneur isolé, recréé à chaque session et jeté ensuite.
- Aucun accès aux données ni aux secrets de production : il n'y en a pas dans cet environnement, et il ne faut jamais en ajouter.
- Au démarrage, le hook `.claude/hooks/session-start.sh` installe les dépendances et indique à Playwright le Chromium déjà présent.
- Déclenchement : une routine Claude Code toutes les 5 heures, qui crée une session neuve à chaque fois.

## Les branches

- `main` contient ce que Théophane a relu et fusionné. La boucle n'y pousse jamais et ne fusionne jamais ses propres PR.
- Une branche par ticket : `ticket/T01-types-et-dates`, etc.
- Un ticket dont une dépendance est encore en revue part de la branche de cette dépendance, et sa PR vise cette branche. Quand Théophane fusionne la dépendance et supprime sa branche, GitHub redirige automatiquement la PR suivante vers `main`.
- Un ticket sans dépendance en revue part de `main`.

## Ce que fait chaque session

1. Lire `CLAUDE.md`, `docs/backlog/README.md`, les dernières entrées de `docs/journal.md` et `docs/questions.md`.
2. **PR ouvertes d'abord** : CI rouge, conflit ou commentaire de Théophane sur une PR de la boucle → la corriger avant tout nouveau ticket.
3. **Choisir le ticket** : le premier « à faire » du tableau dont chaque dépendance est « fait » ou « en revue » avec une CI verte. Aucun ticket éligible, ou ticket flou → écrire la question dans `docs/questions.md` et s'arrêter.
4. **Tests d'abord**, puis le code, jusqu'à ce que `pnpm verif` passe en entier.
5. **Commits atomiques**, push, PR avec un résumé en français : ce qui est fait, ce qui a été décidé, comment vérifier. Jamais de test modifié pour passer sans le justifier dans la PR.
6. Statut du ticket passé à « en revue » dans `docs/backlog/README.md`, trois lignes dans `docs/journal.md`.
7. Trois tickets au plus par session. Mieux vaut trois tickets nets que dix vagues.

Un conflit sur `docs/journal.md` ou `docs/backlog/README.md` entre deux PR se résout à la session suivante, en gardant les deux entrées.

## Statuts des tickets

`à faire` → `en revue` (PR ouverte) → `fait` (fusionné dans `main`). `à préciser` : en attente d'une réponse de Théophane.

## Message de la routine

Texte envoyé à chaque session neuve :

```text
Tu es la boucle autonome du projet Planifications (dépôt GitHub thoy-le-duc/Planifications).
Si le dépôt n'est pas dans ta session, attache-le et clone-le, puis place-toi sur la branche main à jour.
Lis docs/boucle.md et suis sa procédure « Ce que fait chaque session » à la lettre :
PR ouvertes de la boucle d'abord, puis au plus trois tickets du backlog, tests d'abord,
pnpm verif vert avant chaque push, une branche et une PR par ticket, jamais de push ni de fusion sur main.
Écris en français. Si le backlog n'a aucun ticket éligible ou qu'un ticket est flou,
écris ta question dans docs/questions.md (sur une branche et une PR) et arrête-toi.
Termine en ajoutant tes trois lignes à docs/journal.md.
```

## Arrêter ou modifier la boucle

- Arrêter : demander à Claude de désactiver la routine, ou la désactiver dans la liste des routines de claude.ai.
- Changer la fréquence ou le message : même chemin, sans perdre l'historique des exécutions.

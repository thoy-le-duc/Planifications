# La boucle autonome

Deux fois par jour (7 h 17 et 17 h 17, heure de Paris), une session Claude Code **neuve** démarre seule et travaille **en équipe** : un chef d'équipe répartit les tickets du backlog entre des agents testeur, développeur et relecteur, et ouvre une PR par ticket. Quand la CI est verte et que le relecteur n'a rien laissé de bloquant, la boucle fusionne elle-même la PR (décision de Théophane du 2026-09-29). Théophane relit après coup et répond aux questions. Les tests sont l'arbitre (voir `CLAUDE.md`, « Méthode de développement »).

## Où elle tourne

- **Point d'entrée** : `docs/demarrage.md`, lu en premier par chaque session. Il prime sur ce fichier pour l'état, les règles de session, les domaines critiques et le choix des agents.

- **Sessions Claude Code on the web**, environnement cloud « Planification » : un conteneur isolé, recréé à chaque session et jeté ensuite. Chaque exécution de la routine ouvre une session neuve, sans mémoire de la précédente : elle attache et clone le dépôt, puis tout l'état se lit dans le dépôt (voir `docs/demarrage.md`).
- Aucun accès aux données ni aux secrets de production : il n'y en a pas dans cet environnement, et il ne faut jamais en ajouter.
- Au démarrage, le hook `.claude/hooks/session-start.sh` installe les dépendances et indique à Playwright le Chromium déjà présent.
- Déclenchement : une routine Claude Code deux fois par jour (7 h 17 et 17 h 17, heure de Paris), voir « Budget ».

## Les branches

- `main` contient ce qui a été fusionné par PR. La boucle n'y pousse jamais directement : elle fusionne ses PR elle-même, uniquement par GitHub, quand les conditions de « Fusion » (plus bas) sont réunies.
- Une branche par ticket : `ticket/T01-types-et-dates`, etc.
- Un ticket dont une dépendance est encore en revue part de la branche de cette dépendance, et sa PR vise cette branche. Quand la dépendance est fusionnée, la boucle redirige la PR suivante vers `main` (la boucle ne peut pas supprimer de branche), intègre `main` dans sa branche si besoin, attend la CI verte, puis la fusionne à son tour.
- Un ticket sans dépendance en revue part de `main`.

## Ce que fait chaque session

1. Lire `docs/demarrage.md`, puis `CLAUDE.md`, `docs/backlog/README.md`, les 15 premières lignes de `docs/journal.md` et les questions ouvertes de `docs/questions.md`.
2. **PR ouvertes d'abord** : CI rouge, conflit ou commentaire de Théophane sur une PR de la boucle → la corriger avant tout nouveau ticket.
3. **Choisir les tickets** : le premier « à faire » du tableau dont chaque dépendance est « fait » ou « en revue » avec une CI verte, et au plus un second ticket **indépendant** (aucune dépendance entre eux, aucun fichier en commun dans leurs périmètres). Aucun ticket éligible, ou ticket flou → écrire la question dans `docs/questions.md` et s'arrêter.
4. **Pour chaque ticket, l'équipe** (voir ci-dessous) : les tests d'acceptation d'abord (commit de tests rouges), le développeur fait passer `pnpm verif` en entier, le relecteur relit, le développeur corrige.
5. **Commits atomiques**, push, PR avec un résumé en français : ce qui est fait, ce qui a été décidé, ce que le relecteur a trouvé et comment c'est corrigé, comment vérifier. Jamais de test modifié pour passer sans le justifier dans la PR.
6. Statut du ticket passé à « fait » dans `docs/backlog/README.md` (« en revue » s'il ne peut pas être fusionné), trois lignes dans `docs/journal.md`, dans la PR elle-même.
7. **Fusion** : voir la section « Fusion ».
8. **Page de suivi** : en fin de session, le chef d'équipe met à jour `docs/suivi/etat.json` (résumé, tickets en cours, visuels ; captures d'écran rangées dans `docs/suivi/`), lance `python3 docs/suivi/generer.py <sortie.html>` et republie la sortie sur la page de suivi de Théophane (https://claude.ai/artifact/GmRGZyPSajnNNHCobAgBpM). Même lien à chaque fois. `etat.json` part avec la PR de fin de session.
9. Trois tickets au plus par session. Mieux vaut trois tickets nets que dix vagues.
10. **Fin de session** : les obligations de `docs/demarrage.md` (README du backlog, journal, page de suivi, nettoyage des `/home/user/wt-*`).

## L'équipe

Dans chaque session, la session elle-même est le **chef d'équipe** ; les autres rôles sont des sous-agents qu'il lance, un jeu neuf par ticket. Les sous-agents sont définis dans `.claude/agents/` avec leur modèle : `developpeur`, `relecteur` (Sonnet) pour un ticket normal ; `testeur` (Sonnet), `developpeur-critique`, `relecteur-critique` (Opus) pour un ticket critique ; `lecteur-ci` (Haiku) pour lire une CI rouge. Le choix est mécanique : voir « Domaines critiques » et « Choix des agents » dans `docs/demarrage.md`.

| Rôle | Fait | Ne fait jamais |
| --- | --- | --- |
| Chef d'équipe | Choisit les tickets, lance les coéquipiers, tranche les désaccords, ouvre les PR, tient les statuts et le journal | Écrire le code d'un ticket |
| Testeur | Ticket critique : agent `testeur` séparé. Ticket normal : le `developpeur` lui-même, en premier commit. Écrit les tests d'acceptation à partir des règles et des exemples chiffrés du ticket, vérifie qu'ils échouent, les commite à part | Écrire le code de production dans le même commit |
| Développeur | Écrit le code jusqu'à ce que les tests et `pnpm verif` passent, dans sa propre copie de travail (worktree git) ; rapport de 20 lignes au plus | Modifier un test déjà commité ; s'il le croit faux, il le signale au chef, qui tranche et le justifie dans la PR |
| Relecteur | Relit le diff contre le ticket, les sept principes et `CLAUDE.md` ; cherche les bugs, les cas oubliés, les nombres à virgule flottante, les `Date` avec fuseau ; renvoie une liste de 15 lignes au plus | Corriger lui-même |
| Lecteur de CI | Lit les journaux d'un run rouge (`get_job_logs` avec `failed_only`, `run_id`, `tail_lines`) et les résume en 20 lignes au plus | Corriger ; le chef d'équipe n'appelle jamais `get_job_logs` lui-même |

Déroulé d'un ticket : tests rouges → développeur → relecteur → corrections du développeur → nouvelle relecture si le relecteur a trouvé un problème bloquant → PR.

**Sobriété** (décision de Théophane, 2026-10-01) : économiser les jetons sans rogner sur ce qui garde `main` vert.

- **Deux passages de relecture au plus par ticket** : une relecture, puis une contre-relecture des correctifs. Ce que le second passage trouve encore se corrige dans la même PR, avant la fusion (voir « Fusion ») ; seul un vrai hors-périmètre part dans un ticket de suite. Stock, sécurité, isolement entre fermes : on continue jusqu'à zéro faille.
- **Suivi des PR léger** : le chef vérifie la CI par un point de contrôle programmé plutôt qu'en s'abonnant à chaque événement de la PR.
- **Tickets petits et bornés** : un ticket = une règle ou un écran ; les cas limites qu'on découvre **hors du périmètre** deviennent des tickets de suite plutôt que d'agrandir le ticket en cours, et les petites demandes d'une même zone sont regroupées en un seul ticket (voir « Fusion »).
- **Jeux e2e** : lancer `pnpm e2e` ou `pnpm e2e:demo` tels quels ; ne jamais les envelopper dans `scripts/verrou-e2e.sh` (ils prennent déjà le verrou).
- **On ne coupe jamais** : les tests écrits d'abord, la relecture, `pnpm verif` avant la PR.
- **Choix des modèles** (décision de Théophane, 2026-10-07, rendue mécanique le 2026-10-21) : chaque rôle a son modèle déclaré dans `.claude/agents/` ; aucun sous-agent sans modèle explicite. Les tests restent l'arbitre, quel que soit le modèle.

**Parallélisme** : deux tickets indépendants au plus en même temps, chacun dans sa propre copie de travail et sur sa propre branche. Des tickets qui dépendent l'un de l'autre passent l'un après l'autre, sur des branches empilées. Plus d'agents en parallèle ne rendrait pas la boucle plus sûre : les conflits coûteraient plus que le temps gagné.

Un conflit sur `docs/journal.md` ou `docs/backlog/README.md` entre deux PR se résout à la session suivante, en gardant les deux entrées.

## Fusion

**Remarques de relecture** (décision de Théophane, 2026-10-19, « on a perdu en efficacité ») : elles se corrigent **dans la PR du ticket, avant la fusion**, pas dans un ticket de suite ; seul un vrai hors-périmètre (autre écran, autre règle, autre fichier que ceux du ticket) devient un ticket. Les petites demandes d'une même zone (même écran, même module) sont **regroupées en un seul ticket** plutôt qu'un ticket chacune.

Décision de Théophane (2026-09-29) : la boucle fusionne seule. Une PR est fusionnée par le chef d'équipe, méthode « merge » (commit de fusion), quand **toutes** ces conditions sont réunies :

- la CI GitHub est verte sur le dernier commit de la PR : le job **« CI verte »** du workflow « CI », qui dépend de tous les jobs de vérification lancés en parallèle (T45), a conclu `success` ;
- le relecteur n'a laissé aucun point bloquant ouvert ;
- aucun commentaire de Théophane n'attend de réponse sur la PR ;
- la PR vise `main` (une PR empilée attend que sa dépendance soit fusionnée, puis est redirigée vers `main`).

Jamais de fusion avec une CI rouge ou en cours, jamais de push direct sur `main`, jamais de test désactivé pour passer. Une PR qui ne remplit pas ces conditions reste ouverte, en « en revue », et le journal dit pourquoi. Les conflits sur `docs/journal.md`, `docs/backlog/README.md` ou `docs/questions.md` se résolvent en gardant toutes les entrées. Après la fusion, vérifier que la CI de `main` reste verte ; sinon, la corriger avant tout nouveau ticket. Si la PR apporte une migration (`packages/db/migrations/`), vérifier ensuite que le workflow **Migrations de production** (T44), lancé seul après la CI verte de `main`, est vert lui aussi ; rouge, le noter au journal et dans `docs/questions.md` avant tout nouveau ticket qui touche la base. Vert avec « secret DATABASE_URL_PRODUCTION absent » : rien n'a été appliqué, le rappeler à Théophane (étape 2 bis de `docs/mise-en-ligne.md`). La boucle n'a jamais la valeur du secret et ne relance jamais `migrer` sur la production elle-même.

## Budget

Décision de Théophane (2026-10-05) : chaque semaine, la boucle laisse **au moins 15 % de sa limite d'utilisation Claude** pour qu'il finisse la semaine tranquillement. La semaine de la limite va du **mercredi 10 h au mercredi 10 h (heure de Paris)**. La boucle ne voit pas la jauge : elle tient un budget en tickets, à ajuster quand Théophane donne le pourcentage.

- **Pas de plafond en nombre de tickets** (décision de Théophane du 2026-10-09, travail de nuit autorisé) : la jauge seule fait foi. Repère mesuré : 25 tickets ≈ 34 % de la limite (vendredi 9 octobre 12 h 40), soit environ 1,2 % par ticket avec la répartition des modèles ci-dessus. Au-delà de **30 tickets depuis la dernière valeur de jauge connue**, demander la jauge à Théophane avant d'en lancer d'autres. Compter : `git log origin/main --merges --since=<mercredi 10 h> --grep "ticket/"` et les PR `ticket/…` encore ouvertes.
- **Aucun nouveau ticket du mardi 10 h au mercredi 10 h** : les sessions de ce créneau surveillent et fusionnent seulement les PR déjà ouvertes.
- **Jauge donnée par Théophane** : elle prime sur le compte de tickets. Si elle dépasse 70 % avant mardi, plus de nouveau ticket jusqu'au mercredi 10 h. Dernière valeur connue : **70 % le mercredi 21 octobre 2026 vers 9 h 30** (30 % de marge, fin de la semaine du mercredi 14 octobre 10 h ; nouvelle semaine dès mercredi 21 octobre 10 h). Précédente : 20 % le lundi 19 octobre 2026. Repère précédent : 34 % le vendredi 9 octobre 2026 à 12 h 40 (25 tickets faits depuis le mercredi 7 octobre à 10 h).
- **Économies systématiques** : agents Sonnet pour les tickets normaux (voir « L'équipe ») ; une session sans ticket s'arrête après la surveillance des PR, sans relancer d'agent.
- **Fréquence** : la routine tourne deux fois par jour (7 h 17 et 17 h 17, heure de Paris), chaque fois dans une session neuve.

## Statuts des tickets

`à faire` → `en revue` (PR ouverte) → `fait` (fusionné dans `main`). `à préciser` : en attente d'une réponse de Théophane.

## Message de la routine

Texte envoyé à chaque session neuve :

```text
Tu es le chef d'équipe de la boucle autonome du projet Planifications (dépôt GitHub thoy-le-duc/Planifications).
Commence par attacher le dépôt thoy-le-duc/Planifications à ta session (accès en écriture) et le cloner,
puis place-toi sur la branche main à jour.
Lis docs/demarrage.md et suis-le à la lettre. Écris en français.
```

## Arrêter ou modifier la boucle

- Arrêter : demander à Claude de désactiver la routine, ou la désactiver dans la liste des routines de claude.ai.
- Changer la fréquence ou le message : même chemin, sans perdre l'historique des exécutions.

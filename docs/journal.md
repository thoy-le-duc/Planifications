# Journal

Trois lignes par ticket terminé : fait, décidé, bloquant. Le plus récent en haut.

## 2026-09-29 — Boucle : fusion automatique

- **Fait** : `docs/boucle.md` et le message de la routine mis à jour : la boucle fusionne elle-même ses PR quand la CI est verte et que la relecture n'a rien laissé de bloquant.
- **Décidé** : fusion par GitHub uniquement (méthode « merge »), jamais de push direct sur `main` ; les PR empilées sont redirigées vers `main` puis fusionnées à leur tour.
- **Bloquant** : aucun.

## 2026-09-29 — Réponses de Théophane et fusion de T01 à T07

- **Fait** : T01 à T07 fusionnés dans `main` sur accord de Théophane ; réponses consignées pour Q8 (300 ms courant, 500 ms au lancement à froid), Q10 (événement + détail), Q11 (étape antérieure comptée comme faite) et Q12 (une ligne en retard par série).
- **Décidé** : T08 redevient « à faire » ; nouveau ticket T06b pour la règle des retards du semainier.
- **Bloquant** : aucun ; la prochaine fenêtre peut prendre T06b et T08 en parallèle.

## 2026-09-26 — T04 : alertes de rotation

- **Fait** : `alertesRotation` : délais de l'espèce sinon de la famille, historique des occupations de la planche et des planches qu'elle remplace, assolement passé sur la planche, sa chapelle et ses zones ; alerte rouge ou orange qui cite chaque ligne en cause ; tableau du ticket juste ; 58 tests.
- **Décidé** : au-delà du ticket, les zones des planches remplacées comptent aussi (même sol : mieux vaut une alerte en trop qu'une manquée) ; une série peut s'exclure elle-même du calcul ; année d'un assolement = année de fin de sa saison.
- **Bloquant** : aucun ; T08 (schéma Postgres) reporté tant que les écarts de modèle de T01 (#1) ne sont pas validés.

## 2026-09-25 — T03 : occupations et conflits de place

- **Fait** : occupations d'une série (réel prioritaire, pépinière exclue), d'une plantation pérenne (sans fin tant qu'elle n'est pas arrachée) et d'une couverture ; `detecterConflits` par balayage du temps : chevauchement, surcharge, dépassement de l'emplacement, emplacement inactif, période invalide ; exemple du ticket juste ; 3 000 occupations en 5 à 11 ms.
- **Décidé** : intervalles semi-ouverts (arracher et replanter le même jour ne fait pas de conflit) ; longueurs comparées en centimètres entiers ; une donnée incohérente donne un conflit visible plutôt qu'une erreur qui ferait planter l'écran.
- **Bloquant** : aucun ; la période d'une occupation doit toujours se lire par `periodeOccupation` (T04, T06, T11).
## 2026-09-25 — T06 : semainier

- **Fait** : `semainier(semaine, series, campagnes, realises, dateDuJour)` : semis, plantation, début de récolte, arrachage et campagnes de pérennes, dates recalées par les réalisés, tâches en retard avec leurs jours de retard, ordre stable ; exemples du ticket justes ; 3 000 séries en 4 ms.
- **Décidé** : une étape antérieure non saisie compte comme faite dès qu'une étape postérieure est réalisée (provisoire) ; l'arrachage passe avant le semis sur la même planche le même jour ; un réalisé incohérent est ignoré au lieu de faire planter l'écran.
- **Bloquant** : aucun ; deux questions dans la PR : la règle provisoire, et faut-il limiter les tâches en retard (une ligne par série) ?

## 2026-09-25 — T02 : dates d'une série, rebours et décalage

- **Fait** : `calculerDatesSerie` (ancre sur le semis, la mise en place ou le début de récolte), `appliquerRealises` (la suite glisse de l'écart du dernier réalisé), `calculerDatesCampagne` pour les pérennes (années sans récolte, semaines ISO, semaine 53 ramenée à 52) ; 52 tests dont une propriété sur 500 cas.
- **Décidé** : un seul type de dates prévues, semis pépinière absent plutôt que `null` (T01 corrigé dans la PR #1) ; une plantation faite pendant la période de récolte saute la campagne de l'année.
- **Bloquant** : aucun ; une question pour T06 dans la PR (un semis non saisi avant une plantation réalisée compte-t-il comme fait ?).
## 2026-09-25 — T05 : besoins en semences et en plants

- **Fait** : `besoinsSerie` pour les trois façons de compter (écartement, mètre linéaire, volée) et les trois modes (semis direct, plant maison, plant acheté), `besoinsSaison` par variété et semaine ISO avec plaques par format ; calcul entièrement en entiers (bigint), les sept cas du ticket justes ; 50 tests.
- **Décidé** : entrée du calcul en unités entières (cm, %, mg) ; la conversion depuis les types de T01 (grammes, mètres) se fera dans T12 ; plaques additionnées série par série, car on ne partage pas une plaque entre deux semis.
- **Bloquant** : aucun ; à trancher plus tard : les types de T01 en grammes et mètres, une série sans variété, un plafond de marge.

## 2026-09-25 — T01 : types du domaine et dates calendaires

- **Fait** : dates `AAAA-MM-JJ` calculées en jours absolus entiers, sans objet `Date` (semaines ISO, écarts, ajouts, analyse sans exception), vérifiées sous quatre fuseaux ; les 21 entités du modèle v1 typées avec unions discriminées ; identifiants UUID v7 monotones à horloge et aléa injectés ; 163 tests.
- **Décidé** : événements en ajout seul (correction ou annulation par un nouvel événement) ; récolte, intervention et traitement rangés dans le détail de l'événement plutôt qu'en tables séparées ; sept petits écarts au modèle listés dans la PR.
- **Bloquant** : aucun ; les écarts au modèle attendent l'avis de Théophane dans la PR.
## 2026-09-25 — T07 : mesure SQLite PowerSync sur téléphone simulé

- **Fait** : générateur déterministe d'une ferme (400 planches, 3 000 séries, 30 000 événements) et page de mesure hors navigation ; ouverture + vue 2D (CPU ×4) : 340 à 420 ms en tables JSON, 240 à 320 ms en tables brutes, 426 ms quand SQLite est lui aussi ralenti ; rapport dans `docs/mesures/sqlite.md`.
- **Décidé** : tables brutes recommandées ; le ralentissement ×4 de Chrome n'atteint pas le worker SQLite, donc les chiffres sont un minimum ; rien de SQLite n'entre dans le démarrage ni dans le précache.
- **Bloquant** : budget de 300 ms non tenu au premier écran après un lancement à froid ; question Q8 posée à Théophane, T07 « à préciser » et T10 en attente.
## 2026-09-26 — Boucle : plus de ticket éligible

- **Fait** : aucune PR n'a de retour ni de CI rouge ; question Q10 posée pour débloquer T08 (schéma Postgres).
- **Décidé** : T08 passe « à préciser » : il dépend du choix de modèle de T01 (événement + détail ou tables séparées), sinon tout le schéma risque d'être refait.
- **Bloquant** : relecture des 7 PR ouvertes (la #1 d'abord) et réponses à Q8, Q10 et aux questions des PR #2 et #6.

## 2026-09-25 — Phase 0 terminée : lancement de la boucle en équipe

- **Fait** : organisation en équipe dans `docs/boucle.md` (chef d'équipe, testeur, développeur, relecteur) ; branche `main` créée à partir de l'état validé ; routine toutes les 5 heures.
- **Décidé** : rôles séparés pour que les tests restent l'arbitre ; deux tickets indépendants en parallèle au plus, chacun dans sa copie de travail.
- **Bloquant** : Q8 (méthode de connexion) avant T09 ; Théophane doit choisir `main` comme branche par défaut dans les réglages GitHub.

## 2026-09-25 — Phase 0 : environnement de la boucle

- **Fait** : hook de démarrage des sessions web (dépendances, Chromium), validé depuis zéro avec lint et test ; procédure de la boucle et message de la routine dans `docs/boucle.md`.
- **Décidé** : la boucle tourne dans des sessions Claude Code on the web neuves (environnement « Planification », isolé, sans secret) ; une branche et une PR par ticket, empilées quand une dépendance est encore en revue.
- **Bloquant** : feu vert de Théophane pour créer `main` et programmer la routine toutes les 5 heures.

## 2026-09-25 — Phase 0 : besoins en semences adaptables

- **Fait** : T05 étendu à trois façons de compter la densité, mottes à plusieurs plants, perte en pépinière et plaques, avec sept cas chiffrés ; itinéraire du modèle complété.
- **Décidé** : Q7 validée dans le principe seulement ; plutôt que figer une formule, l'itinéraire choisit sa façon de compter.
- **Bloquant** : Q8 (connexion) avant T09 ; lancement de la boucle (branche `main`, routine toutes les 5 heures) à valider.

## 2026-09-25 — Phase 0 : import générique

- **Fait** : T14 réécrit en import de n'importe quel tableur (correspondance des colonnes et des valeurs, modèle d'import réutilisable, six formes de fichiers en test).
- **Décidé** : l'appli s'adapte au tableur de chaque ferme ; la proposition de correspondance par IA viendra en phase 2 ; T14 ne dépend plus des fichiers des Jardins de Garonne.
- **Bloquant** : Q7 (formules de semences) avant T05 ; Q8 (connexion) avant T09.

## 2026-09-25 — Phase 0 : backlog de la phase 1

- **Fait** : PowerSync validé (Q5) ; 15 tickets dans `docs/backlog/` (moteur T01–T06, mesure SQLite T07, serveur et synchro T08–T10, écrans T11–T13, import et export T14–T15), avec exemples chiffrés vérifiés.
- **Décidé** : dates en chaînes `AAAA-MM-JJ` sans fuseau ; quantités en entiers jusqu'à l'arrondi ; arracher et replanter le même jour n'est pas un conflit ; T07 en priorité car c'est le plus gros risque sur le budget de 300 ms.
- **Bloquant** : T09 (méthode de connexion) et T14 (fichiers réels) à préciser ; environnement isolé de la boucle et branche `main` à mettre en place.

## 2026-09-25 — Phase 0 : recommandation du moteur de synchro

- **Fait** : comparaison de PowerSync, Electric, d'une synchro maison et de neuf autres options, dans `docs/choix-synchro.md`, sources ouvertes ; affirmations clés revérifiées (rachat d'Electric, file d'écritures et licence PowerSync).
- **Décidé** : recommandation PowerSync auto-hébergé en UE, derrière `packages/sync` ; les écritures passent par notre API qui rejoue `packages/core`.
- **Bloquant** : validation du choix par Théophane (Q5) avant de créer `packages/db` et `packages/sync`.

## 2026-09-25 — Phase 0 : squelette du monorepo et CI

- **Fait** : monorepo pnpm (`packages/core`, `apps/web`, `apps/api`, `apps/mcp`), TypeScript 6.0 strict, ESLint strict sans `any`, Vitest, PWA hors ligne, CI GitHub Actions avec budgets de poids (90 Kio gzip) et de temps (réouverture hors ligne < 300 ms, CPU ralenti ×4).
- **Décidé** : Node exécute le TypeScript directement (pas de compilation pour l'API et le MCP) ; TypeScript 6.0 et non 7.0, car typescript-eslint ne gère pas encore la 7 ; `packages/db` attend le choix du moteur de synchro.
- **Bloquant** : aucun ; le dépôt n'a pas encore de branche `main`.

## 2026-09-25 — Phase 0 : modèle corrigé (chapelles, assolement enregistré)

- **Fait** : sous-zones (chapelles), table d'assolement multi-niveaux et pluriannuelle, délais de retour minimal et conseillé, lien de remplacement entre emplacements.
- **Décidé** : l'assolement passé se saisit ou s'importe sans recréer de séries, pour que les alertes de rotation marchent dès le premier jour.
- **Bloquant** : validation finale du modèle (Q4 bis) ; comparaison des moteurs de synchro lancée en parallèle.

## 2026-09-25 — Phase 0 : modèle de données v1 proposé

- **Fait** : questions Q1 à Q3 posées et validées (découpage, série, saisies au champ) ; modèle v1 rédigé dans `docs/modele-donnees.md` avec deux schémas.
- **Décidé** : occupations datées comme ligne de temps des planches ; série et plantation/campagne séparées ; propositions IA dans une file d'attente avant toute écriture ; stock = somme de mouvements ; événements en ajout seul.
- **Bloquant** : validation du modèle par Théophane (Q4) avant le choix du moteur de synchro.

## 2026-09-25 — Phase 0 : brief copié dans le dépôt

- **Fait** : brief copié dans `CLAUDE.md` (esprit, principes, méthode) et `docs/brief.md` (le reste) ; dossiers `docs/backlog/` et `docs/questions.md` créés.
- **Décidé** : les questions sur le modèle de données sont posées une par une ; les réponses sont consignées dans `docs/questions.md`.
- **Bloquant** : le modèle de données attend les réponses de Théophane sur le parcellaire, les séries et la saisie au champ.

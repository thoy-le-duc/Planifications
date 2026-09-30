# T22 — Itinéraires : les travaux prévus (cœur)

**Objectif** : un itinéraire ne donne plus seulement des durées et une densité. Il porte aussi les travaux de la culture : travail du sol, couverture, fertilisation, entretien. Chaque série en hérite, et ils apparaissent tout seuls dans l'écran Aujourd'hui. Chaque ferme peut ainsi décrire sa propre façon de cultiver.

**Dépend de** : T02, T06, T13
**Périmètre** : `packages/core/**` (types, calcul, semainier), `packages/db` (schéma, migration), `docs/modele-donnees.md`, et (décision du chef) `apps/web/src/ecrans/aujourdhui/**` (afficher les travaux, « Fait » écrit l'intervention)

## Règles (décisions de Théophane, 2026-09-30)

- **Un travail prévu** d'itinéraire comporte :
  - un type d'intervention, choisi parmi les types de la ferme (travail du sol, couverture, fertilisation, entretien…) ;
  - un **repère** (semis en pépinière, mise en place, début de récolte ou fin de récolte) et un **décalage en jours** : « grelinette 10 jours avant la mise en place » vaut repère `mise_en_place`, décalage −10 ;
  - facultatif : l'outil, et le produit avec sa quantité pour un amendement ;
  - facultatif : un **temps de travail estimé**, en minutes par 100 m ou par planche.
- **Répétition** : un travail peut se répéter tous les N jours entre deux repères (« désherbage tous les 14 jours de la mise en place au début de récolte »). Le cœur calcule toutes les dates, sans dépasser le repère de fin.
- **Travail du sol** : il fait partie de l'itinéraire de la culture. La tâche tombe sur les planches de la série.
- **L'instantané de la série** (déjà en place) comprend les travaux prévus : modifier l'itinéraire ne change jamais une série passée. La mise à jour des séries à venir est proposée par T24.
- **Semainier** : les travaux prévus deviennent des tâches, comme les semis et les plantations. Ils sont en retard s'ils ne sont pas faits, et le temps estimé apparaît. Un réalisé les solde : un événement « intervention » du même type, sur la même série.
- **Charge de la semaine** : la somme des temps estimés des tâches de la semaine, par exemple « 6 h de travail cette semaine ».

## Exemples chiffrés à tester

- **Batavia de T02**, mise en place le 2027-05-03 :
  - grelinette à −10 → 2027-04-23 ;
  - faux semis à −7 → 2027-04-26 ;
  - désherbage tous les 14 jours de la mise en place au début de récolte (2027-05-31) → 05-17 et 05-31. La date du repère de fin est comprise ; à trancher par le testeur et à justifier.
- **Temps estimé** : 20 min par 100 m pour une série de 30 m → 6 min.

## Décisions du chef (2026-09-30, après les tests)

- **Choix du testeur retenus**, justifiés dans le contrat :
  - la batavia de T02 a 49 jours avant récolte ; l'exemple à 28 jours s'appelle « batavia d'été » ;
  - le repère de fin est compris ;
  - un travail tombe à repère + décalage, et la répétition ajoute des occurrences ;
  - un repère absent pour le mode est refusé à l'écriture et ignoré au calcul ;
  - une intervention solde l'occurrence la plus proche et les précédentes ;
  - une seule ligne en retard par travail prévu ;
  - le temps estimé est arrondi à la minute, et la charge de la semaine compte les retards.
- **Travail rendu caduc par son repère** : un travail prévu *avant* un repère (décalage négatif) qui n'a pas été saisi disparaît dès que l'étape repère est réalisée. Exemple : la grelinette à −10 disparaît une fois la mise en place faite. Il ne reste pas en retard tout l'été. À confirmer par Théophane (Q23).
- **Écran Aujourd'hui dans le périmètre** : les travaux prévus s'y affichent (catégorie, libellé, temps estimé, retard). « Fait » écrit un événement « intervention » du même type sur la série (une transaction, `validerSaisie`), annulable comme T13. La charge de la semaine s'affiche en pastille.
- **Liste des types d'intervention de la ferme** : elle n'existe pas en base. T22 utilise des libellés libres ; la table et son écran vont dans T23 et T24.

## Critères d'acceptation

- [ ] Types et fonctions pures du cœur, avec un test par règle et des exemples chiffrés.
- [ ] Le semainier de T06 inclut les travaux prévus, en retard compris, et le temps estimé.
- [ ] Migration : les travaux prévus sont rangés dans l'itinéraire (jsonb validé) et copiés dans l'instantané de la série.

**Hors périmètre** : les écrans (T24) et l'écriture serveur (T23).

### Décision du chef (2e passe des tests)

- En fertilisation et amendement, le **produit est obligatoire** dans un travail prévu (et non plus facultatif) : sans lui, l'intervention écrite par « Marquer fait » serait refusée par `validerSaisie`, qui exige produit et quantité.
- La tâche de travail porte `travail.indice` (position dans `travauxPrevus`), clé stable à l'écran.

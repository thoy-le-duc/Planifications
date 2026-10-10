# Backlog

Un fichier par ticket. La boucle prend **le premier ticket « à faire » dont chaque dépendance est « fait » ou « en revue » avec une CI verte**, dans l'ordre du tableau (procédure complète dans `docs/boucle.md`). Un ticket « à préciser » attend une réponse de Théophane : ne pas le prendre, voir `docs/questions.md`.

Statuts : `à faire` → `en revue` (PR ouverte) → `fait` (fusionné dans `main`) ; `à préciser`.

## Phase 1 — Noyau

Critère de sortie : Théophane utilise l'appli chaque jour sur sa ferme pendant un mois complet.

| Ticket | Sujet | Dépend de | Statut |
| --- | --- | --- | --- |
| [T01](T01-types-et-dates.md) | Types du domaine et dates calendaires | — | fait |
| [T02](T02-dates-serie.md) | Dates d'une série, planification à rebours et décalage | T01 | fait |
| [T03](T03-occupations-conflits.md) | Occupations et conflits de place | T02 | fait |
| [T04](T04-rotation.md) | Alertes de rotation | T03 | fait |
| [T04b](T04b-rotation-hors-sol.md) | Pas d'alerte de rotation sur le hors-sol (Q17) | T04 | fait |
| [T05](T05-besoins-semences.md) | Besoins en semences et en plants | T01 | fait |
| [T06](T06-semainier.md) | Semainier | T02 | fait |
| [T06b](T06b-retards-semainier.md) | Semainier : une seule ligne en retard par série | T06 | fait |
| [T07](T07-mesure-sqlite.md) | Mesure : SQLite PowerSync sur téléphone simulé | — | fait |
| [T08](T08-schema-postgres.md) | Schéma PostgreSQL et migrations | T01 | fait |
| [T09](T09-comptes-jetons.md) | Comptes, fermes et jetons | T08 | fait |
| [T09b](T09b-durcissement-connexion.md) | Connexion : durcissement avant la mise en production | T09 | fait |
| [T09c](T09c-envoi-brevo.md) | Envoi des codes de connexion par Brevo (Q14) | T09b | fait |
| [T10](T10-synchro.md) | Synchro de bout en bout | T07, T08, T09 | fait |
| [T10b](T10b-regles-saisies-coeur.md) | Règles des saisies dans le cœur | T10 | fait |
| [T10c](T10c-stock-synchro.md) | Synchro : le serveur accepte les saisies de stock des téléphones | T10, T10b | fait |
| [T10d](T10d-stock-suites.md) | Stock synchronisé : suites des relectures | T10c | fait |
| [T10f](T10f-synchro-debit.md) | Synchro : débit, délais et envois trop lourds | T10d | fait |
| [T10i](T10i-refus-affiches.md) | Les refus de synchro s'affichent sur le téléphone | T10, T10f | fait |
| [T10j](T10j-refus-suites.md) | Refus : messages sans jargon | T10i | fait |
| [T10k](T10k-refus-saisie.md) | Refus : la saisie refusée reconnaissable | T10j | fait |
| [T10l](T10l-refus-archives.md) | Refus : archiver un refus vu | T10i | fait |
| [T10n](T10n-refus-desarchiver.md) | Refus : annuler un archivage | T10l | fait |
| [T10o](T10o-refus-archives-e2e.md) | Refus : archivage vérifié entre deux téléphones | T10l | fait |
| [T10m](T10m-journal-serveur.md) | Journal du serveur : la même règle partout | T10j | fait |
| [T10p](T10p-journal-flux.md) | Journal du serveur : erreurs d’envoi en flux | T10m | fait |
| [T10q](T10q-flux-suites.md) | Réponses en flux : HTTP/1.0 et erreur au premier octet | T10p | fait |
| [T10r](T10r-flux-delai.md) | Réponses en flux : délai jusqu’au premier morceau | T10q | fait |
| [T10s](T10s-parcellaire-serveur.md) | Serveur : accepter le parcellaire et le catalogue de la ferme | T10r | fait |
| [T10t](T10t-structure-suites.md) | Parcellaire et catalogue : suites de la relecture | T10s | fait |
| [T10u](T10u-refus-ferme-quittee.md) | Refus d'une ferme quittée effacés du téléphone | T10k | fait |
| [T10v](T10v-resume-refus-hors-ferme.md) | Refus : pas de nom de culture d'une autre ferme dans le résumé | T10u, T10k | fait |
| [T10g](T10g-recoltes-annulees.md) | Récoltes annulées et plafonds définitifs (Q20, Q13) | T10d | fait |
| [T10h](T10h-en-vigueur-suites.md) | « En vigueur » : performance de la vue et alignement du téléphone | T10g | fait |
| [T10e](T10e-series-synchro.md) | Synchro : le serveur accepte les séries des téléphones | T10, T10b, T10c | fait |
| [T16](T16-design.md) | Identité visuelle : système de design et habillage | T09b | fait |
| [T16b](T16b-brancher-export.md) | Brancher l'export dans l'onglet Ferme | T11 | fait |
| [T18](T18-mode-sombre.md) | Mode sombre | T16 | fait |
| [T11](T11-vue-2d.md) | Vue 2D planches × semaines (et base locale ouverte dans l'appli) | T03, T10, T16 | fait |
| [T12](T12-plan-de-culture.md) | Plan de culture : créer et modifier une série | T04, T05, T10e, T11 | fait |
| [T12b](T12b-serie-suites.md) | Formulaire de série : sélecteur de semaine maison et suites de relecture | T12 | fait |
| [T22](T22-travaux-itineraire.md) | Itinéraires : les travaux prévus (cœur) | T02, T06, T13 | fait |
| [T22b](T22b-fait-en-retard.md) | « Fait » sur un travail répété en retard (Q24) | T22 | fait |
| [T23](T23-itineraires-synchro.md) | Synchro : le serveur accepte les itinéraires et les types d'intervention | T10e, T22 | fait |
| [T24](T24-ecran-itineraires.md) | Écran : mes itinéraires et mes types d'intervention | T22, T23 | fait |
| [T24b](T24b-annuler-serie-supprimee.md) | « Annuler » des itinéraires : série supprimée ailleurs | T24 | fait |
| [T24c](T24c-annuler-types-suites.md) | « Annuler » des itinéraires : types d'intervention et course lecture/écriture | T24b | fait |
| [T24d](T24d-annuler-bloque-message.md) | « Annuler » bloqué en silence : prévenir le maraîcher | T24c | fait |
| [T13](T13-saisie-terrain.md) | Saisie terrain hors ligne : réalisé et récolte | T06, T10, T10c, T11, T16 | fait |
| [T13b](T13b-aujourdhui-grande-ferme.md) | Aujourd'hui : rapide sur une grande ferme | T13 | fait |
| [T13c](T13c-aujourdhui-suites.md) | Aujourd'hui : suites de la relecture (relecture incrémentale, lancement, masque, focus) | T13b | fait |
| [T13e](T13e-fait-double.md) | « Fait » en double sur une relecture tardive | T13c | fait |
| [T13f](T13f-fait-double-suites.md) | « Fait » en double : changement d'onglet et relecture partielle | T13e | fait |
| [T13h](T13h-fait-unique-en-base.md) | « Fait » unique vérifié au moment d'écrire | T13f | fait |
| [T13i](T13i-fait-unique-partage.md) | « Fait » unique : partagé avec la voix et l'agent | T13h | fait |
| [T13j](T13j-fait-unique-chemins.md) | « Fait » unique : tous les chemins d'écriture | T13i | fait |
| [T13o](T13o-fait-unique-ps-crud.md) | « Fait » unique : contrôle d'après le journal d'envoi | T13j | fait |
| [T13d](T13d-aujourdhui-froid.md) | Aujourd'hui : ouverture à froid sous 1 s sur une grande ferme (instantané de la journée) | T13b, T13c | fait |
| [T13g](T13g-aujourdhui-avant-base.md) | Aujourd'hui : instantané avant la base, « Fait » en file au lancement | T13d | fait |
| [T13k](T13k-fait-avant-base.md) | Aujourd'hui : « Fait » accepté avant la base | T13g | fait |
| [T13l](T13l-gestes-pendant-file.md) | Aujourd'hui : « Annuler » et gestes pendant la file des « Fait » | T13g | fait |
| [T13m](T13m-chaine-unique.md) | Une seule règle « chaîne d'une saisie » | T13l, T13j | fait |
| [T13n](T13n-horodatages.md) | Horodatages comparés comme des dates | T13l | fait |
| [T14](T14-import-csv.md) | Import de n'importe quel tableur : moteur (cœur) | T10 | fait |
| [T14b](T14b-import-ecrans.md) | Import : le parcours à l'écran | T14, T16, T10s | fait |
| [T14e](T14e-import-series.md) | Import : suites (variétés, saisons, grandes fermes) | T14b | fait |
| [T14c](T14c-import-suites.md) | Import : suites de la relecture | T14 | fait |
| [T14d](T14d-import-annee-suivante.md) | Import : saison à cheval sur deux années (Q18) | T14 | fait |
| [T15](T15-export.md) | Export complet JSON + CSV | T10 | fait |
| [T15b](T15b-export-leger.md) | Export : archive compressée, légère en mémoire et sans formules | T15 | fait |
| [T15c](T15c-export-rapide.md) | Export : sous 10 secondes sur un téléphone moyen | T16b | fait |
| [T15d](T15d-export-tache-longue.md) | Export : jamais de tâche longue sur le fil principal | T15c | fait |
| [T15e](T15e-export-arriere-plan.md) | Export : continue en arrière-plan quand on change d'onglet | T15c | fait |
| [T25](T25-demo-en-ligne.md) | Démo en ligne (Vercel) | — | fait |
| [T25b](T25b-demo-finitions.md) | Démo : pas de déconnexion ni d’état de synchro | T25 | fait |
| [T26](T26-e2e-synchro-robuste.md) | Synchro de bout en bout : un banc qui ne tombe plus tout seul | — | fait |

T07 n'a pas de dépendance et porte le plus gros risque technique (le budget de 300 ms avec la base) : la boucle peut le prendre dès le début, en parallèle du moteur.

## Format d'un ticket

- **Objectif** : ce que Théophane gagne, en une ou deux phrases.
- **Dépend de** et **Périmètre** : les fichiers que le ticket a le droit de toucher. Sortir du périmètre se justifie dans la PR.
- **Règles métier** : les calculs exacts, avec des exemples chiffrés. Ce sont les tests d'acceptation.
- **Critères d'acceptation** : cases à cocher vérifiables, toutes couvertes par un test automatique.
- **Hors périmètre** : ce qu'il ne faut pas faire dans ce ticket.

## Règles communes à tous les tickets

- `pnpm verif` passe en entier (typage, lint, tests, build, budgets).
- Dates calendaires en chaînes `AAAA-MM-JJ` et calculs en jours entiers : jamais d'objet `Date` avec fuseau local dans `packages/core`.
- Quantités calculées en nombres entiers quand un arrondi est en jeu ; pas de flottant avant l'arrondi final.
- Textes de l'interface en français ; noms de code en français comme dans le modèle (`serie`, `emplacement`, `occupation`).
- Fin de ticket : trois lignes dans `docs/journal.md` et le statut mis à jour dans ce tableau.
| [T19](T19-tests-de-temps.md) | Tests de temps robustes sous charge | — | fait |
| [T20](T20-main-verte.md) | Main verte : service worker après le premier affichage, mesures e2e stables | T11 | fait |
| [T11c](T11c-diagnostic-hors-prod.md) | Pages de test hors du site en production | T11, T10c | fait |
| [T11d](T11d-defilement-plan-fiable.md) | Mesure du défilement du plan : fiable sans relever la limite | T11, T20 | fait |
| [T11b](T11b-plan-suites.md) | Planches : suites de la relecture | T11 | à faire |
| [T27](T27-vue-3d-prototype.md) | Vue 3D : prototype mesurable (planches et cultures, curseur de semaine) | T11 | fait |
| [T27b](T27b-vue-3d-filtres.md) | Vue 3D : filtres et couleurs lisibles (Q30) | T27 | fait |
| [T28a](T28a-placement-modele.md) | Placement réel : modèle, calcul et base, zones en formes libres (Q30, Q31) | — | fait |
| [T29](T29-vol-camera.md) | Vue 3D : la caméra vole vers une serre ou une zone (Q30) | T27b | fait |
| [T29b](T29b-fluidite-vols.md) | Vue 3D : fluidité des vols robuste | T29, T28c | fait |
| [T29c](T29c-cout-du-vol.md) | Vue 3D : coût propre au vol de caméra | T29b | fait (constat) |
| [T28s](T28s-placement-serveur.md) | Placement réel : le serveur accepte, la porte écrit | T28a | fait |
| [T28c](T28c-jumeau-3d.md) | Jumeau 3D : la ferme à sa vraie place, serres en tunnels | T27b, T28a | fait |
| [T28b](T28b-editeur-placement.md) | Éditeur de placement sur photo aérienne IGN : bâtiments et planches (ordinateur) | T28s | fait |
| [T28d](T28d-contours-zones.md) | Éditeur de placement : contours de zones en formes libres (Q31) | T28b | fait |
| [T28e](T28e-editeur-suites.md) | Éditeur de placement : suites de relecture (clavier, zoom, messages, tuiles) | T28b, T28d | fait |
| [T31](T31-tests-temps-fiables.md) | Tests de temps fiables sous charge (helper commun, médiane de ≥ 5, CPU) | — | fait |
| [T28f](T28f-trouver-editeur.md) | Plan de la ferme : trouver et ouvrir l'éditeur depuis la 3D, démo comprise (Q32) | T28b, T28e | fait |
| [T32a](T32a-croissance-profils.md) | Croissance des cultures : profils et calcul (moteur) (Q32) | T02, T03 | fait |
| [T32b](T32b-plants-stylises-3d.md) | Jumeau 3D : plants stylisés qui grandissent (Q32) | T32a, T28c, T29b | fait |
| [T32c](T32c-reglage-profils.md) | Profils de croissance : réglage par la ferme (écran) (Q32) | T32a, T32b | fait |
| [T32g](T32g-personnaliser-espece.md) | « Personnaliser » une espèce de la bibliothèque pour régler sa croissance (Q39) | T32c | fait |
| [T33](T33-verrou-e2e.md) | Un seul jeu e2e à la fois sur la machine (verrou flock) | — | fait |
| [T14f](T14f-import-codes-par-zone.md) | Import : codes de planche comparés par zone | T10t | fait |
| [T28g](T28g-focus-editeur.md) | Éditeur : rendre le focus à la fermeture (relecture T28f) | T28f | fait |
| [T28h](T28h-adresse-recul-sites.md) | Éditeur de placement : chercher une adresse, voir large, plusieurs sites (Q35) | T28b, T28e, T28g | fait |
| [T28j](T28j-parcours-guide-placement.md) | Placement : un parcours guidé en étapes (Q36) | T28h | fait |
| [T34](T34-duree-vol-fiable.md) | Durée des vols de caméra mesurée de façon fiable (marge déduite du plancher) | T29b, T33 | fait |
| [T33b](T33b-verrou-reentrant.md) | Verrou e2e réentrant (un appel imbriqué ne s'attend plus lui-même) | T33 | fait |
| [T32d](T32d-plants-plus-fins.md) | Jumeau 3D : jeunes plants visibles, plants découpés (Q34) | T32b | fait |
| [T36](T36-allegement-vue-3d.md) | Alléger la vue 3D : ne plus charger tout le cœur (relecture T35a) | T32d, T35a | fait |
| [T32e](T32e-recolte-visible.md) | Jumeau 3D : la récolte se voit (fruits, à récolter, fin de récolte) (Q34) | T32d, T36 | fait |
| [T32f](T32f-recolte-suites.md) | Récolte visible : récoltes courtes, pérennes d'hiver, balise en fin de récolte (relecture T32e, Q38) | T32e | fait |
| [T32h](T32h-especes-sans-itineraire.md) | Toutes les espèces de la ferme dans l'écran Itinéraires (Q40) | T32c | à faire |
| [T32i](T32i-perennes-repousse.md) | Pérennes : repousse en douceur avant la récolte (Q41) | T32f | fait |
| [T32j](T32j-perennes-tournant-annee.md) | Pérennes : repousse continue au tournant de l'année (relecture T32i) | T32i | à faire |
| [T35a](T35a-schema-rangs.md) | Itinéraire : rangs alignés ou en quinconce, et leur schéma (Q34) | — | fait |
| [T35b](T35b-quinconce-3d.md) | Jumeau 3D : plants posés selon la disposition des rangs (Q34) | T35a, T32d | à faire |
| [T14g](T14g-sous-zones-homonymes.md) | Import : sous-zones homonymes sous deux zones différentes (relecture T14f) | T14f | fait |
| [T28i](T28i-demo-placement.md) | Démo : essayer le placement d'une serre sur une vraie photo (Q36) | T28h | fait |
| [T28k](T28k-placement-au-doigt.md) | Placement au doigt sur le téléphone (Q36) | T28j | fait |
| [T37](T37-travaux-du-jour-3d.md) | 3D au téléphone : les travaux du jour, pour les ouvriers (Q36) | T29, T22, T13 | fait |
| [T37b](T37b-3d-telephone-suites.md) | 3D au téléphone : fluidité de près, filtres, suites de T37 | T37 | à faire |
| [T38a](T38a-api-sur-vercel.md) | Mise en ligne gratuite : l'API sur Vercel (Q37) | T09c, T10 | fait |
| [T38b](T38b-guide-mise-en-ligne.md) | Guide de mise en ligne pas à pas, pour Théophane (Q37) | T38a | fait |
| [T13q](T13q-horodatages-suites.md) | Horodatages : les derniers endroits qui comparent du texte (relecture T13n) | T13n | à faire |
| [T13r](T13r-morceau-identifiants.md) | L'éditeur de placement ne charge plus la règle « déjà fait » (relecture T13n) | T13n | fait |

Vue 3D et jumeau numérique (Q30, priorité de la semaine du 2026-10-07) : T27b et T28a d'abord, en parallèle (fichiers disjoints) ; puis T29 et T28s ; puis T28c et T28b ; puis T28d.

Suite du jumeau (Q32, 2026-10-08) : T28f et T32a en parallèle (fichiers disjoints), puis T32b. T32c ensuite (stockage validé : champ `profil_croissance` sur l'espèce).

# Journal

Trois lignes par ticket terminé : fait, décidé, bloquant. Le plus récent en haut.

## 2026-09-30 — T10g : récoltes annulées, correction la plus récente, stock tenu par le serveur

- **Fait** :
  - Une récolte annulée ne se corrige plus : le serveur refuse avec « saisissez une nouvelle récolte » (Q20), et elle disparaît de l'historique du téléphone.
  - Entre deux corrections hors ligne, la plus récente (heure du téléphone) gagne partout : serveur, vue en base et téléphone.
  - Le serveur calcule et écrit lui-même l'écart de stock de chaque correction ou annulation, même sans mouvement du téléphone. Le stock suit toujours la quantité en vigueur.
  - Plafonds de saisie définitifs (Q13).
- **Décidé** :
  - Une correction plus ancienne que celle en vigueur est refusée.
  - Un écart nul est accepté sans écriture.
  - Le mouvement créé par le serveur a un identifiant déterministe. S'il a été réservé d'avance par un autre mouvement, le lot est refusé.
  - Trois relectures ont fermé trois failles de stock : correction sans mouvement, écart nul, id réservé.
- **Bloquant** : rien. Suites dans T10h : la vue « en vigueur » est lente sur un gros journal (4 s sur 200 000 saisies), et la règle du semainier reste à aligner, avant tout export lu côté serveur.

## 2026-09-30 — T23 : le serveur accepte les itinéraires et les types d'intervention

- **Fait** :
  - Nouvelle table des types d'intervention de la ferme, avec une liste de départ commune de 20 types. Elle descend sur les téléphones et part dans l'export complet.
  - Les itinéraires et les types créés ou modifiés au téléphone, même hors ligne, arrivent au serveur. Un lot est accepté ou refusé en entier, avec les séries. Le serveur écrit l'historique.
  - Scénario vérifié à deux téléphones.
- **Décidé** :
  - La bibliothèque commune est en lecture seule : on la duplique pour l'adapter.
  - Un type utilisé se masque, ne se supprime pas et ne se renomme pas.
  - Les noms de type sont nettoyés (espaces de bord, accents unifiés, caractères invisibles refusés) et uniques sans tenir compte des majuscules.
  - L'espèce d'un itinéraire est figée.
  - Supprimer un itinéraire utilisé est permis : la série garde sa copie.
- **Bloquant** : rien. À retenir pour la mise en ligne : la base de production doit être créée en locale UTF-8, sinon l'unicité sans majuscules ne vaut que pour l'ASCII.

## 2026-09-30 — T22b : « Fait » sur un travail en retard solde la bonne occurrence

- **Fait** : « Marquer fait » sur une carte de travail écrit la date de cette carte (`occurrenceVisee`) dans l'intervention. Elle solde cette occurrence et les précédentes, jamais la suivante (Q24). Le désherbage du 31 reste à faire quand on rattrape celui du 17.
- **Décidé** : champ facultatif, permis seulement sur une intervention. Les anciennes saisies gardent la règle de T22 (occurrence la plus proche). Aucune migration.
- **Bloquant** : rien. Noté pour T13b : un détail d'événement qui n'est pas du JSON fait échouer toute la lecture d'Aujourd'hui (défaut antérieur).

## 2026-09-30 — T12 : planifier une série depuis le plan

- **Fait** :
  - Un appui long sur une case vide du plan, ou le bouton « Nouvelle série », ouvre le formulaire, prérempli avec la planche et la semaine.
  - Culture, itinéraire proposé selon la saison, ancre (semis, plantation ou récolte), planches et longueurs. Dates, besoins, conflits et rotation se recalculent en direct par le moteur, en 1 ms.
  - L'alerte de rotation rouge demande une confirmation.
  - « Annuler » est possible 10 s, puis depuis l'historique.
  - La batavia se planifie en 6 gestes, et le formulaire s'affiche en 111 ms hors ligne (CPU ×4).
- **Décidé** :
  - « Fermer » plutôt que « Annuler » sur le formulaire.
  - Annuler une entrée ancienne de l'historique défait aussi les plus récentes, après avertissement.
  - Une entrée d'historique illisible ne s'annule pas.
  - Planches seulement pour l'instant, sans gouttières.
- **Bloquant** : rien. Suites dans T12b : sélecteur de semaine sur iPhone, décision de rotation périmée, bandeau face à un autre téléphone.
## 2026-09-30 — T22 : les travaux prévus des itinéraires

- **Fait** :
  - Le cœur calcule les travaux prévus d'un itinéraire : travail du sol, amendement, désherbage, palissage… Chacun est placé à X jours d'une étape repère.
  - Un travail peut se répéter (tous les N jours jusqu'à un repère) et porter un temps estimé facultatif.
  - Les travaux s'affichent dans Aujourd'hui, mêlés aux étapes. « Marquer fait » écrit une intervention en un geste, annulable 10 s, et une pastille montre la charge de la semaine (« 1 h 24 de travail »).
- **Décidé** :
  - Un travail prévu avant son repère, jamais saisi, disparaît dès que le repère est fait (Q23, par défaut).
  - Le produit est obligatoire en fertilisation et en amendement.
  - Plafonds : 12 travaux par itinéraire (instantané de 8 Kio, revérifié après normalisation) et 1 000 dates par travail.
  - La table des types d'intervention part dans T23.
- **Bloquant** : rien. À trancher : Q23 (confirmer), Q24 (« Fait » sur un travail en retard).

## 2026-09-30 — T10e : le serveur accepte les séries des téléphones

- **Fait** : une série et ses occupations, créées, modifiées, supprimées ou rétablies au téléphone, même hors ligne, arrivent au serveur.
  - Le serveur recalcule lui-même les dates, et une série est acceptée ou refusée avec ses occupations.
  - Il écrit l'historique (avant et après exacts).
  - Il garde la décision prise sur une alerte de rotation rouge (`rotation_acceptee`).
  - Plafonds : 10 000 m et 1 000 000 de plants (Q21).
- **Décidé** :
  - la variété et l'itinéraire doivent être de l'espèce de la série ;
  - une série ne peut pas être créée déjà supprimée ;
  - une mise en place hors saison ou une longueur plus grande que la planche restent acceptées : ce sont des alertes affichées, pas des refus ;
  - les occupations de plantation pérenne ne se modifient pas depuis le téléphone, tant que les pérennes n'ont pas leur ticket.
- **Bloquant** : aucun. La relecture de sécurité a trouvé un bloquant, corrigé : un PATCH pouvait transformer l'occupation d'une plantation en occupation de série. T12 (le plan de culture) est débloqué.

## 2026-09-30 — T10d : suites de la sécurité du stock

- **Fait** :
  - une correction de récolte garde la série et l'unité d'origine ;
  - le serveur ne laisse plus deviner qu'une ligne d'une autre ferme existe, ni par ses réponses ni par ses délais ;
  - un envoi trop gros ne bloque plus la file et ne peut plus remplir la base de refus (limites dures : 2 000 écritures, 8 Mio) ;
  - les quantités de stock sont gardées avec 6 décimales exactes (migration 0012).
- **Décidé** :
  - pour corriger une récolte saisie sur la mauvaise série ou dans la mauvaise unité, on l'annule puis on la ressaisit ;
  - reprendre l'identifiant d'une ligne d'une autre ferme reste détectable, ce qui est une limite structurelle acceptée ;
  - la correction antidatée attend Q20.
- **Bloquant** : aucun. Deux relectures de sécurité, dont un bloquant trouvé et corrigé : l'amplification des refus. Suites dans T10f : débit, délais, poids des transactions.

## 2026-09-30 — T11c : pages de test hors du site en production

- **Fait** : le site mis en ligne (`pnpm build`) ne contient plus que l'appli. La page de diagnostic de synchro, qui écrivait dans une vraie ferme, la page d'amorçage (42 000 lignes chez le visiteur) et la page de mesure n'existent plus que dans le build des essais (`dist-essais/`), qui sert aux tests e2e. Le démarrage passe de 70,7 à 70,2 Kio, puisque le code de test n'est plus embarqué.
- **Décidé** :
  - le build de production n'accepte qu'une seule page, l'appli : toute autre page fait échouer le build ;
  - le build des essais recopie l'appli à l'identique (vérifié octet pour octet, `sw.js` compris), puis ajoute les pages de test à côté ;
  - il reconstruit toujours la production d'abord et ne peut jamais écraser `dist/`.
- **Bloquant** : aucun. Le jour où l'on mettra en ligne : publier `apps/web/dist` seulement.

## 2026-09-30 — T13 : saisie au champ, hors ligne

- **Fait** : l'écran Aujourd'hui, écran d'accueil de l'appli :
  - le semainier, avec les tâches en retard d'abord ;
  - « Fait » en un geste ;
  - la récolte en trois gestes (culture, pavé numérique géant avec virgule, unité préremplie) ;
  - « Annuler » pendant 10 s, puis depuis l'historique ;
  - des cibles de 56 px ou plus.
  Chaque saisie s'écrit en une seule transaction avec son mouvement de stock, et le vrai serveur les accepte toutes, en ligne comme hors ligne (vérifié par la relecture).
- **Décidé** :
  - le pavé a une touche virgule (deux décimales), à la place du micro de la maquette ;
  - une saisie dont la culture est retirée ne se corrige plus depuis le téléphone ;
  - le jour est relu à chaque saisie, pour ne plus écrire la date de la veille ;
  - l'historique est toujours visible, limité à 20 saisies ;
  - « SEMAINE 40 » a quitté l'en-tête pour tenir le budget de démarrage (70,8 Kio sur 71).
- **Bloquant** : aucun. Le budget de démarrage est presque plein. La grande ferme reste lente : ticket T13b.

## 2026-09-30 — T16b : export branché dans l'onglet Ferme

- **Fait** : « Exporter toute ma ferme » lance vraiment l'export, hors ligne compris, avec une barre d'avancement et « Annuler ». L'écran ne se fige plus (plus longue tâche : 0 ms, contre 0,2 s avant) grâce à une lecture par pages et une compression dans un worker. Se déconnecter en plein export arrête l'export avant d'effacer les données : aucune archive ne sort après.
- **Décidé** : borne provisoire de 15 s du tap au téléchargement (mesuré 11,5 à 13,3 s, 15,4 s une fois sous forte charge). La lecture de la base prend à elle seule environ 6 s. T15c ramènera sous 10 s en construisant l'archive pendant la lecture. Bouton désactivé, avec une explication, quand les données ne sont pas prêtes.
- **Bloquant** : aucun. La borne de 15 s reste juste sous forte charge : à surveiller en CI jusqu'à T15c.

## 2026-09-30 — T10c : le serveur accepte le stock des téléphones

- **Fait** : une récolte saisie hors ligne arrive au serveur avec son mouvement de stock, et son annulation aussi. Testé à deux téléphones : 12 kg notés puis annulés sur l'un, stock inchangé chez l'autre. Les règles du serveur :
  - ajout seul, jamais d'écriture pour une autre ferme ;
  - une saisie est acceptée ou refusée en entier ;
  - une annulation retire exactement ce que la chaîne de la récolte avait ajouté, et une correction exactement la différence ;
  - un seul article par récolte, de la même espèce et de la même unité ;
  - quantités à 6 décimales au plus.
- **Décidé** : pour l'instant, un téléphone n'envoie que des récoltes au stock (ni vente, ni perte, ni ajustement). Un verrou par ferme évite les interblocages. Deux relectures de sécurité, deux défauts bloquants corrigés : une récolte pouvait gonfler le stock, et une correction en créer sur un autre article.
- **Bloquant** : aucun. Question Q20 (corriger une récolte annulée, deux téléphones qui corrigent la même récolte). Suites dans T10d. T11b devient prioritaire : la page de diagnostic de synchro écrit dans une vraie ferme.

## 2026-09-30 — T20 : main verte

- **Fait** : la CI de main était rouge sur des mesures de temps. L'appli ne précharge plus ses fichiers hors ligne pendant son premier affichage : le service worker s'enregistre après, au repos. Les mesures d'écran prennent la médiane de 5 essais ; les budgets n'ont pas bougé (réouverture hors ligne 205 à 257 ms, Planches 169 à 215 ms). Un test instable de l'onglet Ferme est corrigé (6 échecs sur 30, puis 15 sur 15).
- **Décidé** : la première réouverture, plus lente, compte dans la médiane, sans chauffe cachée. Le port des tests e2e est réglable (E2E_PORT_APPLI), pour que deux équipes testent en même temps.
- **Bloquant** : aucun. Suites dans T11b (rechargement si un fichier a disparu après une mise à jour, garde-fou à 1,5 fois le budget).

## 2026-09-30 — T11 : vue 2D des planches et base locale

- **Fait** : écran Planches (planches × semaines, réel plein et prévu hachuré, semaine en cours, conflits en libellés courts avec détail au toucher, saison au choix, barres de 44 px au doigt). La base du téléphone s'ouvre dans l'appli après la connexion et reste lisible hors ligne ; elle est effacée à la déconnexion. Relecture : un changement de données ne ramène plus le plan en haut. Ferme de 42 000 lignes : Planches en 0,1 à 0,3 s une fois la base ouverte, défilement fluide.
- **Décidé** : les fichiers de SQLite (2,8 Mio) sont mis en cache après le premier affichage, pour le hors-ligne ; budget de démarrage relevé à 71 Kio (contexte de la base et indicateur de synchro) ; trois tests adaptés (l'export ne compte que ce qu'il ajoute, SQLite ne compte que les requêtes de la page, taille exacte du jeu d'essai).
- **Bloquant** : aucun. Question Q19 (premier tap avant l'ouverture de la base : 0,7 à 0,8 s) ; suites dans T11b (ouvrir la base plus tôt, pages de diagnostic hors production, marges de temps).

## 2026-09-30 — T19 : tests de temps robustes sous charge

- **Fait** : les tests de temps de l'export et de l'import mesurent le calcul (min du temps mural et du temps CPU du processus) ; ils passent dix fois sur dix avec quatre cœurs occupés, et un export deux fois plus lent échoue toujours. L'export rend la main par `setImmediate` sous Node (la cause du « fil gelé » sous charge) ; rien ne change dans le navigateur, vérifié sur Chromium.
- **Décidé** : une attente sans calcul ne se voit plus dans les tests Node, elle sera couverte par l'e2e de l'écran d'export (T16b) ; délai de 60 s sur la relecture de l'export, qui dépassait les 5 s par défaut sous charge.
- **Bloquant** : aucun. Budgets encore lâches (`construireArchive` 2,5 s, import visant le quadratique) : à resserrer plus tard si besoin.

## 2026-09-30 — T14c : suites de la relecture de l'import

- **Fait** : caractères de contrôle collés dans Excel remplacés par une espace (le classeur reste lisible), vrais caractères interdits refusés ; `creerModele` ne crée plus jamais un modèle illisible ; décodage UTF-16 identique au navigateur ; 400 000 lignes à 5 erreurs tiennent sous 350 Mo (plus de 700 avant), en 3,6 s au lieu de 7.
- **Décidé** : les messages d'erreur ne recopient plus la cellule (l'écran d'import l'affichera à côté) ; les tests de mémoire passent par un processus plafonné quand l'environnement impose un gros tas (ils ne vérifiaient rien dans le conteneur de la boucle).
- **Bloquant** : aucun. Suites dans T14b (garde à l'exécution des modèles relus, rapprochement de très nombreuses cultures) ; test de temps de l'export fragile sous charge : T19.

## 2026-09-29 — T16 : identité visuelle

- **Fait** : jetons de design (une seule source, CSS généré), polices hébergées avec l'appli (86 Kio, hors ligne, aucune requête vers Google), composants (boutons, cartes de tâche, en-tête, barre de navigation à 4 onglets, alerte, confirmation), écran de connexion fidèle à la maquette, coquille, écran Ferme (export et déconnexion). Contraste AA vérifié par test, focus clavier visible, lisible zoomé à 200 %.
- **Décidé** : deux couleurs des maquettes légèrement foncées pour la lisibilité (gris tertiaire #606D64, bande salades #2670CC) ; Archivo réduite à la largeur 112 % (22 Kio) ; budget de démarrage abaissé à 70 Kio (69,8 mesurés) ; l'export sera branché avec T11 (T16b).
- **Bloquant** : aucun. Marge de poids très faible (0,2 Kio) avant T11 et T13 : ces tickets devront justifier toute hausse. Réouverture hors ligne : 251 ms sur l'écran de connexion, 170 ms connecté (limite 300).

## 2026-09-29 — T15b : export compressé, léger et sans formules

- **Fait** : archive ZIP compressée (ferme d'exemple : 38,6 Mo → 2 Mo, envoyable par e-mail), fabriquée fichier par fichier (3 Mo de mémoire au pic au lieu d'environ 210 Mo), écran jamais gelé avec barre d'avancement et bouton « Annuler », formules Excel neutralisées dans les CSV (apostrophe devant `=`, `+`, `-`, `@`), `ferme.json` fidèle.
- **Décidé** : pas de Web Worker (le calcul rend la main toutes les 8 ms) ; compression injectée (CompressionStream dans le navigateur) ; test de fluidité mesuré en temps de calcul pour ne plus échouer sur une machine chargée ; vérifié dans LibreOffice qu'aucune formule neutralisée ne s'exécute.
- **Bloquant** : aucun. L'écran d'export sera accessible depuis l'onglet Ferme avec T16.

## 2026-09-29 — T14 : moteur d'import de tableur

- **Fait** : moteur pur dans `packages/core/src/import` : lecture CSV (UTF-8, Windows-1252, UTF-16, séparateur détecté) et Excel (.xlsx lu sans bibliothèque), en-tête et type de contenu devinés, colonnes reconnues par synonymes français et anglais avec unités (m, cm, ha, kg, g, semaines), dates (JJ/MM ou MM/JJ par colonne, Excel 1900 et 1904, semaines), cultures rapprochées de la bibliothèque, aperçu ligne par ligne sans rien écrire, modèle d'import réutilisable. Ferme complète plus 30 000 séries préparées en moins d'une seconde.
- **Décidé** : ticket découpé (écrans dans T14b, après le design) ; quatre passages de relecture pour que des fichiers piégés ou énormes ne puissent ni geler ni faire planter l'onglet (plafonds de cases, de lignes, de taille de cellule) ; toute unité inconnue ou étrangère fait ignorer la colonne plutôt que de lire une mauvaise valeur.
- **Bloquant** : aucun. Q17 (délais de retour par famille) et Q18 (saison à cheval) en attente ; derniers écarts mineurs dans T14c.

## 2026-09-29 — T09b : connexion durcie avant la mise en production

- **Fait** : déconnexion qui efface le téléphone (même hors ligne, même avec un autre onglet ouvert, avec confirmation s'il reste des saisies non envoyées) ; rotation du jeton de renouvellement avec détection de vol (tout jeton remplacé ou rejoué coupe la session) tout en tolérant une réponse perdue au champ ; limite par IP (IPv6 par /64, conservation 24 h) ; CSP stricte sur les trois pages ; garde qui refuse un compte supprimé ; écart d'horloge du téléphone corrigé et gardé ; expéditeur SMTP (nodemailer) ; adresses piégées refusées.
- **Décidé** : trois passages de relecture sécurité (deux bloquants corrigés : un voleur pouvait garder la session ; un effacement différé pouvait supprimer des saisies après reconnexion) ; renouvellement sérialisé entre onglets par `navigator.locks` ; jeton d'accès valable jusqu'à 1 h après déconnexion (limite documentée).
- **Bloquant** : aucun. Q14 (fournisseur d'e-mail) et Q15 (seuil par IP au magasin) en attente. Budget de démarrage à 70,9 Kio sur 90 : à regagner dans le ticket design.

## 2026-09-29 — T15 : export complet JSON + CSV

- **Fait** : bouton « Exporter toute ma ferme » qui fabrique sur le téléphone, même hors ligne, une archive ZIP : `ferme.json` complet, un CSV par table lisible dans Excel (`;`, virgule décimale, BOM), la bibliothèque de référence, et un LISEZMOI qui décrit chaque colonne en français. Ferme d'exemple (30 000 saisies) exportée en moins d'une seconde.
- **Décidé** : liste blanche colonne par colonne (jamais d'e-mail d'autrui, de jeton ni de refus de synchro) ; lignes supprimées exportées avec leur date ; archive non compressée pour cette version (37 Mo pour la ferme d'exemple).
- **Bloquant** : aucun. Le bouton n'est relié à aucun menu tant que les écrans ne sont pas habillés (maquettes à valider). Compression, mémoire (environ 200 Mo au pic), écran figé environ 3 s sur téléphone lent et formules Excel : ticket T15b.

## 2026-09-29 — T10b : règles des saisies dans le cœur

- **Fait** : `validerSaisie` dans `packages/core/src/saisies`, pure et qui ne lève jamais (210 tests) ; le serveur l'appelle à chaque envoi et n'a plus de règles propres. Nouveaux refus : gravité hors liste, cible ou opérateur absents, quantités négatives, durées non entières, horodatage sur un jour inexistant, plafonds des quantités.
- **Décidé** : plafonds provisoires en attendant Théophane (Q13) ; 300 000 saisies aléatoires comparées à l'ancienne version, aucune saisie refusée avant n'est acceptée maintenant ; environ 7 µs par saisie.
- **Bloquant** : aucun. Q13 (plafonds) en attente ; l'opérateur d'un traitement peut encore être vide (à décider pour le registre phyto).

## 2026-09-29 — T10 : synchro de bout en bout

- **Fait** : service PowerSync 1.26.1 auto-hébergé (docker-compose, CI), flux par ferme (membres acceptés seulement, jamais d'e-mail d'autrui ni de secret), `POST /sync/upload` qui vérifie ferme, auteur et chaque référence (série, planche, vanne, produit phyto) avant d'écrire avec son historique, refus motivés qui redescendent sur le téléphone sans bloquer la file, porte `@planif/sync`, reprise sur jeton expiré et état « session expirée ». Test de bout en bout : deux navigateurs, saisie hors ligne, arrivée chez le collègue.
- **Décidé** : l'historique est écrit par le serveur ; un refus n'est visible que par son auteur ; limites de taille (note 4 000 caractères, 20 photos, détail 8 Kio, lot 500, corps 5 Mio) ; une planche citée deux fois est refusée ; image PowerSync figée. Trois passages de relecture (un bloquant corrigé : références vers une autre ferme).
- **Bloquant** : aucun. Reporté : règles des saisies à déplacer dans le cœur (T10b) ; effacement de la base à la déconnexion et écart d'horloge (T09b) ; noms des collègues non synchronisés tant que le nom peut contenir l'e-mail.

## 2026-09-29 — T09 : comptes, fermes et jetons

- **Fait** : connexion par code à 6 chiffres envoyé par e-mail (sans mot de passe), jetons RS256 d'une heure et renouvellement glissant de 90 jours plafonné à 365, fermes et rôles gérant/équipier, invitation par e-mail, isolement entre fermes (404). Après relecture sécurité : 10 échecs de code par adresse et par 24 h, 10 envois par 24 h, noms de ferme sans caractères de contrôle, invitation « en attente » jusqu'à la connexion de l'invité, 20 invitations par heure, compte supprimé coupé immédiatement, `COURRIEL_CONSOLE` interdit en production.
- **Décidé** : l'invitation s'accepte par la connexion (pas d'écran d'acceptation) ; les échecs se comptent sur les codes existants, sans nouvelle table ; déconnexion, rotation du jeton, limite par IP, CSP et vrai service d'e-mail regroupés dans T09b.
- **Bloquant** : aucun. L'écran de connexion est fonctionnel mais brut ; il prendra l'habillage des maquettes une fois validées par Théophane.

## 2026-09-29 — Boucle : T06b et T08 fusionnés, Q9 posée

- **Fait** : T06b (une ligne en retard par série) et T08 (schéma PostgreSQL) testés, relus, fusionnés automatiquement avec la CI verte ; question Q9 posée pour T09.
- **Décidé** : recommandation d'un code à 6 chiffres par e-mail, clé d'accès en option, pas de mot de passe.
- **Bloquant** : T09 attend la réponse à Q9 ; T10 à T15 attendent T09.

## 2026-09-29 — T08 : schéma PostgreSQL et migrations

- **Fait** : paquet `@planif/db` (Drizzle) : 21 tables, clés étrangères sans cascade, journal en ajout seul protégé par déclencheurs, vues `recoltes`, `interventions`, `traitements` (version en vigueur seulement), publication `powersync`, docker-compose Postgres 17 en réplication logique, CI avec un vrai Postgres et contrôle de dérive schéma/migrations ; 536 tests avec la base.
- **Décidé** : un événement + détail (Q10), modèle v1 mis à jour ; six écarts au modèle documentés dans `packages/db/README.md` ; une saisie mal formée est refusée à l'écriture pour ne jamais casser le registre phyto.
- **Bloquant** : aucun pour T08 ; T09 (comptes) attend Q9 (méthode de connexion) et devra créer un rôle applicatif sans droit de modifier le journal.
## 2026-09-29 — T06b : une seule ligne en retard par série

- **Fait** : le semainier ne liste plus qu'une ligne en retard par série, la plus ancienne étape non faite ; les étapes de la semaine restent listées ; exemple du ticket juste (84 j puis 56 j) ; 487 tests, 3 000 séries en 4 ms.
- **Décidé** : deux tests de T06 mis à jour pour Q12, sans changer les jours de retard attendus ; la règle Q11 s'applique avant.
- **Bloquant** : aucun ; relecture sans point bloquant, fusion automatique si la CI est verte.
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

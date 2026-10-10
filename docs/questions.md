# Questions pour Théophane

Une question à la fois. Chaque réponse est recopiée ici, puis sert au modèle de données (`docs/modele-donnees.md`).

## Modèle de données

### Q1 — Découpage de la ferme (posée le 2026-09-25)

Comment découpez-vous votre ferme, du plus grand au plus petit ? Quels niveaux employez-vous (site, îlot, parcelle, tunnel, planche, rang, gouttière…), et où se placent les 60 vannes d'irrigation par rapport à ces niveaux ?

Réponse : « oui plutôt comme ça oui ». D'accord sur des niveaux qui couvrent tunnels, planches, rangs et gouttières, avec le hors-sol et les pérennes pris en compte dès le départ. Détail à confirmer en Q1 bis.

### Q1 bis — Découpage proposé (posée le 2026-09-25)

1. **Ferme** : l'exploitation entière.
2. **Zone** : un ensemble homogène (un tunnel, une serre, un îlot de plein champ, un verger). Elle porte le type d'abri : plein champ, tunnel, serre ou hors-sol.
3. **Emplacement** : là où vit une culture, avec sa propre ligne de temps. Trois sortes :
    - planche (longueur × largeur) pour le maraîchage, par exemple les tomates ;
    - rang pour les pérennes (kiwis, asperges, pivoines), occupé plusieurs années ;
    - gouttière pour le hors-sol (fraises), avec longueur et nombre de plants.
4. **Irrigation, à part** : une vanne commande un secteur qui arrose un ou plusieurs emplacements, éventuellement dans plusieurs zones. Ce n'est pas un niveau du découpage, pour pouvoir changer le réseau sans toucher au plan de culture.

Question : qu'est-ce qui cloche dans ce découpage ?

Réponse : « ok ». Découpage ferme → zone → emplacement (planche, rang, gouttière), irrigation à part : validé.

### Q2 — Ce qu'est une série (posée le 2026-09-25)

Proposition :

1. **Série** : une culture (espèce et variété) mise en place à une date donnée, selon un itinéraire technique, sur une longueur d'emplacement. Exemple : « batavia, plantée semaine 14, 60 m sur les planches 3 et 4, récolte semaines 20 à 22 ».
    - Elle peut occuper une partie d'une planche, ou plusieurs planches.
    - Elle a des dates prévues (calculées par le moteur) et des dates réelles (saisies au champ).
    - Des semis échelonnés toutes les deux semaines font plusieurs séries.
2. **Pérennes à part** : une **plantation** (kiwis plantés en 2019 sur les rangs 1 à 6) dure des années ; chaque année, une **campagne** porte la taille, les récoltes et le rendement.

Question : est-ce comme ça que vous voyez une série ?

Réponse : « ok ». Série (culture + date + itinéraire + longueur d'emplacement, prévu et réel) et, pour les pérennes, plantation pluriannuelle + campagne annuelle : validé.

### Q3 — Ce qui se saisit au champ (posée le 2026-09-25)

Proposition. Règle commune : une saisie = quoi, où, combien, en trois taps au plus ; date, heure et auteur remplis automatiquement ; photo et note toujours facultatives.

| Saisie | Champs indispensables | Relié à |
| --- | --- | --- |
| Réalisé (semis, plantation, arrachage) | série, date réelle, longueur ou nombre de plants si différent du prévu | série |
| Récolte | série ou campagne, quantité, unité (kg, botte, pièce) | stock |
| Intervention (désherbage, paillage, taille, palissage, effeuillage, fertilisation) | type, emplacement ou série | série ou emplacement |
| Irrigation | vanne, durée | secteur d'irrigation ; saisie manuelle en attendant l'intégration fertirrigation (phase 3) |
| Traitement phyto | produit, dose, surface, cible, emplacement | registre phytosanitaire (délai avant récolte calculé) |
| Observation | emplacement ou série, type (ravageur, maladie, stade, autre), texte ou photo | série ou emplacement |

Question : est-ce la bonne liste ? Barrez ce que vous ne saisiriez jamais, ajoutez ce qui manque.

Réponse : « ok et pas oublier travail du sol, assolement, etc. ». Liste validée. Ajouts : le travail du sol (et plus largement couverture, fertilisation, amendement) comme types d'intervention ; l'assolement dans le modèle, en vue calculée et en plan prévu facultatif.

### Q4 — Validation du modèle de données v1 (posée le 2026-09-25)

Proposition complète dans [`modele-donnees.md`](modele-donnees.md).

Question : qu'est-ce qui cloche dans ce modèle ? Point le moins sûr : l'assolement prévu (par zone, par emplacement, ou pas du tout).

Réponse : « ça dépend : par zone, par chapelle, par planche. Et il faut stocker l'assolement, car par exemple on ne remet pas des choux au même endroit avant 4, 5 ou 6 ans. »

Corrections apportées au modèle :

- Une zone peut contenir des sous-zones (serre multichapelle → chapelles).
- L'assolement est une table enregistrée, jamais effacée, à n'importe quel niveau (zone, chapelle, planche), prévu ou passé ; l'historique des années antérieures à l'appli se saisit ou s'importe en une ligne.
- Délais de retour minimal et conseillé par famille, remplaçables par espèce (choux : 4 minimum, 6 conseillés) ; alerte rouge ou orange.
- Un emplacement redessiné garde le lien vers ceux qu'il remplace, pour ne pas perdre l'historique de rotation.

### Q4 bis — Validation finale du modèle (posée le 2026-09-25)

Question : avec ces corrections, le modèle est-il validé ?

Réponse : « ok ». Modèle v1 validé le 2026-09-25.

## Technique

### Q5 — Moteur de synchro (posée le 2026-09-25)

Recommandation dans [`choix-synchro.md`](choix-synchro.md) : PowerSync, auto-hébergé en UE.

Question : on part sur PowerSync ?

Réponse : « ok ». PowerSync auto-hébergé en UE, validé le 2026-09-25.

### Q6 — Données réelles des Jardins de Garonne (posée le 2026-09-25)

Pour T14 (import) et pour vérifier le moteur sur de vraies données : quels fichiers pouvez-vous fournir ? Par exemple un export Elzéard, un tableur Excel du parcellaire (zones, chapelles, planches et dimensions), la liste des cultures et itinéraires, le plan 2026 et l'assolement des années passées. Même incomplets, dans l'état.

Réponse : « il faudrait qu'on fasse quelque chose qui puisse s'adapter à toutes les fermes ». T14 réécrit en import générique : n'importe quel tableur, correspondance des colonnes et des valeurs proposée puis validée, modèle d'import réutilisable, jeu de test de six formes de fichiers. Plus de dépendance aux fichiers d'une ferme.

### Q7 — Formules de besoins en semences et en plants (posée le 2026-09-25)

Formules du ticket T05 :

- Plants en place = longueur ÷ écartement sur le rang (arrondi en dessous) × nombre de rangs.
- Semis direct : graines = plants × graines par poquet ÷ taux de germination, + marge de sécurité.
- Plant maison : mottes = plants + marge ; graines = mottes × graines par motte ÷ taux de germination.
- Plant acheté : plants à commander = plants + marge.
- Poids = graines × poids de mille graines ÷ 1 000.

Exemples : carotte en semis direct sur 30 m, 4 rangs, 3 cm, germination 80 %, marge 10 % → 4 000 plants, 5 500 graines, 6,6 g. Batavia en plant maison sur 30 m, 3 rangs, 30 cm, germination 90 %, marge 10 % → 300 plants, 330 mottes, 367 graines.

Question : ces calculs sont-ils ceux que vous faites ?

Réponse : « il y a de ça, oui ». Validé dans le principe, pas dans le détail. Pour s'adapter à toutes les fermes, T05 couvre maintenant trois façons de compter la densité (écartement, au mètre linéaire, à la volée), les mottes à plusieurs plants, la perte en pépinière et le nombre de plaques. Un cas qui n'entre dans aucune se signalera ici.

### Q8 — Budget de 300 ms avec la base locale (posée le 2026-09-25)

Mesure de T07, détail dans [`mesures/sqlite.md`](mesures/sqlite.md) : ferme simulée de 400 planches, 3 000 séries sur 5 ans et 30 000 événements, CPU ralenti ×4. On mesure le temps pour ouvrir la base puis afficher la vue 2D d'une saison.

| Variante | Base dans un worker (conditions du test) | SQLite ralenti lui aussi (plus proche d'un téléphone) |
| --- | --- | --- |
| Tables PowerSync par défaut (JSON) | 340 à 420 ms | 566 ms |
| Tables brutes (« raw tables ») | 270 à 320 ms | 426 ms |

Ces chiffres sont un minimum : ils ne comptent ni l'affichage des lignes à l'écran ni le chargement de la bibliothèque. Une fois la base ouverte, un écran courant ne paie plus que sa requête : 50 à 160 ms en tables brutes. Le budget n'est donc dépassé qu'au premier écran après un lancement à froid, mais ce cas est fréquent au champ, parce qu'Android ferme souvent l'appli en arrière-plan.

Pistes chiffrées :

1. Tables brutes : environ −90 ms sur la vue 2D. C'est la variante recommandée.
2. Ouvrir la base dès le lancement, en même temps que l'affichage de l'appli, et la garder ouverte : 300 ms tenus pour tous les écrans suivants.
3. Stockage OPFS au lieu d'IndexedDB : environ −60 ms, et un fichier SQLite plus léger (500 Kio au lieu de 760 Kio compressés). Reste à valider sur Safari iPhone.
4. Ne charger que les planches visibles à l'écran : non mesuré.

Question : tu acceptes cette règle ?

- 300 ms pour tout écran courant, base ouverte ;
- 500 ms au plus pour le premier écran avec données après un lancement à froid, avec un squelette affiché tout de suite.

Sinon, on cherche encore à gagner sur l'ouverture avant de construire la synchro (T10). La mesure sur ton propre téléphone Android trancherait. Elle demande de mettre en ligne une page de test : dis-moi si tu le veux.

Réponse (2026-09-29) : « ok ». Règle retenue : 300 ms pour tout écran courant, base ouverte ; 500 ms au plus pour le premier écran avec données après un lancement à froid, avec un squelette affiché tout de suite. Tables brutes (« raw tables ») retenues ; la base s'ouvre au lancement et reste ouverte (T10).
### Q10 — Récoltes, interventions et traitements : tables séparées ou détail de l'événement ? (posée le 2026-09-26)

Pour T08 (schéma PostgreSQL). Le modèle v1 prévoit des tables séparées **Récolte**, **Intervention** et **Traitement**. T01 (PR #1) a choisi autre chose : un seul **événement** du journal, avec un détail qui change selon le type (réalisé, récolte, intervention, irrigation, traitement, observation). Le mouvement de stock d'une récolte pointe alors vers l'événement.

| | Un événement + détail (choix de T01) | Tables séparées (modèle v1) |
| --- | --- | --- |
| Saisie au champ, synchro | une seule table en ajout seul, simple à synchroniser sans conflit | une écriture dans deux tables par saisie |
| Registre phyto, cahier de récolte | une requête filtrée par type | une table directe, plus simple à exporter |
| Contraintes côté serveur | vérifiées dans un champ JSON | colonnes typées, contrôles natifs |

Ma recommandation : **un événement + détail**, avec des vues SQL « récoltes », « interventions » et « traitements » pour les exports et le registre phyto. On garde la simplicité de la synchro hors ligne et les tableaux lisibles.

Question : on part là-dessus pour T08 ?

Réponse (2026-09-29) : « ok ». Un événement + détail, avec des vues SQL « récoltes », « interventions » et « traitements » pour les exports et le registre phyto. Le modèle v1 est à mettre à jour dans ce sens avec T08.

### Q11 — Semis non saisi avant une plantation réalisée (posée le 2026-09-25, PR #2)

Question : si la plantation est saisie mais pas le semis en pépinière, le semis compte-t-il comme fait ?

Réponse (2026-09-29) : « ok ». Oui : une étape antérieure non saisie compte comme faite dès qu'une étape postérieure est réalisée. C'est la règle déjà codée dans T06.

### Q12 — Tâches en retard dans le semainier (posée le 2026-09-25, PR #6)

Question : faut-il limiter les tâches en retard ? Proposition : une seule ligne en retard par série, celle de la plus ancienne étape non faite.

Réponse (2026-09-29) : « ok ». Une seule ligne en retard par série. Ticket T06b.

### Q9 — Méthode de connexion (posée le 2026-09-29)

Pour T09 (comptes). On se connecte une fois par téléphone, puis la session tient au moins 30 jours, même hors ligne.

| Méthode | Au champ, avec des gants | Pour un saisonnier | Inconvénient |
| --- | --- | --- | --- |
| **Code à 6 chiffres reçu par e-mail** | taper 6 chiffres, une fois par mois | marche avec n'importe quelle adresse | il faut ouvrir sa messagerie |
| Lien magique par e-mail | un tap sur le lien | pareil | le lien s'ouvre souvent dans le mauvais navigateur, et l'appli installée ne récupère pas la session |
| Clé d'accès (empreinte ou visage) | la plus rapide, aucun mot de passe | dépend du téléphone de chacun | pas tous les téléphones, et perdue si le téléphone change |
| Mot de passe | à taper, à retenir, à réinitialiser | à gérer pour chaque saisonnier | le plus pénible et le moins sûr |

Ma recommandation : **code à 6 chiffres par e-mail** pour commencer, puis **clé d'accès en option** pour ceux qui veulent (empreinte au lieu du code). Pas de mot de passe.

Question : on part là-dessus ?

Réponse (2026-09-29) : « ok ». Code à 6 chiffres par e-mail ; clé d'accès (empreinte ou visage) en option ; pas de mot de passe.

### Q13 — Plafonds des quantités par saisie (posée le 2026-09-29, T10b)

Question : jusqu'ici, n'importe quelle quantité passait (même 10³⁰⁸ kg). Valeurs provisoires, dans `PLAFONDS_PROVISOIRES` de `packages/core/src/saisies` :

| Saisie | Plafond | Raison |
| --- | --- | --- |
| Récolte | 100 000 (kg, bottes ou pièces) | Bien au-delà d'une journée sur 4 ha |
| Semis ou plantation réalisés | 10 000 000 | Carottes en semis direct sur 4 ha : environ 4 millions de graines |
| Apport (compost, fumier) | 1 000 000 kg | 40 t/ha sur 4 ha = 160 t |
| Occupation d'une planche | 1 095 jours | Une bâche reste rarement plus de 3 ans |
| Irrigation | 1 440 minutes | Une saisie couvre au plus une journée |
| Traitement : dose | 100 000 (unité libre) | Marge pour les g ou les mL |
| Traitement : surface | 100 000 m² | 2,5 fois la ferme |

Tant que Théophane n'a pas répondu, ces valeurs s'appliquent ; une saisie au-dessus est refusée avec le motif « plafond dépassé ».

Réponse (2026-09-30) : « oui, on garde ces valeurs ». Les plafonds provisoires deviennent définitifs (T10g : renommer `PLAFONDS_PROVISOIRES`).

### Q14 — Service d'envoi des e-mails de connexion (posée le 2026-09-29, T09b)

Question : l'appli envoie le code de connexion par un serveur SMTP générique (variables `SMTP_*`). Il faut choisir un fournisseur hébergé en UE (par exemple Brevo, Scaleway Transactional Email, Mailjet), signer le contrat de sous-traitance, et choisir le domaine d'envoi (enregistrements SPF, DKIM, DMARC). À faire avant la mise en service. Tant que rien n'est choisi, seul le mode console de développement fonctionne.

Réponse (2026-09-30) : **Brevo**. Théophane crée le compte et choisit le domaine d'envoi ; le branchement (SPF, DKIM, DMARC, variables `SMTP_*`) est dans T09c.

### Q15 — Limite de connexions par adresse IP au magasin (posée le 2026-09-29, T09b)

Question : une même adresse IP peut demander au plus 30 codes et en vérifier 60 par heure. Au magasin, tout le monde sort par la même IP : ces seuils suffisent-ils (combien de personnes se connectent par heure au plus) ?

Réponse (2026-09-30) : « moins de 10 personnes par heure » : on garde 30 demandes et 60 vérifications par heure et par IP.

### Q16 — Maquettes de l'identité visuelle (posée le 2026-09-29)

Question : les maquettes (https://claude.ai/artifact/CkYjAD2qX9mxw3FNLT9miP) conviennent-elles : vert forêt pour ce qui se touche, orange pour ce qui presse, typo lisible au soleil, gros boutons ? Première série de 4 écrans, puis 6 de plus à la demande de Théophane (semaine, nouvelle série, dicter, import, ferme, ordinateur).

Réponse (2026-09-29) : « Très sympa ». Style validé ; ticket T16 avant T11 et T13.

### Q17 — Délais de retour par famille botanique (posée le 2026-09-29, T14)

Question : valeurs par défaut des alertes de rotation (délai minimal / conseillé, en années), dans `FAMILLES_PAR_DEFAUT` de `packages/core/src/import`, modifiables ensuite par ferme :

| Famille | Délais | Exemples |
| --- | --- | --- |
| Alliacées | 4 / 5 | ail, oignon, poireau |
| Amaranthacées | 3 / 4 | betterave, épinard, blette |
| Apiacées | 3 / 4 | carotte, céleri, fenouil |
| Asparagacées | 8 / 10 | asperge |
| Astéracées | 2 / 3 | laitues, chicorées |
| Brassicacées | 4 / 6 | choux (règle de Q4) |
| Convolvulacées | 3 / 4 | patate douce |
| Cucurbitacées | 3 / 4 | courgette, courges, melon |
| Fabacées | 3 / 5 | pois, haricot |
| Lamiacées | 2 / 3 | basilic |
| Paeoniacées | 5 / 8 | pivoine (peu sûr) |
| Poacées | 1 / 2 | maïs doux |
| Polygonacées | 3 / 4 | rhubarbe |
| Rosacées | 4 / 5 | fraisier |
| Solanacées | 3 / 4 | tomate, aubergine, poivron |
| Valérianacées | 2 / 3 | mâche |

Les kiwis sont exclus (liane pérenne). La rotation a-t-elle un sens pour la fraise hors-sol ?

Réponse (2026-09-30) : pas d'alerte de rotation sur le hors-sol (abri `hors_sol` ou gouttière) ; les délais par famille proposés restent, modifiables par ferme. Ticket T04b.

### Q18 — Saison à cheval sur deux années (posée le 2026-09-29, T14)

Question : dans un tableur, une série semée en S40 et plantée en S2 : faut-il comprendre que la plantation est l'année suivante ? Pour l'instant, ces lignes sont signalées en erreur (`dates_incoherentes`) plutôt que devinées.

Réponse (2026-09-30) : « oui, année suivante ». Quand une date retombe avant la précédente, l'import passe à l'année suivante et le signale dans l'aperçu. Ticket T14d.

### Q19 — Premier tap juste après l'ouverture de l'appli (posée le 2026-09-30, T11)

Question : si tu ouvres l'appli et tapes tout de suite sur Planches, l'écran met 0,7 à 0,8 s à s'afficher (téléphone moyen simulé), le temps que les données du téléphone s'ouvrent. Une fois ouvertes, c'est 0,1 à 0,3 s. Est-ce acceptable pour l'instant, avec « Ouverture des données… » affiché, ou faut-il en faire une priorité (T11b) ?

Réponse (2026-09-30) : « ok pour l'instant ». La correction reste dans T11b, sans priorité.

### Q24 — « Fait » sur un travail répété en retard (posée le 2026-09-30, T22)

Question : désherbage prévu tous les 14 jours, le 17 et le 31. Tu le fais en retard le 25 et tu tapes « Fait ». Aujourd'hui, l'intervention solde l'occurrence la plus proche, donc celle du 31, qui disparaît, tandis que celle du 17 reste affichée en retard. Proposition : « Fait » sur une carte en retard solde cette occurrence et les précédentes, et laisse la suivante (le 31) à faire. D'accord ?

Réponse (2026-09-30) : « Fait » sur une carte en retard solde cette occurrence et les précédentes ; la suivante reste à faire. Ticket T22b.

### Q23 — Travail prévu jamais saisi (posée le 2026-09-30, T22)

Question : une grelinette prévue 10 jours avant la plantation n'a pas été saisie. Une fois la plantation faite, doit-elle disparaître de la liste (proposition retenue pour l'instant) ou rester en retard jusqu'à ce qu'on la coche ?

Réponse (2026-09-30) : « elle disparaît ». Comportement de T22 confirmé.

### Q22 — Itinéraires et travaux de culture (posée le 2026-09-30, demande de Théophane)

Demande : « des itinéraires de cultures, l'outil adaptable à n'importe quelle ferme ; ça marche aussi pour le travail du sol par culture, les travaux de cultures ».

Réponses (2026-09-30) :
- les travaux prévus peuvent se répéter (tous les N jours entre deux repères), dès le début ;
- un temps de travail estimé, facultatif, par tâche, pour voir la charge de la semaine ;
- modifier un itinéraire : l'appli propose de mettre à jour les séries à venir, avec confirmation ; les séries passées ne bougent jamais ;
- le travail du sol fait partie de l'itinéraire de la culture.

Tickets : T22 (cœur), T23 (serveur), T24 (écran).

### Q21 — Plafonds d'une série (posée le 2026-09-30, T10e)

Question : le serveur refusera une série trop grande. Proposition provisoire : 10 000 m de planche et 1 000 000 de plants au plus. Est-ce que ça te va, ou faut-il d'autres chiffres ? (Même esprit que Q13 pour les quantités.)

Réponse (2026-09-30) : « ok pour 10 000 m et 1 000 000 plants ».

### Q20 — Corriger une récolte déjà annulée (posée le 2026-09-30, T10c)

Question : quand une récolte a été annulée, peut-on encore la corriger, par exemple pour dire « finalement c'était 40 kg » ? Aujourd'hui c'est accepté et le stock revient à la quantité corrigée. L'autre choix est de refuser : pour rétablir, on saisit une nouvelle récolte. Même question quand deux téléphones corrigent la même récolte hors ligne : faut-il garder la correction la plus récente (heure du téléphone) ou la dernière arrivée ?

Réponses (2026-09-30) : une récolte annulée ne se corrige plus, on en saisit une nouvelle ; entre deux corrections hors ligne, on garde la plus récente selon l'heure du téléphone. Ticket T10g.

### Q40 — Régler une espèce qui n'a pas encore d'itinéraire (posée le 2026-10-10, T32c)

Question : une espèce de la ferme sans itinéraire n'a pas de groupe dans l'écran Itinéraires, donc pas de bouton « Croissance ». L'afficher quand même, ou créer l'itinéraire d'abord ?

Réponse (2026-10-10) : l'afficher quand même : toutes les espèces de la ferme ont leur groupe, avec « Croissance », même sans itinéraire (« Aucun itinéraire » écrit dessous). Ticket T32h.

### Q41 — Pérennes qui apparaissent d'un coup au printemps (posée le 2026-10-10, T32f)

Question : une pérenne dont la récolte commence entre fin janvier et début avril reste « au repos » (invisible) dans la 3D jusqu'à 4 semaines avant la récolte, puis apparaît d'un coup en pleine végétation. Est-ce gênant ?

Réponse (2026-10-10) : faire repousser en douceur : la plante redémarre progressivement pendant ces 4 semaines (débourrement puis végétation). Ticket T32i.

### Q38 — La balise de récolte pendant la fin de récolte (posée le 2026-10-10, T32e)

Question : dans la 3D, une planche « à récolter » porte une balise orange au-dessus d'elle. Pendant les deux dernières semaines de la récolte, le feuillage jaunit et la balise disparaît, alors qu'on peut encore y récolter. Proposition : garder une balise jusqu'à la fin de la récolte, d'une teinte plus pâle pendant ces deux dernières semaines (« dernières récoltes »). Ou préfères-tu qu'elle disparaisse, comme aujourd'hui ?

Réponse (2026-10-10) : balise pâle jusqu'au bout : la balise reste jusqu'à la fin de la récolte, plus pâle les deux dernières semaines (« dernières récoltes »), et la planche reste comptée dans « N planches à récolter ». Ticket T32f.

### Q37 — Tester avec ses vraies données : mise en ligne gratuite (posée le 2026-10-09)

Demande de Théophane : « J'aimerais tester avec les vraies données de ma ferme, avec un compte à moi. » Il a proposé une adresse et un mot de passe dans la conversation : la connexion de l'appli se fait **par code à 6 chiffres envoyé par courriel, sans mot de passe** ; aucun mot de passe ne doit circuler dans une conversation ni dans le dépôt. Rien n'est en ligne aujourd'hui (seule la démo l'est).

Réponses (2026-10-09) :
1. **Mise en ligne complète**, plutôt que la ferme gardée sur l'appareil.
2. **Gratuit pendant toute la phase de développement** ; « on verra pour du sérieux plus tard ». Vercel convient pour l'appli et l'API ; même logique pour la synchro (offre gratuite).
3. Choix du chef dans ce cadre : appli et API sur **Vercel** (fonctions en région Paris), PostgreSQL chez **Neon** (offre gratuite, région Francfort, UE), **PowerSync Cloud** (offre gratuite, région UE), courriels par **Brevo** (offre gratuite). Théophane crée les comptes et saisit lui-même les secrets ; la boucle n'y a jamais accès. Tickets T38a (API déployable sur Vercel) et T38b (guide pas à pas).

### Q36 — Placer sa serre, au doigt et dans la démo ; consignes aux ouvriers dans la 3D (posée le 2026-10-09)

Retour de Théophane : « Passer au doigt sur le téléphone, c'est possible. Même le plan 3D sur le téléphone, c'est pas mal : je veux pouvoir dire aux ouvriers vous allez faire ça, ça, ça, pour qu'ils se repèrent facilement. Je ne vois toujours pas comment placer ma serre aux bons endroits, sur fixe comme sur téléphone. »

Constat du chef : l'essai s'est fait **sur la démo en ligne**. La démo n'a pas de photo aérienne (fond neutre) et le placement y est peu engageant ; sur une vraie ferme, il faut aujourd'hui un ordinateur, poser le point de départ, puis « Nouveau bâtiment » (type, nom, dimensions) et toucher la photo : aucune étape n'est annoncée.

Réponses (2026-10-09) :
1. **Placement au doigt** sur le téléphone : oui. Ticket T28k.
2. **Parcours guidé** : les étapes (trouver la ferme, poser le point de départ, ajouter une serre, tracer une zone) annoncées et enchaînées. Ticket T28j.
3. **Démo** : on doit pouvoir y essayer le placement d'une serre sur une vraie photo. Ticket T28i.
4. **Consignes aux ouvriers** : les **travaux du jour, pour tous**, numérotés sur les planches de la 3D au téléphone ; un tap fait voler la caméra jusqu'à la planche. Ticket T37. L'attribution par ouvrier viendra plus tard si besoin.

### Q35 — Droits des profils, recul de la photo aérienne, signal de récolte, fichier réel (posée le 2026-10-09)

Réponses (2026-10-09) :
1. **Profils de croissance** : réglables par le **gérant seulement** (pas tout membre, contrairement à la décision du chef du 8 octobre). Le serveur doit refuser une modification de `profil_croissance` par un équipier. Ticket T32c ajusté.
2. **Photo aérienne** : le zoom de départ ne convient pas : « on n'arrive pas à avoir plus de recul, il peut y avoir des fermes beaucoup plus grandes que la mienne, avec parfois des sites différents ; pour positionner le lieu, ce serait pas mal de pouvoir taper l'adresse, là on est complètement paumé. » Ticket T28h : recherche d'adresse, recul bien plus large, plusieurs sites.
3. **Signal « à récolter »** : une **balise au-dessus de la planche** (panier ou pastille vive), visible même en vue d'ensemble. Ticket T32e précisé.
4. **Fichier réel pour l'import** : aucun ; « je vais construire ma ferme dans notre éditeur ; un nouveau client passera aussi par l'éditeur ». Conséquence : l'éditeur et la prise en main passent avant l'import.

### Q34 — Récolte visible, schéma des rangs, budget (posée le 2026-10-09, après les captures de T32b)

Retour de Théophane : « C'est un peu mieux. Il faudrait voir les choses quand ça a besoin de récolter : les courgettes, il y a un truc qui grossit, les fraises pareil. Il faut que visuellement ce soit impactant. Et dans la fiche culturelle, quand on fait les écartements entre plants, double rang, triple rang, quadruple rang, un petit schéma qui se met en place : en double rang, en quinconce ou non, il faut pouvoir le voir. »

Réponses (2026-10-09) :
1. **Budget** : plus de plafond en nombre de tickets ; seuil de 70 % de la jauge avant mardi (25 tickets = 34 % le vendredi 9 octobre à 12 h 40).
2. **Schéma des rangs** : un nouveau choix sur l'itinéraire, **alignés ou en quinconce** ; il ne change pas le nombre de plants, seulement leur place (schéma de la fiche et 3D). Ticket T35a, puis T35b pour la 3D.
3. **Récolte dans la 3D** : **fruits qui grossissent** et prennent leur couleur pendant la fenêtre de récolte (courgette, fraise, tomate…), **signal « à récolter »** sur la planche, visible même en vue d'ensemble, et **fin de récolte** (plants qui jaunissent ou se dégarnissent). Ticket T32e, après T32d (rendu plus fin : planche fine, jeunes plants visibles, plants découpés et tuteurs).

### Q33 — Plants en 3D : budget et hauteurs par défaut (posée le 2026-10-08, avant T32b)

Question : la vue 3D pèse 218,7 Kio pour un plafond de 220 ; les plants stylisés et le moteur de croissance ajoutent 5 à 7 Kio. Relever le plafond, charger les plants en différé, ou réduire les profils ? Et quatre valeurs par défaut de T32a à relire : asperge, tomate de serre, kiwi, fraisier hors-sol.

Réponses (2026-10-09) :
1. Plafond `jsVue3dGzKio` relevé à **228 Kio** (la 3D est chargée à l'ouverture de la vue 3D seulement ; démarrage inchangé à 71 Kio).
2. **Asperge** : turions seuls pendant la récolte, la fougère ne monte qu'**après la fin de la récolte**, jusqu'à 1,5 m, repos mi-novembre.
3. **Tomate** : hauteur maximale par défaut **3 m** (palissée haute sur ficelle), réglable par la ferme.
4. **Kiwi** : la **pergola et la structure ligneuse restent visibles l'hiver** ; le feuillage seulement en saison.
5. **Fraisier hors-sol** : dessiné sur des **gouttières surélevées** à hauteur de travail, pas au sol.

Ticket T32b (élargi au réglage des valeurs par défaut dans `packages/core/src/croissance`).

### Q32 — Jumeau 3D : trouver l'éditeur, voir les cultures grandir (posée le 2026-10-08, après l'essai de la démo)

Retour de Théophane : « La vue 3D est pas mal. Je ne vois pas comment je crée les bâtiments, comment je la place sur la carte et que j'adapte tout ça. Il faudra une version plus précise pour voir l'avancement de la culture dans le temps, visuellement, la hauteur des tomates, etc. On parle d'un jumeau numérique. »

Constat : l'éditeur de placement (T28b) n'est accessible que par l'onglet Ferme, carte « Plan de la ferme », « Placer sur la photo aérienne », sur ordinateur. Rien dans la vue 3D n'y mène, et la démo n'en montre rien.

Réponses (2026-10-08) :
1. Un bouton « Modifier le plan » dans la vue 3D ouvre l'éditeur ; une ferme sans placement voit un encart qui l'y invite.
2. Cultures montrées par des **plants stylisés** (tuteurs et feuillage pour la tomate, rosettes pour la salade, etc.) qui grandissent avec le curseur de semaine.
3. Hauteurs et profils de croissance : **valeurs par défaut pour les espèces de la bibliothèque, réglables par la ferme**.
4. Stockage du réglage (validé le 2026-10-08) : option A, un champ `profil_croissance` (jsonb, nul = défaut) sur l'espèce de la ferme.
5. Pérennes (validé le 2026-10-08) : cycle annuel simple, débourrement, pleine végétation, repos, sur les dates de campagne ; tailles et âge de la plantation plus tard.

Tickets : T28f (accès à l'éditeur), T32a (profils et calcul), T32b (plants en 3D), T32c (réglage par la ferme).

### Q31 — Placement réel : le modèle (posée le 2026-10-07, T28a)

Question : point de départ du plan, forme des zones, planches dans leur zone, lien serre ↔ zone, qui peut placer.

Réponses (2026-10-07) :
1. Point de départ du plan : champ à part (`ferme.origine_plan`), distinct de la position météo, figé après le premier placement.
2. Zones en **formes libres** (polygones) dès le départ ; les serres et bâtiments restent des rectangles.
3. Les planches se placent dans le repère de leur zone et la suivent.
4. Une serre abrite une zone au plus ; la zone abritée prend le rectangle de la serre, les zones sans serre ont leur polygone.
5. **Gérant seulement** pour tout placement (zones, planches, bâtiments, origine), contrôlé par le serveur.

Tickets : T28a, T28s, T28b, T28d, T28c.

### Q30 — Vue 3D : filtres, jumeau numérique, vol de caméra (posée le 2026-10-07, après le prototype T27)

Demande, après avoir vu le prototype T27 : juger les types de cultures d'un coup d'œil ; une ferme qui n'est pas alignée comme un tableau, avec bâtiments, serres et zones à leur vraie place et orientation, joli visuellement ; cliquer sur « serre M3 » et y aller.

Réponses (2026-10-07) :
- des filtres pour juger les types de cultures (par famille, culture, zone) ;
- un jumeau numérique : placement sur la photo aérienne IGN (orthophoto gratuite de la Géoplateforme, sans clé), à la souris, en déplaçant et en faisant pivoter ; serres rendues en tunnels stylisés (arceaux + bâche translucide, cultures visibles à travers) ;
- cliquer sur « serre M3 », dans la liste ou dans la scène : la caméra vole et se cale pile sur cette serre ;
- avancer vite, beau et efficace : priorité à la 3D cette semaine.

Tickets : T27b (filtres et couleurs), T28a (modèle du placement), T28s (serveur), T28b (éditeur sur photo aérienne), T28c (jumeau 3D), T29 (vol de caméra).

### Q29 — Vue 3D (posée le 2026-10-07)

Questions : que voir en 3D, à quoi elle sert, sur quel appareil, que faire si ça rame.

Réponses (2026-10-07) : d'abord les zones et planches en volumes simples, colorées par culture, avec un curseur de semaine ; surtout au bureau, sur ordinateur, pour préparer la saison ; au téléphone, repli automatique sur la 2D si ça rame. Ticket T27.

### Q28 — Changer d'onglet pendant un export (posée le 2026-10-07, T15c)

Question : si l'on quitte l'onglet Ferme pendant l'export de toute la ferme, l'export s'arrête aujourd'hui sans le dire. Proposition : l'export continue en arrière-plan et le téléchargement arrive quand il est prêt, avec un petit bandeau « Export en cours » sur les autres écrans. Ça te va, ou préfères-tu qu'il s'arrête avec un message ?

Réponse (2026-10-07) : l'export continue en arrière-plan ; le téléchargement arrive quand il est prêt, avec un bandeau « Export en cours » sur les autres écrans. Ticket T15e.

### Q27 — Deux planches avec le même code (posée le 2026-10-07, T10s)

Question : deux planches (emplacements) de la même ferme peuvent-elles porter le même code, par exemple deux « P3 » dans deux tunnels différents ? Aujourd'hui c'est accepté sans rien dire. Refuser rendrait un import fait hors ligne refusé en entier s'il contient un doublon ; seulement avertir laisse passer l'import avec un message. Proposition : unique par zone (deux « P3 » possibles dans deux tunnels, pas dans le même), avec un avertissement à l'import.

Réponse (2026-10-07) : code unique par zone (deux « P3 » possibles dans deux tunnels, pas dans le même) ; un doublon à l'import donne un avertissement, pas un refus. Ticket T10t.

### Q26 — Taper « Fait » avant que la base soit prête (posée le 2026-10-03, T13g)

Question : au lancement, l'écran Aujourd'hui s'affiche maintenant en ≈ 0,4 s au lieu de ≈ 0,8 s, mais en lecture seule : les boutons « Fait » ne s'activent qu'à l'ouverture de la base, vers ≈ 1 s sur un téléphone moyen (≈ 0,2 s plus tard qu'avant, car le dessin de l'écran ralentit l'ouverture). Proposition : accepter le tap sur « Fait » dès l'affichage ; la tâche disparaît tout de suite et s'écrit dès que la base est prête, avec la même vérification « déjà fait ». Ça te va, ou préfères-tu des boutons inactifs tant que la base n'est pas prête ?

Réponse (2026-10-07) : oui, « Fait » est accepté dès l'affichage ; la tâche disparaît au tap et s'écrit dès que la base est prête, avec la même vérification « déjà fait ». Ticket T13k.

### Q25 — Refus d'un ancien membre (posée le 2026-10-02, T10k)

Question : quand quelqu'un quitte une ferme (ou en est retiré), ses anciens refus de synchro restent sur son téléphone, avec le nom de la culture concernée (par exemple « Tomate Cœur de bœuf »). Ce sont des informations qu'il voyait légitimement à l'époque. Faut-il les lui laisser, ou effacer de son téléphone les refus liés à une ferme qu'il a quittée ? Proposition : les effacer, pour que rien d'une ferme ne reste chez quelqu'un qui n'en fait plus partie.

Réponse (2026-10-07) : les effacer ; rien d'une ferme ne reste chez quelqu'un qui n'en fait plus partie. Ticket T10u. Les refus de synchro restent hors de l'export complet (confirmé le 2026-10-07).

### À suivre

## Questions ouvertes du brief

- Nom du produit.
- Cible de lancement : maraîchage diversifié seul, ou aussi hors-sol et serre dès le départ ?
- Fourchette de prix visée par ferme et par mois.

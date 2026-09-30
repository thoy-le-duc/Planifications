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

### Q14 — Service d'envoi des e-mails de connexion (posée le 2026-09-29, T09b)

Question : l'appli envoie le code de connexion par un serveur SMTP générique (variables `SMTP_*`). Il faut choisir un fournisseur hébergé en UE (par exemple Brevo, Scaleway Transactional Email, Mailjet), signer le contrat de sous-traitance, et choisir le domaine d'envoi (enregistrements SPF, DKIM, DMARC). À faire avant la mise en service. Tant que rien n'est choisi, seul le mode console de développement fonctionne.

### Q15 — Limite de connexions par adresse IP au magasin (posée le 2026-09-29, T09b)

Question : une même adresse IP peut demander au plus 30 codes et en vérifier 60 par heure. Au magasin, tout le monde sort par la même IP : ces seuils suffisent-ils (combien de personnes se connectent par heure au plus) ?

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

### Q18 — Saison à cheval sur deux années (posée le 2026-09-29, T14)

Question : dans un tableur, une série semée en S40 et plantée en S2 : faut-il comprendre que la plantation est l'année suivante ? Pour l'instant, ces lignes sont signalées en erreur (`dates_incoherentes`) plutôt que devinées.

### Q19 — Premier tap juste après l'ouverture de l'appli (posée le 2026-09-30, T11)

Question : si tu ouvres l'appli et tapes tout de suite sur Planches, l'écran met 0,7 à 0,8 s à s'afficher (téléphone moyen simulé), le temps que les données du téléphone s'ouvrent. Une fois ouvertes, c'est 0,1 à 0,3 s. Est-ce acceptable pour l'instant, avec « Ouverture des données… » affiché, ou faut-il en faire une priorité (T11b) ?

Réponse (2026-09-30) : « ok pour l'instant ». La correction reste dans T11b, sans priorité.

### Q24 — « Fait » sur un travail répété en retard (posée le 2026-09-30, T22)

Question : désherbage prévu tous les 14 jours, le 17 et le 31. Tu le fais en retard le 25 et tu tapes « Fait ». Aujourd'hui, l'intervention solde l'occurrence la plus proche, donc celle du 31, qui disparaît, tandis que celle du 17 reste affichée en retard. Proposition : « Fait » sur une carte en retard solde cette occurrence et les précédentes, et laisse la suivante (le 31) à faire. D'accord ?

### Q23 — Travail prévu jamais saisi (posée le 2026-09-30, T22)

Question : une grelinette prévue 10 jours avant la plantation n'a pas été saisie. Une fois la plantation faite, doit-elle disparaître de la liste (proposition retenue pour l'instant) ou rester en retard jusqu'à ce qu'on la coche ?

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

### À suivre


## Questions ouvertes du brief

- Nom du produit.
- Cible de lancement : maraîchage diversifié seul, ou aussi hors-sol et serre dès le départ ?
- Fourchette de prix visée par ferme et par mois.

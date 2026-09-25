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

Réponse : _en attente_

### À suivre

- Q8 — Méthode de connexion (T09) : code par e-mail, lien magique, clé d'accès ou mot de passe.

## Questions ouvertes du brief

- Nom du produit.
- Cible de lancement : maraîchage diversifié seul, ou aussi hors-sol et serre dès le départ ?
- Fourchette de prix visée par ferme et par mois.

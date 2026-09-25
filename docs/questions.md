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

## Questions ouvertes du brief

- Nom du produit.
- Cible de lancement : maraîchage diversifié seul, ou aussi hors-sol et serre dès le départ ?
- Fourchette de prix visée par ferme et par mois.

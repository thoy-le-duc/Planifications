# Mesure : premier tap sur « Planches » dans la première seconde, après T11g

Mesure du 2026-10-14, mêmes conditions que `T11e-avant.md`, section 1 (Chromium headless, CPU ×4, build des essais, ferme de T07, hors ligne, 5 répétitions, tap dès la marque `app-prete`, base pas encore prête). Test : `e2e/plan-performances.e2e.ts`, « premier tap sur « Planches » dans la première seconde ».

## Le test d'acceptation : vert

Du tap à la marque `planif:plan-affiche`, en ms (budget 300 ms, plafond 450 ms) :

| | Tap après la navigation | Base au tap | Tap → plan | Médiane | Pire |
| --- | --- | --- | --- | --- | --- |
| Avant (T11e, `T11e-avant.md`) | 376 à 547 | « ouverture » | 633, 694, 571, 621, 663 | **633** | 694 |
| Avant (rejoué ici, sans instantané) | 508 à 650 | « ouverture » | 724, 830, 797, 727, 724 | **727** | 830 |
| Après T11g | 531 à 600 | « ouverture » | 25, 26, 31, 25, 22 | **25** | 31 |

La ligne « rejoué ici » est le premier passage de ce ticket, où l'instantané n'était jamais gardé (l'e2e quitte Planches dès le plan affiché, avant le délai de garde : corrigé, voir plus bas). Elle donne l'état d'avant sur cette machine, plus chargée que celle de T11e.

## Ce qui a changé

- **Instantané du début du plan** (`ecrans/plan/instantane.ts`, clé `planif.plan.<utilisateur>`) : saison, semaines et les 40 premières lignes du dernier plan relu de la saison par défaut, plus le nombre total de lignes (hauteur réservée). Gardé 300 ms après chaque plan relu affiché, ou en quittant l'écran avant. Relu champ par champ ; jamais montré pour une autre ferme, un autre utilisateur, une session rangée d'un autre compte ; effacé à la déconnexion.
- **Planches monté dès l'ouverture de la base** (`App.tsx`, comme Aujourd'hui en T13g) : base pas prête, l'écran montre l'instantané de la dernière ferme montrée, en lecture seule (saison, « Nouvelle série », « Voir en 3D » et appui long désactivés ; « Modifier la série » absent du détail), avec « Lecture des autres planches… » ; la base prête, le plan relu le remplace dans le même écran (ni remontage, ni retour en haut).
- **Écran Planches chargé par `precharger`** dès la session connue : le premier rendu de l'onglet le dessine sans attendre son morceau.

## Octets de démarrage

| | Octets gzip | Limite (71,1 Kio) |
| --- | --- | --- |
| Avant (fin de T13v) | 72 797 | 72 806 |
| Montage de Planches avant la base, seul | 72 809 | dépassé de 3 |
| Après T11g (préparation du plan et de la journée sortie dans `donnees/precharger.ts`, chargé à la demande) | **72 752** | marge 54 |

Budget non relevé.

## Autres e2e

- `plan-performances`, base prête, 10 taps : 14 à 24 ms (médiane 19 ms) ; vert.
- `plan-performances`, défilement : rouge (2 passages saccadés pour moins de 2, 5 intervalles fautifs). Rejoué sur le commit de départ 0f50da3 : rouge aussi (4 passages saccadés, 7 intervalles), déjà noté en T13v. Charge de la machine, sans lien avec T11g.
- `aujourdhui-premier-fait` (acquis de T13u et T13v) : vert, médiane 365 ms (budget 500 ms).
- `plan-premiere-visite` A et B : verts.
- Jeu e2e complet (113 tests, une fois) : 95 verts, 13 sautés, 5 rouges, tous rejoués :
  - `plan-performances`, défilement : rouge aussi sur 0f50da3 (voir plus haut) ;
  - `aujourdhui-grande-ferme`, étape T13k (« Semer en pépinière » revenue après rechargement) : rouge aussi sur 0f50da3 au 2e passage (vert au 1er) ; intermittent, d'avant T11g ;
  - `export-arriere-plan` (une tâche longue de 52 ms pour 50) : vert deux fois sur deux au rejeu ;
  - `plan.e2e.ts` (défilement, 4 passages saccadés pour moins de 4) et `vue-3d-jumeau` (changement de semaine) : verts au rejeu.
- Démo : `build:demo` puis `e2e:demo`, 19 verts.

# Mesure : première relecture après « Fait », après T13t

Mesure du 2026-10-11, mêmes conditions que `T13t-avant.md` (Chromium headless, profil Pixel 7, CPU ×4 sur le fil principal, build des essais, grande ferme de T13b, hors ligne).

## L'e2e (`aujourdhui-grande-ferme.e2e.ts --repeat-each=5`)

Relecture après « Fait », de l'appui à la saisie en tête de l'historique, en ms (budget 500 ms, plafond 750 ms), avec le garde-fou complet (`jugerSerie(...).raisons` vide) :

| Passage | 1re | 2e | 3e | 4e | 5e | Médiane |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 377 | 253 | 195 | 189 | 248 | 248 |
| 2 | 352 | 224 | 222 | 215 | 251 | 224 |
| 3 | 448 | 320 | 188 | 252 | 220 | 252 |
| 4 | 346 | 208 | 237 | 239 | 217 | 237 |
| 5 | 419 | 266 | 238 | 272 | 183 | 266 |

Avant : 1re relecture **1 145 à 2 361 ms**, médianes 388 à 497 ms. Après : 1re relecture **346 à 448 ms**, médianes 224 à 266 ms. 5 passages sur 5 verts.

## Où passe le temps (banc de profil, marques provisoires, non commitées)

Journée relue affichée, « Fait » pendant la relecture complète du retour sur l'onglet :

| Étape | 1re | 2e à 5e |
| --- | --- | --- |
| relecture complète arrêtée (fin de sa requête en cours) | 57 à 78 | 37 à 70 |
| fin de l'écriture | 254 à 288 | 77 à 151 |
| `lireCultures` (3 requêtes) | 45 à 50 | 30 à 40 |
| saisie dans l'historique | 391 à 438 | 180 à 263 |

La relecture complète reprend aussitôt après (elle restait due) et cède de nouveau la place au « Fait » suivant.

« Fait » sur l'instantané, base déjà chaude : 170 à 260 ms (lecture ciblée ≈ 110 ms, écriture ≈ 40 ms, la saisie paraît dans l'historique de l'instantané dès son écriture).

## Ce qui reste

- **Le tout premier « Fait » d'un lancement à froid, tapé sur l'instantané dans la première seconde après l'ouverture de la base** : ≈ 1,0 à 1,2 s. La première requête de la relecture complète (les 3 000 séries et leurs paramètres, pages froides) dure ≈ 1,4 s et une requête SQLite ne s'interrompt pas ; la lecture ciblée attend sa fin. Puis la première écriture de la porte coûte ≈ 280 ms (contre 40 à 100 ensuite), dans `packages/sync`, hors périmètre. Ce cas n'est pas mesuré par l'e2e (son « Fait » suit les allers-retours Planches). Ticket de suite proposé.
- Aucun budget relevé ; démarrage inchangé (71,1 Kio pour 71,1, le code est dans le morceau Aujourd'hui).

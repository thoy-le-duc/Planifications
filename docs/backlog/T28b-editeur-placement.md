# T28b — Éditeur de placement sur photo aérienne : bâtiments et planches (ordinateur)

**Objectif** : sur l'ordinateur, poser les serres et les bâtiments à leur vraie place sur la photo aérienne IGN, à la souris : glisser, faire pivoter, redimensionner (Q30). Le tracé des contours de zones (polygones) est dans T28d, pour garder ce ticket petit.

**Dépend de** : T28s
**Périmètre** : `apps/web/src/ecrans/placement/**` (nouveau), entrée depuis l'onglet Ferme ou la vue 3D, `apps/web/scripts/csp.ts` (+ test), `apps/web/src/serviceWorker.ts` si nécessaire, `apps/web/vite.config.ts`, `apps/web/budget.json` (budget dédié), `apps/web/e2e/**`

## Règles

- **Fond** : orthophoto IGN par la Géoplateforme, WMTS sans clé (`https://data.geopf.fr/wmts`, couche `ORTHOIMAGERY.ORTHOPHOTOS`, jeu de tuiles `PM`), mention « © IGN » visible (licence ouverte Etalab 2.0). Calcul des tuiles (Web Mercator, zoom, pixel) en fonction pure testée ; **pas** de bibliothèque de carte.
- **CSP** : `img-src 'self' https://data.geopf.fr` seulement ; rien d'autre n'est ouvert (`connect-src` inchangé).
- **Sans réseau** : fond neutre quadrillé (1 carreau = 10 m) et message « Photo aérienne indisponible hors ligne » ; l'éditeur reste utilisable. Les tuiles ne sont pas mises en cache dans ce ticket.
- **Vue de dessus** : bâtiments en rectangles, planches, et contours de zones existants (lecture seule ici) à l'échelle ; sélection au clic ; glisser = déplacer ; poignée = pivoter (crans de 1°, Maj = 15°) ; poignées de côté = longueur et largeur.
- **Clavier (accessibilité)** : flèches = 0,1 m (Maj = 1 m), `[` `]` = 1° ; champs numériques x, y, orientation, longueur, largeur, hauteur dans un panneau.
- **Origine** : si la ferme n'en a pas, premier clic sur la photo (ou position météo proposée) = origine, avec confirmation.
- **Écriture** : rien n'est écrit pendant le geste ; « Enregistrer » écrit par la porte (T28s), puis « Annuler » pendant quelques secondes (et Ctrl+Z dans la session). Créer un bâtiment : type, nom, dimensions, puis le poser.
- **Chargé à la demande** : zéro octet ajouté au JS de démarrage ; budget dédié `jsPlacementGzKio` (chiffre mesuré + marge, justifié dans la PR), précaché pour le hors-ligne.
- **Droits (Q31)** : seul le gérant modifie ; pour un équipier, l'éditeur est en lecture seule, sans poignées ni « Enregistrer », avec un message « Seul le gérant peut placer les éléments de la ferme ».
- Lier une serre à une zone qui a déjà un contour : confirmation « Le contour de la zone sera remplacé par la serre ».
- Téléphone : lecture seule avec un message « à faire sur ordinateur ».

## Critères d'acceptation

- [ ] Tests des tuiles : un point connu (lat, lon, zoom 19) → tuile et pixel attendus ; repère local → pixel de l'écran, aller-retour.
- [ ] Test de la CSP : `img-src` contient exactement `'self'` et `https://data.geopf.fr`.
- [ ] Tests des gestes en fonctions pures : glisser, pivoter, clavier → nouveau placement attendu (à 1 cm, 0,1° près).
- [ ] e2e (ordinateur, tuiles servies par une fausse route Playwright) : poser une serre, la tourner de 90°, enregistrer, annuler → retour exact ; recharger → placement conservé.
- [ ] e2e hors ligne : fond neutre + message, déplacer et enregistrer fonctionnent.
- [ ] Test : connecté en équipier, aucune poignée ni bouton d'écriture, message affiché.
- [ ] Budget dédié tenu et dans le précache ; JS de démarrage inchangé.

## Risques

- Données IGN : service public gratuit, mais sans garantie de disponibilité : l'éditeur ne doit jamais en dépendre pour fonctionner.
- Précision de l'orthophoto (environ 20 cm) et décalage possible de quelques décimètres : suffisant pour un jumeau, pas pour du géomètre.

**Hors périmètre** : contours de zones (T28d), photo au sol dans la 3D, cache des tuiles hors ligne, import d'un plan cadastral.

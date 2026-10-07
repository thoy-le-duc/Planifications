# T28a — Placement réel : modèle, calcul et base

**Objectif** : la ferme peut enregistrer où sont réellement ses zones, ses planches et ses bâtiments (serres, hangar, magasin), avec leur orientation, pour le jumeau numérique (Q30). Ce ticket pose les données ; l'éditeur (T28b) et la 3D (T28c) viennent après.

**Dépend de** : — (indépendant de T27b, peut tourner en parallèle)
**Périmètre** : `docs/modele-donnees.md`, `packages/core/src/domaine/**`, `packages/core/src/placement/**` (nouveau), `packages/core/src/export/**`, `packages/db/src/schema.ts`, `packages/db/migrations/**`, `packages/sync/src/schema.ts`, `powersync/sync-config.yaml`

## Modèle (section v1.x de `docs/modele-donnees.md`, validé par Théophane le 2026-10-07, Q31)

- **Repère local de la ferme** : mètres, x vers l'est, y vers le nord ; origine = nouveau champ `ferme.origine_plan` (latitude, longitude), distinct de `ferme.position` (météo) pour qu'un changement de la position météo ne déplace pas toute la ferme. Fixée au premier placement ; ne change plus tant qu'un placement existe.
- **Orientation** : degrés, sens horaire depuis le nord, dans [0, 360[.
- **Zone** : `contour` = liste de sommets `[{x, y}, …]` en mètres locaux (polygone libre, Q31), nul = pas placée. Orientation de la zone = celle de son plus long côté (calculée, pas stockée), qui sert de repère à ses planches.
- **Emplacement** : `placement_x_m`, `placement_y_m`, `orientation_deg` **dans le repère de sa zone** (bouger la serre bouge ses planches) ; nuls = rangement automatique dans la zone.
- **Bâtiment** (nouvelle table `batiment`, de la ferme) : nom, type (`serre_tunnel`, `serre_chapelle`, `hangar`, `magasin`, `autre`), longueur, largeur, hauteur (m), centre (x, y), orientation, `zone_id` facultatif (la zone de culture qu'il abrite, même ferme, au plus un bâtiment non supprimé par zone). Les bâtiments restent des rectangles.
- **Serre et zone** : une zone abritée par un bâtiment n'a pas de contour à elle (`contour` nul en base) : sa forme est le rectangle du bâtiment, et son repère est celui du bâtiment (centre, orientation). Bouger la serre bouge la zone et ses planches. Une zone sans bâtiment a son polygone libre. Lier un bâtiment à une zone qui a déjà un contour : le contour est effacé, avec confirmation à l'écran (T28b).
- Suppression douce, historique (`modification`), UUID v7, comme le reste du parcellaire.

## Règles de calcul (pures, `packages/core/src/placement/`)

- `versLocal(origine, {latitude, longitude})` → `{x, y}` en mètres et `versGeographique(origine, {x, y})` ; projection locale (rayon terrestre 6 378 137 m, cos de la latitude d'origine), aller-retour exact au centimètre près dans un rayon de 5 km.
- `coinsEmprise(centre, longueur, largeur, orientation)` → 4 coins dans le repère local ; `repereZone(zone, batiment?)` (centre et orientation : ceux du bâtiment, sinon centroïde et plus long côté du polygone) ; `versRepereZone` / `depuisRepereZone` pour les planches.
- `validerContour` : 3 sommets au moins, 200 au plus, coordonnées finies, pas deux sommets consécutifs confondus, polygone non auto-intersectant (côtés non adjacents disjoints), aire > 0,1 m² (calculée par la formule du lacet), sommets à 5 km au plus de l'origine, sens normalisé (antihoraire).
- `validerPlacement` : tout ou rien des champs, orientation dans [0, 360[, centre à 5 km au plus de l'origine, dimensions > 0, plafonds (bâtiment : 500 m de long, 200 m de large, 30 m de haut), zone abritée sans contour. Ce sont les règles que le serveur rejouera (T28s).

## Critères d'acceptation

- [ ] Tests de `versLocal` / `versGeographique` : exemples chiffrés (un point à 100 m au nord, 100 m à l'est d'une origine à 44° N), aller-retour < 1 cm à 5 km, orientation 0/90/180/270.
- [ ] Tests de `coinsEmprise` et du repère de zone : planche à (2, 0) dans une serre tournée de 90° → bonnes coordonnées locales ; zone en L sans serre → centroïde et orientation attendus.
- [ ] Tests de `validerContour` : triangle, carré, L, polygone concave valides ; 2 sommets, 201 sommets, nœud papillon (auto-intersection), sommets alignés (aire nulle), sommets confondus, sommet à 6 km → refusés avec message en français ; un contour horaire est rendu antihoraire.
- [ ] Tests de `validerPlacement` : chaque refus, avec message en français.
- [ ] Migration Postgres (nouvelles colonnes nulles, `zone.contour` en jsonb avec taille bornée, table `batiment` avec `ferme_id`, contraintes rejouant `validerPlacement`, index, publication PowerSync) ; test d'intégration du schéma ; les fermes existantes ne changent pas.
- [ ] Schéma PowerSync local et flux `batiment` (même découpage par ferme que `zone`) ; test du schéma.
- [ ] Export JSON + CSV : `batiment.csv`, nouvelles colonnes de `zone`, `emplacement`, `ferme` décrites ; test d'export.
- [ ] `docs/modele-donnees.md` : section v1.x « validée le 2026-10-07 (Q31) », avec les exemples chiffrés ci-dessus et la règle de droits (gérant seulement, contrôlée par T28s).

## Risques

- Le téléphone ne doit rien tirer de neuf au démarrage : les colonnes en plus ne changent ni les requêtes ni le budget de 300 ms (mesures e2e inchangées).
- Ticket le plus large de la série : si la migration et l'export débordent, couper l'export dans un ticket à part (le dire dans la PR).

**Hors périmètre** : acceptation par le serveur et écriture par la porte (T28s), éditeurs (T28b, T28d), rendu 3D (T28c), bâtiments non rectangulaires, trous dans un polygone.

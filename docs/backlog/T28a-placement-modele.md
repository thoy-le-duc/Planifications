# T28a — Placement réel : modèle, calcul et base

**Objectif** : la ferme peut enregistrer où sont réellement ses zones, ses planches et ses bâtiments (serres, hangar, magasin), avec leur orientation, pour le jumeau numérique (Q30). Ce ticket pose les données ; l'éditeur (T28b) et la 3D (T28c) viennent après.

**Dépend de** : — (indépendant de T27b, peut tourner en parallèle)
**Périmètre** : `docs/modele-donnees.md`, `packages/core/src/domaine/**`, `packages/core/src/placement/**` (nouveau), `packages/core/src/export/**`, `packages/db/src/schema.ts`, `packages/db/migrations/**`, `packages/sync/src/schema.ts`, `powersync/sync-config.yaml`

## Modèle proposé (section v1.x de `docs/modele-donnees.md`, **à faire valider par Théophane** : l'écrire comme « proposé » ; la question Q31 est déjà posée dans `docs/questions.md`. Tout est additif (colonnes nulles, nouvelle table) : si la réponse change le modèle, on ajuste avant ou juste après la fusion)

- **Repère local de la ferme** : mètres, x vers l'est, y vers le nord ; origine = nouveau champ `ferme.origine_plan` (latitude, longitude), distinct de `ferme.position` (météo) pour qu'un changement de la position météo ne déplace pas toute la ferme. Fixée au premier placement ; ne change plus tant qu'un placement existe.
- **Orientation** : degrés, sens horaire depuis le nord, dans [0, 360[.
- **Zone** : `placement_x_m`, `placement_y_m` (centre), `orientation_deg`, `emprise_longueur_m`, `emprise_largeur_m` ; tous nuls (pas placée) ou tous renseignés. Emprise rectangulaire en v1.x (un polygone viendra si le besoin est réel).
- **Emplacement** : `placement_x_m`, `placement_y_m`, `orientation_deg` **dans le repère de sa zone** (bouger la serre bouge ses planches) ; nuls = rangement automatique dans la zone.
- **Bâtiment** (nouvelle table `batiment`, de la ferme) : nom, type (`serre_tunnel`, `serre_chapelle`, `hangar`, `magasin`, `autre`), longueur, largeur, hauteur (m), centre (x, y), orientation, `zone_id` facultatif (la zone de culture qu'il abrite, même ferme, au plus un bâtiment non supprimé par zone). Une zone abritée prend l'emprise de son bâtiment.
- Suppression douce, historique (`modification`), UUID v7, comme le reste du parcellaire.

## Règles de calcul (pures, `packages/core/src/placement/`)

- `versLocal(origine, {latitude, longitude})` → `{x, y}` en mètres et `versGeographique(origine, {x, y})` ; projection locale (rayon terrestre 6 378 137 m, cos de la latitude d'origine), aller-retour exact au centimètre près dans un rayon de 5 km.
- `coinsEmprise(centre, longueur, largeur, orientation)` → 4 coins dans le repère local ; `versRepereZone` / `depuisRepereZone` pour les planches.
- `validerPlacement` : tout ou rien des champs, orientation dans [0, 360[, centre à 5 km au plus de l'origine, dimensions > 0, plafonds (bâtiment : 500 m de long, 200 m de large, 30 m de haut). Ce sont les règles que le serveur rejouera (T28s).

## Critères d'acceptation

- [ ] Tests de `versLocal` / `versGeographique` : exemples chiffrés (un point à 100 m au nord, 100 m à l'est d'une origine à 44° N), aller-retour < 1 cm à 5 km, orientation 0/90/180/270.
- [ ] Tests de `coinsEmprise` et du repère de zone : planche à (2, 0) dans une serre tournée de 90° → bonnes coordonnées locales.
- [ ] Tests de `validerPlacement` : chaque refus, avec message en français.
- [ ] Migration Postgres (nouvelles colonnes nulles, table `batiment` avec `ferme_id`, contraintes rejouant `validerPlacement`, index, publication PowerSync) ; test d'intégration du schéma ; les fermes existantes ne changent pas.
- [ ] Schéma PowerSync local et flux `batiment` (même découpage par ferme que `zone`) ; test du schéma.
- [ ] Export JSON + CSV : `batiment.csv`, nouvelles colonnes de `zone`, `emplacement`, `ferme` décrites ; test d'export.
- [ ] `docs/modele-donnees.md` : section v1.x « proposée, en attente de Q31 », avec les exemples chiffrés ci-dessus.

## Risques

- Le téléphone ne doit rien tirer de neuf au démarrage : les colonnes en plus ne changent ni les requêtes ni le budget de 300 ms (mesures e2e inchangées).
- Ticket le plus large de la série : si la migration et l'export débordent, couper l'export dans un ticket à part (le dire dans la PR).

**Hors périmètre** : acceptation par le serveur et écriture par la porte (T28s), éditeur (T28b), rendu 3D (T28c), formes non rectangulaires.

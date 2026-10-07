# T28c — Jumeau 3D : la ferme à sa vraie place

**Objectif** : la vue 3D montre la ferme telle qu'elle est : serres, bâtiments et zones à leur place et leur orientation réelles, serres en tunnels translucides où l'on voit les cultures (Q30).

**Dépend de** : T27b (mêmes fichiers), T28a (données ; pas besoin du serveur)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/src/demo/**` (placement de la ferme de démo), `apps/web/e2e/vue-3d.e2e.ts`, `apps/web/budget.json` (seulement si hausse justifiée)

## Règles

- **Disposition** : l'adaptateur pur place zones, planches et bâtiments selon T28a (fonctions de `packages/core/src/placement`, dont `repereZone`) ; le sol d'une zone sans serre est **extrudé depuis son polygone** (socle peu épais, triangulation d'un polygone concave, par exemple `ShapeGeometry` de three) ; une zone abritée prend le rectangle de sa serre ; une zone ou planche sans placement garde le rangement automatique de T27, à côté de la partie placée, sans chevauchement.
- **Serre tunnel** : arceaux (un tous les 2 m environ) + bâche translucide, cultures visibles à travers ; **serre chapelle** : chapelles accolées de même facture ; **hangar, magasin, autre** : volumes simples (murs + toit), couleurs des jetons.
- **Sol** : neutre, uni ; la photo aérienne au sol est une idée pour plus tard (noter dans le journal).
- Géométrie partagée et instanciée (un seul arceau, une seule bâche par taille), rendu à la demande comme T27, transparence sans tri coûteux.
- La ferme de démo reçoit un placement crédible (serres, magasin, plein champ), pour que la démo en ligne montre le jumeau.
- Repli 2D au téléphone et alternative texte inchangés ; filtres de T27b conservés (une bâche ne cache jamais la couleur d'une planche filtrée).

## Critères d'acceptation

- [ ] Tests de l'adaptateur : serre tournée de 30° → planches tournées avec elle ; zone en L → socle au contour en L (sommets attendus) ; zone non placée rangée à côté sans chevauchement ; bâtiment sans zone ; nombre d'arceaux selon la longueur.
- [ ] e2e (ordinateur, grande ferme placée) : mesures de T27 tenues (affichage < 1 s après chargement du module, semaine < 100 ms, pas de rafale de plus de 2 images perdues).
- [ ] Budget `jsVue3dGzKio` (200 Kio) tenu, ou hausse chiffrée et justifiée dans la PR ; JS de démarrage inchangé.
- [ ] e2e démo : la vue 3D de la démo s'ouvre hors ligne avec ses serres.
- [ ] Capture de référence de la démo jointe à la PR (pour le « joli », jugé par Théophane).

## Risques

- Transparence : plusieurs bâches superposées peuvent scintiller ou coûter cher ; préférer une bâche peu opaque, `depthWrite` coupé, et mesurer.
- Le « joli » ne se teste pas : la capture dans la PR sert de juge ; ne pas ajouter de post-traitement (ombres douces, reflets) sans mesure.

**Hors périmètre** : photo aérienne au sol, vol de caméra (T29), édition dans la 3D.

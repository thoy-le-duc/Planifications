# T27 — Vue 3D : prototype mesurable

**Objectif** : voir les zones et les planches de la ferme en volumes simples, colorés par culture, et faire défiler la saison semaine par semaine — d'abord sur ordinateur, pour préparer la saison (Q29).

**Dépend de** : T11 (plan des planches)
**Périmètre** : `apps/web/src/ecrans/plan3d/**` (nouveau), `apps/web/src/ecrans/plan/**` (entrée « Voir en 3D »), `apps/web/vite.config.ts`, `apps/web/budget.json` (nouveau budget dédié, pas celui du démarrage), `apps/web/e2e/**`

## Règles

- **Chargée à la demande** : `three` et `@react-three/fiber` (sans `drei`) ne sont téléchargés qu'à l'ouverture de la vue ; **zéro octet** ajouté au JS de démarrage (budget 71 Kio inchangé). Nouveau budget dédié à la vue 3D (environ 160 à 215 Kio gzip estimés), précaché pour le hors-ligne.
- **Données** : le plan existant (`construirePlan` de la vue 2D), sans nouvelle requête ; un adaptateur pur `versScene(plan, semaine)` produit les volumes (testable sans navigateur).
- **Rendu** : une zone = un socle, une planche = un volume dont la couleur suit la culture en place la semaine choisie (mêmes couleurs que la 2D), vide = neutre ; `InstancedMesh`, rendu à la demande (pas de boucle permanente).
- **Curseur de semaine** : change la semaine affichée, sans recharger.
- **Repli** : si WebGL manque ou si l'affichage rame (images trop lentes), retour automatique à la 2D avec un message ; une alternative texte accessible (liste des planches et cultures de la semaine).
- **Aucun calcul agronomique** dans la 3D : elle n'affiche que ce que le moteur a calculé.

## Critères d'acceptation

- [ ] Test unitaire de `versScene` : planches, couleurs par culture, semaine vide, zone sans planche.
- [ ] Test de build : rien de la 3D dans le JS de démarrage ; morceau 3D sous son budget dédié et dans le précache.
- [ ] e2e (ordinateur, grande ferme) : vue affichée en moins de 1 s après le chargement du module ; changer de semaine en moins de 100 ms ; navigation fluide (60 images/s visées, pas de rafale de plus de 2 images perdues).
- [ ] e2e : sans WebGL, repli sur la 2D avec message ; alternative texte présente.

**Hors périmètre** : forme réelle de la ferme (géométrie), sélection d'une planche et détail d'une série (T27b, T27c à spécifier), usage au champ.

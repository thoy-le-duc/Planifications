# T32b — Jumeau 3D : plants stylisés qui grandissent

**Objectif** : la scène place sur chaque planche des plants stylisés, dont la taille suit la semaine du curseur : tuteurs et feuillage pour la tomate, rosettes pour la salade, touffes, rampants, buissons (Q32). On voit l'avancement des cultures dans le temps.

**Dépend de** : T32a, T28c, T29b (faits pour les deux derniers)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/e2e/vue-3d*.e2e.ts` et `apps/web/e2e/fluidite-3d.ts` (bornes), `apps/web/budget.json` (seulement si hausse justifiée)

## Règles

- **Hauteur et stade du jour** : lus dans T32a pour la semaine du curseur, par occupation. Aucun calcul de croissance dans la scène.
- **Un plant par forme** : une géométrie partagée par forme (tuteur + feuillage, rosette, touffe, rampant, buisson, bulbe/racine), **instanciée** (`InstancedMesh`), à très peu de triangles (borne par plant fixée et testée, par exemple 40 à 60 triangles). Échelle verticale = hauteur du jour ; échelle horizontale bornée par l'écartement réel de l'itinéraire.
- **Nombre de plants par planche plafonné** (constante nommée) : au-delà, on espace ou on montre un plant sur N, jamais plus de dessin. Les plafonds sont **mesurés puis justifiés dans la PR** : nombre total de plants, appels de dessin, triangles par image et JavaScript par image, sur ferme T07, jumeau T07 et démo, contre les garde-fous de T29b (JS médian ≤ 4 ms, 95e centile ≤ 8 ms ; appels et triangles bornés par scénario). Les bornes e2e peuvent monter si, et seulement si, la PR chiffre le gain visuel et le coût, sans toucher à `IMAGES_PERDUES_MAX`, `PASSAGES_SACCADES_ECHEC`, `RAFALES_TOTAL_MAX`.
- **Vue d'ensemble lisible** : de loin (distance de la vue d'ensemble de T29), les plants se fondent en une masse colorée à la couleur du filtre T27b ; le détail n'apparaît qu'en approchant (niveau de détail simple : bascule sur un volume pour la planche entière, sans objet de plus par planche).
- **Filtres T27b, vol T29, bâches T28c inchangés** : une planche filtrée garde sa couleur, une bâche ne la cache pas, le vol fonctionne comme avant.
- **Rendu à la demande** : la boucle d'images ne tourne que pendant un vol ou un geste ; le curseur de semaine redessine une fois, sans animer de croissance.
- **Texte honnête** : une mention « Hauteurs indicatives, réglables dans la fiche de l'espèce » (lien vers T32c si fait) ; alternative texte et repli 2D inchangés.
- **Budget** : `jsVue3dGzKio` (220 Kio) tenu, ou hausse chiffrée et justifiée dans la PR ; JS de démarrage inchangé.

## Critères d'acceptation

- [ ] Tests de l'adaptateur : tomate à la semaine de mise en place → pas de plant ou plant minimal ; à la semaine de hauteur maximale → échelle = 2 m ; après arrachage → aucun plant ; deux planches de formes différentes → deux instances distinctes.
- [ ] Test : nombre de plants d'une planche plafonné ; une planche très longue ne dépasse pas le plafond ; nombre de triangles par plant dans la borne.
- [ ] Test : planche filtrée par T27b garde sa couleur avec les plants ; sélection et vol (T29) donnent le même cadrage qu'avant.
- [ ] e2e (ordinateur) : semaine à semaine, la hauteur du volume d'une planche de tomates augmente (lecture d'un attribut `data-` de la toile) ; mesures de T27 tenues (affichage < 1 s, semaine < 100 ms) ; garde-fous de T29b tenus avec les nouvelles bornes mesurées.
- [ ] e2e démo : la vue 3D de la démo montre des plants hors ligne.
- [ ] Capture avant/après (mi-mai et fin août, même point de vue) jointe à la PR, pour le « joli », jugé par Théophane.
- [ ] `pnpm verif` passe en entier. Budget `jsVue3dGzKio` tenu ou hausse justifiée.

## Risques

- Le coût par image sous WebGL logiciel (SwiftShader) : c'est le goulot connu (T29b, T29c). Si les plants le dépassent, réduire le plafond ou le détail plutôt que relever les seuils ; si impossible, terminer par un constat chiffré et une question.
- Beaucoup de plants sur de grandes fermes (4 ha) : le niveau de détail doit réellement retirer des instances, pas seulement les cacher.
- Le « joli » ne se teste pas : la capture sert de juge, pas de post-traitement ni d'ombres sans mesure.

**Hors périmètre** : animation de croissance continue, fruits et fleurs visibles, météo, modèles 3D importés, réglage des profils (T32c).

# T37b — 3D au téléphone : fluidité de près, filtres, et suites de T37

**Objectif** : que la 3D reste fluide et complète au téléphone, maintenant que les ouvriers s'en servent (Q36). Relecture de T37 (10 octobre) : la démo a été retouchée (fraises en retard d'un jour au lieu de dix, `apps/web/src/demo/remplir.ts`) pour que l'e2e n'arrive pas sur la gouttière de fraises vue de près, qui dépasse les garde-fous du téléphone (11 appels de dessin pour 9, 8 078 triangles pour 8 000). Ce défaut existe sur une vraie ferme.

**Dépend de** : T37
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/src/demo/remplir.ts` (remettre la donnée d'origine), e2e 3D

## Règles

- **Appels de dessin** : poteaux (pieds de gouttière, pergola) et tuteurs partagent un seul `InstancedMesh` (deux boîtes d'un mètre qui ne diffèrent que par l'échelle et la couleur d'instance).
- **Triangles** : le niveau de détail (`choisirDetail`, plants-rendu.ts) tient une enveloppe de triangles (constante nommée, plus basse sur écran étroit) au lieu du seul plafond de 200 plants ; les plants les plus proches d'abord.
- **Démo** : la donnée d'origine des fraises (retard de dix jours) est rétablie ; l'e2e de T37 passe dessus, garde-fous tenus.
- **Filtres au téléphone** : un bouton « Filtres » ouvre la légende, les filtres T27b et la liste des planches (alternative texte de la toile) ; rien n'est retiré au téléphone.
- **Mêmes travaux que l'écran Aujourd'hui** : les tâches cochées en attente de relecture disparaissent de la 3D comme de l'écran ; numéros identiques à l'écran au-delà de 25 tâches.
- Panneau : annonce `aria-live` quand « Suivant » change le travail actif ; message à l'écran si la lecture des travaux échoue.
- Pastilles : taille de la toile lue par fiber (`size`), pas de réécriture du style quand la caméra ne bouge pas ; une tâche sur plusieurs planches a une pastille sur chacune.

## Critères d'acceptation

- [ ] e2e téléphone (démo, données d'origine) : « Suivant » jusqu'à la gouttière de fraises vue de près, garde-fous T29b tenus (appels ≤ 9, triangles ≤ 8 000).
- [ ] Test : poteaux et tuteurs → un seul maillage instancié.
- [ ] Test : enveloppe de triangles respectée sur une planche très dense.
- [ ] Test : bouton « Filtres » au téléphone, liste des planches présente.
- [ ] Test : tâche cochée non relue → absente de la 3D comme de l'écran.
- [ ] `pnpm verif` passe en entier.

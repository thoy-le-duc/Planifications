# T32d — Jumeau 3D : jeunes plants visibles, plants découpés

**Objectif** : qu'on suive une culture dès la plantation. Aujourd'hui (captures du 9 octobre) la planche est un bloc épais qui cache tout plant de moins de 0,5 m, et la tomate haute ressemble à un mur plat.

**Dépend de** : T32b (fait)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/e2e/vue-3d*.e2e.ts` et `apps/web/e2e/fluidite-3d.ts` (bornes chiffrées seulement), `apps/web/budget.json` (voir Budget)

## Règles

- **Planche fine** quand elle porte des plants : une dalle de terre de quelques centimètres ; la couleur du filtre T27b passe sur un liseré ou la dalle, jamais sur un volume qui cache les plants. Planche vide et vue d'ensemble : inchangées (masse colorée de loin, T32b).
- **Jeunes plants visibles** : un plant de 5 cm se voit de près (échelle minimale lisible, pas d'enfouissement dans la planche).
- **Plants découpés** : la tomate (et toute forme `erige-tuteure`) se dessine plant par plant, chacun avec son tuteur ou sa ficelle, au plafond de T32b ; plus de mur continu. Les autres formes gardent l'étirement de T32b seulement si c'est plus lisible, à montrer en capture.
- Mêmes garde-fous que T32b : `InstancedMesh` par forme, plafonds `PLANTS_MAX_PAR_PLANCHE` / `PLANTS_MAX_TOTAL`, triangles par forme bornés, rendu à la demande, garde-fous T29b tenus ; aucun seuil de fluidité (`IMAGES_PERDUES_MAX`, `PASSAGES_SACCADES_ECHEC`, `RAFALES_TOTAL_MAX`) touché.
- **Budget** : vue 3D ≤ 228 Kio (Q33). Si c'est impossible, terminer par un constat chiffré et une question, sans relever.

## Critères d'acceptation

- [ ] Test : une planche portant des plants a une épaisseur rendue ≤ 5 cm ; vide, elle garde son volume actuel.
- [ ] Test : un plant de 5 cm a une hauteur rendue ≥ 5 cm au-dessus de la dalle (non caché).
- [ ] Test : une tomate de 20 plants donne 20 instances de plant et 20 tuteurs (dans les plafonds), pas une haie continue.
- [ ] e2e : `data-hauteurs-plants` inchangé dans son sens ; le test des plants de T32b reste vert.
- [ ] Captures avant/après (démo, Tunnel 2, S32 et S38, même caméra) jointes à la PR.
- [ ] `pnpm verif` passe en entier ; budgets tenus.

**Hors périmètre** : fruits et signaux de récolte (T32e), quinconce (T35b).

# T60 — Consignes par ouvrier : chacun ses travaux du jour

**Objectif** : réponse à Q44, suite de Q36 (« dire aux ouvriers : vous faites ça, ça, ça »). Le gérant **attribue** les travaux du jour à un membre de l'équipe ; chacun voit **les siens** dans Aujourd'hui et numérotés dans la 3D.

**Dépend de** : T09 (comptes et membres), T37 (travaux du jour en 3D), Aujourd'hui
**Périmètre** : `packages/core` (attribution), `packages/db` (attribution, migration), `apps/api/src/sync/**` (droits : seul le gérant attribue), `apps/web/src/ecrans/aujourdhui/**`, `apps/web/src/ecrans/plan3d/**`, `apps/web/src/ecrans/ferme/**` (équipe), tests, `docs/modele-donnees.md`
**Priorité** : haute (juste après T55). **Modèle** : Opus (droits, synchro).

## Règles

1. **Équipe** : les membres existants de la ferme (gérant, équipiers), avec un prénom affiché. Un ouvrier sans téléphone peut être ajouté **sans compte** (prénom seul) : ses consignes s'impriment ou se montrent sur le téléphone du gérant.
2. **Attribuer** : dans Aujourd'hui, le gérant appuie longuement sur un travail, ou utilise « Attribuer », et choisit une ou plusieurs personnes. Il peut aussi attribuer en lot tous les travaux d'une zone. C'est hors ligne, et cela reste annulable.
3. Le serveur refuse une attribution faite par un équipier (comme T32c pour les profils de croissance).
4. **Voir les siens** : un équipier ouvre Aujourd'hui sur « Mes travaux » par défaut, et « Tous » reste à un tap. Dans la 3D, ses travaux sont numérotés dans l'ordre du jour ; ceux des autres sont grisés. Un tap sur le numéro fait voler la caméra jusqu'à la planche (T37).
5. **Fiche du jour** par personne, imprimable, ou partagée en image : numéro, planche, travail, outil (et lieu de rangement quand T61 sera fait).
6. Une personne qui marque un travail « fait » le solde pour tout le monde, comme aujourd'hui.

## Critères d'acceptation

- [ ] Tests cœur : attribution à deux personnes ; « Mes travaux » filtre bien ; travail non attribué visible de tous.
- [ ] Test serveur : attribution par un équipier refusée ; par le gérant acceptée.
- [ ] Tests d'écran : attribution au doigt hors ligne, en lot par zone ; fiche du jour.
- [ ] Test 3D : numérotation propre à la personne, autres travaux grisés.
- [ ] Aujourd'hui garde son budget de temps ; `pnpm verif` passe.

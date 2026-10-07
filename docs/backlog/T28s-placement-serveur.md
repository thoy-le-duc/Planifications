# T28s — Placement réel : le serveur accepte, la porte écrit

**Objectif** : un placement fait sur un ordinateur (même hors ligne) arrive au serveur et redescend sur les autres appareils, sans jamais toucher une autre ferme.

**Dépend de** : T28a
**Périmètre** : `apps/api/src/sync/structure*.ts` (+ tests), `apps/api/src/sync/references.ts`, `apps/api/src/sync/messages.ts`, `packages/sync/src/porte.ts` (+ tests), `docs/modele-donnees.md` (règles d'écriture, section T10s)

## Règles

- Tables et champs acceptés : `batiment` (création, modification, suppression douce) ; `zone.contour` et champs de placement d'`emplacement` ; `ferme.origine_plan` seulement (aucun autre champ de `ferme`), et seulement s'il est nul ou si aucun placement n'existe encore dans la ferme.
- **Droits (Q31)** : **gérant seulement** pour tout placement (bâtiments, contours de zones, placement des planches, origine). Un équipier qui touche un de ces champs → refus explicite « Seul le gérant peut placer les éléments de la ferme. » Créer une zone ou une planche sans placement reste ouvert à tout membre actif (T10s).
- **Isolement** : `ferme_id` jamais changé ; `batiment.zone_id` d'une autre ferme = introuvable ; une ferme dont on n'est plus membre actif n'accepte rien. Relecture d'isolement jusqu'à zéro faille, comme T10s.
- **Validation** : `validerPlacement` et `validerContour` de `@planif/core` rejouées avant l'écriture, à l'identique ; taille bornée avant analyse (contour : 200 sommets, 16 Kio de JSON au plus, sinon refus sans parcourir) ; un bâtiment par zone au plus ; zone abritée sans contour ; message de refus en français.
- **Tout ou rien** avec le reste de l'envoi ; une ligne `modification` par ligne touchée.
- **Porte** (`packages/sync`) : une seule fonction d'écriture du placement, qui renvoie de quoi annuler (valeurs d'avant), utilisée par l'éditeur T28b.

## Critères d'acceptation

- [ ] Tests d'isolement : bâtiment dans une autre ferme, `zone_id` d'une autre ferme, changer `ferme_id`, changer `ferme.nom` ou `ferme.position` par la synchro, déplacer l'origine alors qu'un placement existe → refusés.
- [ ] Test : placement invalide (champs à moitié remplis, orientation 360, 6 km de l'origine, contour auto-intersectant, 201 sommets, JSON trop gros, contour sur une zone abritée) → refusé avec message clair, rien du lot écrit.
- [ ] Test de droits : un équipier (membre actif non gérant) qui crée un bâtiment, déplace une planche, change un contour ou pose l'origine → refusé avec le message ci-dessus ; le même envoi par le gérant passe ; un équipier peut toujours créer une planche sans placement.
- [ ] Test : suppression douce d'un bâtiment ; zone supprimée alors qu'un bâtiment l'abrite → refusée.
- [ ] Test de la porte : écrire puis annuler un déplacement rend les valeurs d'avant.
- [ ] e2e:synchro (si le banc tourne) : un bâtiment créé sur un navigateur apparaît sur le second.

**Hors périmètre** : écrans (T28b), 3D (T28c).

# T28s — Placement réel : le serveur accepte, la porte écrit

**Objectif** : un placement fait sur un ordinateur (même hors ligne) arrive au serveur et redescend sur les autres appareils, sans jamais toucher une autre ferme.

**Dépend de** : T28a
**Périmètre** : `apps/api/src/sync/structure*.ts` (+ tests), `apps/api/src/sync/references.ts`, `apps/api/src/sync/messages.ts`, `packages/sync/src/porte.ts` (+ tests), `docs/modele-donnees.md` (règles d'écriture, section T10s)

## Règles

- Tables et champs acceptés : `batiment` (création, modification, suppression douce) ; champs de placement de `zone` et `emplacement` ; `ferme.origine_plan` seulement (aucun autre champ de `ferme`), et seulement s'il est nul ou si aucun placement n'existe encore dans la ferme.
- **Droits** : comme le parcellaire (T10s), tout membre actif ; `ferme.origine_plan` réservé au gérant (**à confirmer par Théophane**, Q31).
- **Isolement** : `ferme_id` jamais changé ; `batiment.zone_id` d'une autre ferme = introuvable ; une ferme dont on n'est plus membre actif n'accepte rien. Relecture d'isolement jusqu'à zéro faille, comme T10s.
- **Validation** : `validerPlacement` de `@planif/core` rejouée avant l'écriture ; un bâtiment par zone au plus ; message de refus en français.
- **Tout ou rien** avec le reste de l'envoi ; une ligne `modification` par ligne touchée.
- **Porte** (`packages/sync`) : une seule fonction d'écriture du placement, qui renvoie de quoi annuler (valeurs d'avant), utilisée par l'éditeur T28b.

## Critères d'acceptation

- [ ] Tests d'isolement : bâtiment dans une autre ferme, `zone_id` d'une autre ferme, changer `ferme_id`, changer `ferme.nom` ou `ferme.position` par la synchro, déplacer l'origine alors qu'un placement existe → refusés.
- [ ] Test : placement invalide (champs à moitié remplis, orientation 360, 6 km de l'origine) → refusé avec message clair, rien du lot écrit.
- [ ] Test : suppression douce d'un bâtiment ; zone supprimée alors qu'un bâtiment l'abrite → refusée.
- [ ] Test de la porte : écrire puis annuler un déplacement rend les valeurs d'avant.
- [ ] e2e:synchro (si le banc tourne) : un bâtiment créé sur un navigateur apparaît sur le second.

**Hors périmètre** : écrans (T28b), 3D (T28c).

# T28d — Éditeur de placement : contours de zones en formes libres

**Objectif** : tracer sur la photo aérienne le vrai contour d'une zone de plein champ (îlot, verger, parcelle en L), sommet par sommet (Q31).

**Dépend de** : T28b (même écran)
**Périmètre** : `apps/web/src/ecrans/placement/**`, `apps/web/e2e/**`

## Règles

- **Tracer** : choisir une zone sans serre, poser les sommets au clic, fermer en cliquant sur le premier sommet (ou Entrée).
- **Modifier** : glisser un sommet ; clic sur un côté = ajouter un sommet au milieu ; Suppr ou clic droit = retirer un sommet (jamais sous 3).
- **Clavier** : Tab passe d'un sommet à l'autre, flèches = 0,1 m (Maj = 1 m), Inser = ajouter après, Suppr = retirer ; liste des sommets (x, y) éditable dans le panneau.
- **Validation en direct** par `validerContour` (T28a) : un contour invalide (côtés croisés, trop de sommets) est montré en rouge avec le message, et « Enregistrer » reste inactif.
- Zone abritée par une serre : pas de contour à tracer (sa forme est celle de la serre), message explicatif.
- Écriture par la porte, confirmation puis « Annuler » comme T28b ; gérant seulement, lecture seule sinon.
- Budget dédié de T28b tenu (ou hausse justifiée).

## Critères d'acceptation

- [x] Tests des gestes en fonctions pures : ajouter, déplacer, retirer un sommet ; retirer sous 3 refusé ; fermeture du tracé.
- [x] e2e : tracer une zone en L de 6 sommets, enregistrer, annuler → retour exact ; recharger → contour conservé.
- [x] e2e : croiser deux côtés → message et « Enregistrer » inactif.
- [x] e2e clavier seul : déplacer un sommet de 1 m et enregistrer.

**Hors périmètre** : trous dans une zone, aimantation sur les bords de la photo, import d'un contour cadastral.

# T35a — Itinéraire : rangs alignés ou en quinconce, et leur schéma

**Objectif** (Q34) : dans la fiche de l'itinéraire, voir tout de suite comment les plants sont posés sur la planche : nombre de rangs, écartement sur le rang, et rangs alignés ou en quinconce. Un petit schéma se met à jour pendant la saisie.

**Dépend de** : rien
**Périmètre** : `packages/core/src/domaine/**` et `packages/core/src/planification/**` (type et validation de la densité), import et export du cœur (`packages/core/src/import/**`, `packages/core/src/export/**`) seulement pour le nouveau champ, validation côté serveur si elle existe pour la densité (`apps/api/src/sync/**`), `apps/web/src/ecrans/itineraires/**`, documentation `docs/modele-donnees.md`.

## Règles

- **Nouveau champ** dans la densité « écartement » de l'itinéraire : `disposition`, `alignee` ou `quinconce`, **facultatif, `alignee` par défaut** (aucune ligne existante réécrite, aucune migration si la densité est en jsonb : le dire dans la PR). Copié dans l'instantané de la série comme le reste de l'itinéraire.
- **Le nombre de plants ne change pas** : les calculs de besoins (T05) et leurs tests restent identiques ; un test le prouve.
- **Schéma** dans le formulaire de l'itinéraire, densité « écartement » : vue de dessus d'un tronçon de planche (largeur de la planche si connue, sinon 1,2 m par défaut, à dire), les rangs et les plants en points, l'écartement sur le rang coté, le décalage d'un demi-écartement entre rangs voisins en quinconce. SVG pur, sans bibliothèque, mis à jour à chaque frappe sans ralentir la saisie (< 16 ms par mise à jour mesurée en test). Lisible au téléphone, avec une alternative texte (« 3 rangs en quinconce, un plant tous les 30 cm »).
- Choix alignés / quinconce par deux boutons larges (gants), visible seulement à partir de 2 rangs.
- Export JSON et CSV : le champ y figure ; l'import l'accepte (« quinconce », « alignés ») ou le laisse vide.

## Critères d'acceptation

- [ ] Tests du cœur : densité sans `disposition` → `alignee` ; valeur inconnue refusée en français ; besoins en plants identiques en alignés et en quinconce.
- [ ] Test du schéma : 1 rang → pas de choix de disposition ; 3 rangs en quinconce → les plants du rang 2 décalés d'un demi-écartement ; la cote affiche l'écartement saisi ; l'alternative texte décrit la disposition.
- [ ] Test : saisie de l'écartement → schéma mis à jour en moins de 16 ms.
- [ ] Test d'export / import : le champ fait l'aller-retour.
- [ ] `pnpm verif` passe en entier ; JS de démarrage inchangé (le schéma vit dans le morceau de l'écran Itinéraires).

**Hors périmètre** : 3D en quinconce (T35b), écartement entre rangs et passe-pied (non retenus).

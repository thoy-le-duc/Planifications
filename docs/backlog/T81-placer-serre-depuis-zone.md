# T81 — Placer une serre depuis sa zone, en un geste

**Objectif** : demande de Théophane (2026-10-22). Pour placer le tunnel « Manon 1 », il a tracé son contour à la main, sommet par sommet. Le tour n'est pas droit, et les planches rangées dedans partent de travers. Une serre ou un tunnel est un rectangle : il doit se poser comme un rectangle, depuis la zone, sans créer un bâtiment à part puis l'associer.

**Dépend de** : T28b, T28d, T28h, T61
**Périmètre** : `apps/web/src/ecrans/placement/**`, `packages/core/src/placement/**` (si un calcul manque), tests
**Priorité** : haute (bloque le placement réel de la ferme). **Domaine critique** : non (aucune nouvelle table, aucun nouveau droit ; l'écriture passe par les bâtiments et les zones existants, déjà contrôlés par le serveur, gérant seulement).

## Règles

1. Dans l'éditeur, une zone de type **tunnel** ou **serre** sans bâtiment propose **« Placer la serre »** à la place de « Tracer le contour ».
2. « Placer la serre » pose un rectangle sur la photo, au centre de la vue. Longueur et largeur sont pré-remplies : celles du dernier bâtiment du même type de la ferme, sinon 30 m × 8 m. Le rectangle a des poignées pour le déplacer, le tourner et l'étirer, et des champs en mètres pour saisir les mesures exactes. Le nom du bâtiment est celui de la zone.
3. Un seul « Enregistrer » crée le bâtiment (type serre tunnel pour une zone tunnel, serre chapelle pour une zone serre) **et** le rattache à la zone (zone abritée). Les deux écritures partent ensemble ; « Annuler » (comme dans l'éditeur) retire les deux.
4. Une zone tunnel ou serre qui a **déjà un contour** tracé à la main (cas de Manon 1) propose **« Remplacer par une serre »**. Le rectangle part du rectangle de surface minimale qui englobe le contour : même centre, orientation du plus long côté. Après confirmation, le contour est effacé (règle existante, T28b) et la serre le remplace.
5. Les planches de la zone sans placement propre se rangent ensuite droit dans le rectangle (rangement automatique existant). Les planches déjà placées gardent leur position dans le repère de la zone.
6. Le contour libre reste proposé pour le **plein champ** et le **hors-sol** sans abri.
7. Au doigt (T28k) : mêmes gestes, poignées assez grandes pour un pouce.

## Critères d'acceptation

- [ ] Test cœur : rectangle englobant minimal d'un contour à 4 sommets un peu de travers → centre, longueur, largeur et orientation attendus (exemple chiffré dans le test).
- [ ] Test d'écran : zone tunnel sans bâtiment → « Placer la serre », Enregistrer → un bâtiment `serre_tunnel` rattaché à la zone, en une seule action annulable.
- [ ] Test d'écran : zone avec contour → « Remplacer par une serre », confirmation, contour effacé, bâtiment rattaché.
- [ ] Test : zone de plein champ → toujours « Tracer le contour ».
- [ ] e2e de l'éditeur : placer une serre, recharger, la serre et la zone sont liées.
- [ ] Budgets respectés ; `pnpm verif` passe.

## Hors périmètre

Serres multichapelles (une zone parente et ses chapelles) : ticket à part si besoin. Largeur type des tunnels de la ferme : question posée à Théophane le 2026-10-22 (la valeur par défaut de 8 m s'ajustera à sa réponse).

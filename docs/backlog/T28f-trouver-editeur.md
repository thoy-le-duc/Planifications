# T28f — Plan de la ferme : trouver et ouvrir l'éditeur

**Objectif** : que Théophane trouve l'éditeur de placement depuis la vue 3D, y compris dans la démo (Q32). Aujourd'hui l'éditeur n'est accessible que par l'onglet Ferme, carte « Plan de la ferme », « Placer sur la photo aérienne », sur ordinateur ; rien dans la 3D n'y mène, et la démo n'en montre rien.

**Dépend de** : T28b, T28e (faits)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, `apps/web/src/ecrans/plan/EcranPlan.tsx`, `apps/web/src/ecrans/ferme/EcranFerme.tsx` (libellés, ouverture partagée), `apps/web/src/demo/**`, `apps/web/e2e/` (un scénario)

## Règles

- **Bouton « Modifier le plan »** dans la vue 3D, visible seulement pour le gérant, sur ordinateur (même condition que l'éditeur, T28b). Il ouvre le même éditeur que la carte « Plan de la ferme » : une seule façon de l'ouvrir dans le code (le chargement paresseux d'`EcranFerme` est partagé, pas copié).
- **Ferme sans placement** (aucune zone avec contour, aucun bâtiment, aucune planche positionnée) : la 3D affiche un encart « Placez votre ferme sur la photo aérienne » avec ce bouton. Non gérant ou téléphone : l'encart dit qui peut le faire (« Le gérant place la ferme depuis un ordinateur »), sans bouton.
- **À la fermeture de l'éditeur**, retour sur la vue 3D, qui montre le placement enregistré.
- **Démo** : l'éditeur s'ouvre (rôle gérant, ferme fictive). Les tuiles IGN sont refusées hors réseau : fond neutre, message « Photo aérienne indisponible hors ligne » (T28e), l'édition reste possible. Vérifier d'abord que cela marche tel quel et corriger sinon ; les modifications faites en démo restent locales, comme le reste de la démo.
- **Libellés** : la carte de l'onglet Ferme et le bouton disent la même chose, en clair : « Modifier le plan » et « Placer sur la photo aérienne » restent rapprochés (le détail de la carte cite la 3D).
- **Budget** : l'éditeur reste chargé au tap ; `jsInitialGzKio` inchangé, `jsVue3dGzKio` tenu.

## Critères d'acceptation

- [x] Test : gérant sur ordinateur, vue 3D ouverte → bouton « Modifier le plan » présent ; tap → l'éditeur s'ouvre ; fermeture → retour sur la 3D.
- [x] Test : non gérant, ou téléphone → pas de bouton.
- [x] Test : ferme sans placement → encart « Placez votre ferme sur la photo aérienne » avec le bouton (gérant) ; avec un seul bâtiment placé → plus d'encart.
- [x] e2e démo : depuis la vue 3D de la démo, « Modifier le plan » ouvre l'éditeur, fond neutre hors réseau, un bâtiment peut être posé.
- [x] Les tests de l'onglet Ferme (ouverture de l'éditeur) passent sans modification.
- [x] `pnpm verif` passe en entier. JS de démarrage inchangé.

## Risques

- La démo tourne sans serveur : si l'éditeur suppose une porte d'écriture absente en démo, la correction est dans `apps/web/src/demo/**`, pas dans l'éditeur.
- Deux chemins d'ouverture : bien partager le chargement paresseux, sinon le morceau de l'éditeur est dupliqué ou préchargé et le budget de démarrage bouge.

**Hors périmètre** : édition directement dans la scène 3D, éditeur au téléphone, nouveaux outils de l'éditeur.

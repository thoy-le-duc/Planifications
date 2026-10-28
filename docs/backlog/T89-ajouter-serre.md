# T89 — « Ajouter une serre ou un tunnel » : une fiche, un tap, tout est en place

**Objectif** : demande de Théophane (2026-10-28) : « je dois faire Modifier le plan, Nouveau bâtiment, serre tunnel, longueur, largeur, je le glisse par-dessus mes planches… c'est pas du tout intuitif. » Aujourd'hui il y a deux chemins pour une serre (« Nouveau bâtiment », 30 × 8 m, rattachement à la main ; « Placer la serre », 40 × 9,6 m, depuis une zone créée avant dans Parcellaire), puis le découpage et les planches se font ailleurs. Un seul chemin les remplace.

**Dépend de** : T87, T88
**Périmètre** : `apps/web/src/ecrans/placement/**`, `packages/core/src/placement/**` (calcul pur de la grille et des planches), tests
**Priorité** : haute (chantier du plan). **Domaine critique** : non si l'écriture passe par les portes existantes (zones, emplacements, bâtiment, placements) en un seul enregistrement ; **critique** si le développeur doit toucher l'API ou la synchro : le signaler au chef avant.

## Règles

1. En modification (T87), un bouton **« Ajouter »** propose : **Serre ou tunnel**, **Parcelle de plein champ** (chemin T85 existant), **Bâtiment** (hangar, local, chambre froide, magasin, autre : sans zone ni planche).
2. Fiche **Serre ou tunnel**, sur un seul écran, dans cet ordre :
   - Nom (ex. « Serre à légumes ») ;
   - Largeur d'une chapelle (m), Nombre de chapelles ;
   - Longueur d'un tronçon (m), Nombre de tronçons, Allée entre tronçons (m, affichée seulement si plus d'un tronçon) ;
   - Nom des zones : préfixe (par défaut le nom de la serre), numérotées 1, 2, 3… dans l'ordre de T88 ;
   - Planches par zone : nombre, largeur (cm), longueur (m), passe-pied (cm), dans la longueur de la serre ;
   - un résumé calculé : « 57,6 × 128,8 m, 18 zones, 144 planches ».
3. **Valeurs par défaut** : celles de la dernière serre créée sur la ferme ; sinon chapelle 9,6 m, 1 chapelle, tronçon 40 m, 1 tronçon, allée 4,40 m, planches de 75 cm, passe-pied 45 cm (T85), longueur des planches = longueur du tronçon − 2 m, nombre = le plus grand n tel que n × largeur + (n − 1) × passe-pied ≤ largeur de chapelle (9,6 m → 8 planches). Tous modifiables. À confirmer par Théophane (Q55) : seules les valeurs par défaut en dépendent.
4. **« Créer »** : écrit au brouillon le bâtiment (dimensions totales, `nb_chapelles`, `nb_troncons`, `largeur_allee_m`, type `serre_tunnel` si 1 chapelle sinon `serre_chapelle`), la zone abritée (nom de la serre), une sous-zone par case, les emplacements de chaque sous-zone (codes P1…Pn) rangés dans leur case (règle T86/T88), le tout posé **au centre de la vue**, choisi, prêt à glisser et tourner. Un seul « Enregistrer », « Annuler » retire tout.
5. **Partir d'une zone existante** (Théophane a déjà saisi Manon 1, 2, 3 dans Parcellaire) : depuis le panneau d'une zone tunnel ou serre sans bâtiment, « Placer la serre » ouvre **la même fiche**, préremplie avec le nombre de sous-zones existantes ; les sous-zones et planches existantes sont reprises (ordre naturel), seules les manquantes sont créées.
6. Les deux anciens chemins pour une serre disparaissent : « Nouveau bâtiment » ne propose plus les types serre (voir T92 pour le reste du nettoyage).

## Critères d'acceptation

- [ ] Test cœur : défauts (8 planches dans 9,6 m), résumé de la serre à légumes (57,6 × 128,8 m, 18 zones, 144 planches), tunnel Manon (28,8 × 40 m, 3 zones).
- [ ] Test d'écran : fiche serre à légumes → « Créer » → un brouillon avec 1 bâtiment, 1 zone, 18 sous-zones nommées « Serre à légumes 1 » à « 18 », 144 emplacements placés ; Enregistrer → un seul enregistrement ; Annuler → rien.
- [ ] Test d'écran : zone « Tunnel Manon » avec Manon 1, 2, 3 et leurs planches → « Placer la serre » → fiche à 3 chapelles, aucune zone ni planche dupliquée.
- [ ] Test d'écran : les défauts reprennent la dernière serre créée.
- [ ] e2e : créer la serre à légumes au téléphone, enregistrer, recharger, tout est en place ; temps d'affichage de la fiche dans le budget.
- [ ] Budgets respectés (fiche chargée à la demande si besoin) ; `pnpm verif` passe.

## Hors périmètre

Dupliquer (T90). Planches en travers de la serre, planches de tailles différentes dans une même zone.

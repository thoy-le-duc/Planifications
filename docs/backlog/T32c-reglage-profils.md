# T32c — Profils de croissance : réglage par la ferme (écran)

**Objectif** : que la ferme corrige hauteur, durée et forme d'une espèce depuis l'écran Itinéraires culturaux (Q39), et voie l'effet dans la 3D (Q32). Les défauts de la bibliothèque restent lisibles et rétablissables.

**Dépend de** : T32a (stockage et migration faits), T32b
**Périmètre** : `apps/web/src/ecrans/itineraires/**` (Q39 : le réglage vit dans l'écran Itinéraires culturaux), aucune migration (faite en T32a), `packages/core` (validation du profil, règle de l'asperge), `apps/api/src/sync/**` (droit du gérant sur `profil_croissance`), `docs/modele-donnees.md`

## Règles

- Dans l'écran Itinéraires culturaux, sur le groupe de chaque espèce de la ferme : un bouton « Croissance » ouvre le réglage : forme (liste), hauteur maximale (m), durée jusqu'à la hauteur maximale (jours), avec la valeur par défaut affichée à côté ; « Rétablir la valeur par défaut » en un tap.
- Validation par le cœur (hauteur > 0 et ≤ 6 m, durée > 0, forme connue) ; messages en français ; écriture par la porte comme les autres champs de l'espèce, **par le gérant seulement** (Q35, 2026-10-09). Un équipier voit les valeurs sans pouvoir les modifier.
- **Serveur** : un envoi qui modifie `profil_croissance` d'une espèce par un utilisateur qui n'est pas gérant de la ferme est refusé en entier, avec une précision en français ; les autres champs de l'espèce gardent leurs droits ordinaires. Aujourd'hui (T32a) tout membre peut l'écrire : c'est ce ticket qui ferme cette porte. Sécurité : relecture jusqu'à zéro faute.
- Espèce de la bibliothèque commune : profil en lecture seule, avec « Espèce de la bibliothèque : personnalisez-la pour régler sa croissance » (le bouton « Personnaliser » vient avec T32g, Q39).
- Saisie rapide au pouce : champs numériques larges, pas de formulaire long.
- Le profil suit la synchro et l'export déjà posés par T32a.
- Rien d'IA ici : valeurs saisies à la main.

## Critères d'acceptation

- [ ] Test : modifier la hauteur de la tomate à 1,8 m → la hauteur maximale de T32a est 1,8 m ; rétablir → 3 m (défaut depuis Q33).
- [ ] Test : valeur hors bornes refusée avec message ; deux téléphones hors ligne qui modifient le même profil → règle de fusion existante des espèces appliquée.
- [ ] Test serveur : un équipier qui envoie un `profil_croissance` modifié → refus de tout l'envoi ; le gérant → accepté ; un équipier qui modifie un autre champ de l'espèce → accepté comme avant.
- [ ] Test écran (écran Itinéraires) : un équipier voit le profil en lecture seule ; une espèce de la bibliothèque aussi, même pour le gérant.
- [ ] Test : asperge réglée par la ferme → toujours pas de fougère pendant la récolte (règle portée par un champ du profil).
- [ ] Export : le profil réglé apparaît dans l'export complet.
- [ ] `pnpm verif` passe en entier ; écran de la fiche sous 300 ms (budget habituel).

## Risques

- **Asperge après récolte (relecture T32b)** : la règle Q33 « fougère seulement après la fin de récolte » est reconnue par identité de l'objet profil par défaut (`defauts.ts`). Un profil enregistré par la ferme, même identique, la perd. Avant d'ouvrir le réglage, porter cette règle par un vrai champ du profil, avec un test « asperge réglée par la ferme : toujours pas de fougère pendant la récolte ».
- Dépend de la colonne et de la synchro de T32a : ne pas commencer avant.
- Un profil trop libre produit une 3D absurde : bornes strictes, valeur par défaut toujours visible.

**Hors périmètre** : courbes de croissance saisies point par point, import de profils, profils par variété ou par série.

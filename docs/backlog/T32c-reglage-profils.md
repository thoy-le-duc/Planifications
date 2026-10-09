# T32c — Profils de croissance : réglage par la ferme (écran)

**Objectif** : que la ferme corrige hauteur, durée et forme d'une espèce depuis la fiche de l'espèce, et voie l'effet dans la 3D (Q32). Les défauts de la bibliothèque restent lisibles et rétablissables.

**Dépend de** : T32a (stockage et migration faits), T32b
**Périmètre** : `apps/web/src/ecrans/bibliotheque/**` (ou l'écran des espèces existant), aucune migration (faite en T32a), `packages/core` (validation du profil), `docs/modele-donnees.md`

## Règles

- Dans la fiche de l'espèce : forme (liste), hauteur maximale (m), durée jusqu'à la hauteur maximale (jours), avec la valeur par défaut affichée à côté ; « Rétablir la valeur par défaut » en un tap.
- Validation par le cœur (hauteur > 0 et ≤ 6 m, durée > 0, forme connue) ; messages en français ; écriture par la porte comme les autres champs de l'espèce, tout membre de la ferme (droits ordinaires d'une espèce, décision du chef du 2026-10-08) pour la bibliothèque de la ferme.
- Saisie rapide au pouce : champs numériques larges, pas de formulaire long.
- Le profil suit la synchro et l'export déjà posés par T32a.
- Rien d'IA ici : valeurs saisies à la main.

## Critères d'acceptation

- [ ] Test : modifier la hauteur de la tomate à 1,8 m → la hauteur maximale de T32a est 1,8 m ; rétablir → 2 m.
- [ ] Test : valeur hors bornes refusée avec message ; deux téléphones hors ligne qui modifient le même profil → règle de fusion existante des espèces appliquée.
- [ ] Export : le profil réglé apparaît dans l'export complet.
- [ ] `pnpm verif` passe en entier ; écran de la fiche sous 300 ms (budget habituel).

## Risques

- **Asperge après récolte (relecture T32b)** : la règle Q33 « fougère seulement après la fin de récolte » est reconnue par identité de l'objet profil par défaut (`defauts.ts`). Un profil enregistré par la ferme, même identique, la perd. Avant d'ouvrir le réglage, porter cette règle par un vrai champ du profil, avec un test « asperge réglée par la ferme : toujours pas de fougère pendant la récolte ».
- Dépend de la colonne et de la synchro de T32a : ne pas commencer avant.
- Un profil trop libre produit une 3D absurde : bornes strictes, valeur par défaut toujours visible.

**Hors périmètre** : courbes de croissance saisies point par point, import de profils, profils par variété ou par série.

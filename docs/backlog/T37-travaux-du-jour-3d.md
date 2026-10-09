# T37 — 3D au téléphone : les travaux du jour, pour les ouvriers

**Objectif** (Q36) : « Je veux pouvoir dire aux ouvriers : vous allez faire ça, ça et ça, et qu'ils se repèrent facilement. » La vue 3D montre les travaux prévus aujourd'hui, numérotés sur les planches ; un tap sur un travail fait voler la caméra jusqu'à sa planche.

**Dépend de** : T29 (vol), T22 (travaux prévus), écran Aujourd'hui (T13)
**Périmètre** : `apps/web/src/ecrans/plan3d/**`, lecture des travaux du jour (réutiliser le calcul de l'écran Aujourd'hui, sans le dupliquer), e2e 3D

## Règles

- Mêmes travaux que l'écran Aujourd'hui pour la date du jour (même source, même ordre). Aucune écriture.
- Dans la 3D : une pastille numérotée au-dessus de chaque planche concernée (instanciée, lisible de loin, même principe que la balise de récolte T32e) ; un panneau « Travaux du jour » liste « 1. Repiquer salades — Tunnel 2, P4 » etc.
- Un tap sur une ligne fait voler la caméra (T29) jusqu'à la planche et la met en évidence ; « Suivant » passe au travail suivant.
- Au téléphone : panneau repliable en bas, gros caractères ; fonctionne hors ligne.
- Pour tous les membres (pas d'attribution par ouvrier dans ce ticket).
- Garde-fous de fluidité T29b ; budget de la vue 3D tenu ou hausse chiffrée.

## Critères d'acceptation

- [ ] Test : trois travaux du jour sur deux planches → deux pastilles, numéros dans l'ordre de l'écran Aujourd'hui.
- [ ] Test : tap sur le travail 2 → vol vers sa planche, planche mise en évidence.
- [ ] e2e téléphone (démo) : panneau visible, tap → la caméra arrive sur la planche.
- [ ] `pnpm verif` passe en entier.

**Hors périmètre** : attribution des travaux par ouvrier, cocher un travail depuis la 3D.

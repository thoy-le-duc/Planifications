# T13 — Saisie terrain hors ligne : réalisé et récolte

**Objectif** : au champ, téléphone en main, cocher ce qui est fait et noter une récolte en trois gestes, même sans réseau.

**Dépend de** : T06, T10
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`, `apps/web/e2e/aujourdhui.e2e.ts`

## Règles

- Écran d'accueil « Aujourd'hui » : le semainier de la semaine (T06), en retard d'abord.
- « Fait » sur une tâche : crée le réalisé de l'étape à la date du jour, en un geste ; date modifiable ensuite.
- Récolte : série (proposée d'après les récoltes en cours) → quantité (pavé numérique géant) → unité (préremplie depuis la culture). Trois gestes, puis enregistrement.
- Chaque saisie affiche « Annuler » pendant 10 secondes, puis reste annulable depuis l'historique.
- Cibles tactiles d'au moins 56 px (utilisable avec des gants), contraste suffisant en plein soleil.
- Tout fonctionne sans réseau ; un indicateur discret montre le nombre de saisies en attente d'envoi.

## Critères d'acceptation

- [ ] Test Playwright hors ligne : marquer une plantation comme faite, noter 12 kg de tomates, recharger l'appli toujours hors ligne, les deux saisies sont là.
- [ ] Test : la récolte crée l'entrée en stock correspondante (mouvement de stock).
- [ ] Test : « Annuler » supprime la saisie et son mouvement de stock.
- [ ] Écran « Aujourd'hui » affiché en moins de 300 ms, CPU ralenti ×4, hors ligne.

**Hors périmètre** : interventions, irrigation, traitements, observations (tickets suivants), saisie vocale (phase 2).

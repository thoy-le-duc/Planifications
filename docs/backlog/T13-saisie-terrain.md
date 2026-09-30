# T13 — Saisie terrain hors ligne : réalisé et récolte

**Objectif** : au champ, téléphone en main, cocher ce qui est fait et noter une récolte en trois gestes, même sans réseau.

**Dépend de** : T06, T10, T10c (le serveur accepte le stock), T11 (base locale ouverte dans l'appli)
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`, `apps/web/e2e/aujourdhui.e2e.ts`, et (décision du chef) `apps/web/src/App.tsx` (onglet branché), `apps/web/src/donnees/amorcer.ts` (jeu `aujourdhui`), la porte de `packages/sync` (écriture de plusieurs lignes en une transaction), `packages/core/src/index.ts` (export de `semainier`)

## Règles

- Écran d'accueil « Aujourd'hui » : le semainier de la semaine (T06), en retard d'abord.
- « Fait » sur une tâche : crée le réalisé de l'étape à la date du jour, en un geste ; date modifiable ensuite.
- Récolte : série (proposée d'après les récoltes en cours) → quantité (pavé numérique géant) → unité (préremplie depuis la culture). Trois gestes, puis enregistrement.
- Chaque saisie affiche « Annuler » pendant 10 secondes, puis reste annulable depuis l'historique. Les événements sont en ajout seul (modèle Q10) : annuler écrit un événement d'annulation qui remplace la saisie, et un mouvement de stock inverse ; rien n'est supprimé.
- Cibles tactiles d'au moins 56 px (utilisable avec des gants), contraste suffisant en plein soleil.
- Tout fonctionne sans réseau ; un indicateur discret montre le nombre de saisies en attente d'envoi.

## Décisions du chef (2026-09-30, après les tests)

- **Serveur** : l'acceptation des lignes de stock envoyées par un téléphone fait l'objet de T10c, dont la PR passe avant celle-ci. Le test de synchro à deux téléphones y est écrit.
- **Interprétations des tests retenues :**
  - le mouvement inverse est rattaché à l'événement d'annulation ;
  - l'annulation et la correction reprennent le détail de l'original ;
  - l'unité vient de `espece.unite_recolte` ;
  - « récoltes en cours » = la fenêtre de récolte contient aujourd'hui ;
  - l'historique couvre au moins 7 jours ;
  - « Fait » sur un début de récolte ouvre la récolte ;
  - toutes les cibles font au moins 56 px, « Retour » compris ;
  - l'écran est mesuré au tap sur l'onglet, la base étant ouverte (voir Q19).
- **Touche virgule** : les kilos se pèsent au dixième (12,5 kg). Le pavé a une touche « , » à la place du micro de la maquette ; la saisie vocale viendra en phase 2. Un test à ajouter par le testeur.

## Critères d'acceptation

- [ ] Test Playwright hors ligne : marquer une plantation comme faite, noter 12 kg de tomates, recharger l'appli toujours hors ligne, les deux saisies sont là.
- [ ] Test : la récolte crée l'entrée en stock correspondante (mouvement de stock).
- [ ] Test : « Annuler » retire la saisie et son effet sur le stock des vues (événement d'annulation et mouvement inverse, envoyés par la synchro).
- [ ] Écran « Aujourd'hui » affiché en moins de 300 ms, CPU ralenti ×4, hors ligne.

**Hors périmètre** : interventions, irrigation, traitements, observations (tickets suivants), saisie vocale (phase 2).

# T13c — Aujourd'hui : suites de la relecture

**Objectif** : la journée se relit vite après une saisie, l'écran d'accueil n'attend pas Planches, et deux détails de la saisie sont corrigés.

**Dépend de** : T13b
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`, `apps/web/src/App.tsx` (préchargement)

## Règles (reprises de T13b, découpage du 2026-10-01)

- **Relecture incrémentale** : après une saisie, ne recalculer que ce qui a changé, si la mesure de T13b dépasse 500 ms sur le grand jeu.
- **Au lancement**, Aujourd'hui (écran d'accueil) n'attend plus le préchargement de Planches.
- **Masque des tâches faites** (vérification T13) : le retirer dès qu'une journée relue arrive. Sinon, un réalisé annulé depuis un autre téléphone laisse « Fait » sans effet.
- **Focus après « Changer la date »** : le rendre à l'entrée corrigée ou au titre de l'historique, au lieu de le laisser tomber sur `body`.

- **Isolement (contre-relecture T13b, déjà vrai sur `main`)** : emplacements, espèces et variétés de la journée sont lus par identifiant, sans filtre de ferme. Filtrer par la ferme affichée.

## Critères d'acceptation

- [ ] Grand jeu de T13b, CPU ×4 : relecture après une saisie en moins de 500 ms.
- [ ] Au lancement, Aujourd'hui s'affiche sans attendre Planches (test).
- [ ] Un réalisé annulé ailleurs fait revenir la tâche dès la journée relue (test).
- [ ] Après « Changer la date », le focus est sur l'entrée corrigée (test).
- [ ] Un emplacement, une espèce ou une variété d'une autre ferme n'apparaît jamais dans la journée (test).

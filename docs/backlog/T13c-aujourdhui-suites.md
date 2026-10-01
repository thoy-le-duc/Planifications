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

## Décisions (chef, 2026-10-01)

- Lancement : Aujourd'hui attend le début du préchargement de Planches **au plus 400 ms** (`ATTENTE_PLAN_MAX_MS`). Sans aucune attente, les deux lectures se disputent la base et le premier tap sur Planches passe de 140 à ~700 ms (budget 300 ms).
- Relecture incrémentale : chaque saisie de l'écran annonce sa culture ; seule cette culture est relue. Une synchro (changement non annoncé) relit tout ; une relecture complète de sécurité suit 4 s après la dernière saisie. Dans le cas rare d'une synchro arrivée dans le même avis qu'une saisie, une tâche faite ailleurs peut rester affichée jusqu'à la première pause de 4 s.
- Dernière récolte à date égale : la dernière saisie (horodatage, puis id), au lieu de l'ordre des lignes lues.
- Une campagne dont la plantation appartient à une autre ferme est masquée.

## Critères d'acceptation

- [x] Grand jeu de T13b, CPU ×4 : relecture après une saisie en moins de 500 ms.
- [x] Au lancement, Aujourd'hui s'affiche sans attendre Planches (test).
- [x] Un réalisé annulé ailleurs fait revenir la tâche dès la journée relue (test).
- [x] Après « Changer la date », le focus est sur l'entrée corrigée (test).
- [x] Un emplacement, une espèce ou une variété d'une autre ferme n'apparaît jamais dans la journée (test).

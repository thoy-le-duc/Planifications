# T13g — Aujourd'hui : instantané avant la base, « Fait » en file au lancement

**Objectif** : l'écran Aujourd'hui s'affiche à froid bien sous 1 s, indépendamment de l'ouverture de la base, et aucun « Fait » tapé au lancement n'est perdu.

**Dépend de** : T13d
**Périmètre** : `apps/web/src/ecrans/aujourdhui/**`, `apps/web/src/App.tsx`, `apps/web/src/donnees/ferme-active.ts`

## Constat (relecture T13d)

- L'instantané ne s'affiche qu'une fois la base ouverte (≈ 600 à 800 ms) : la marge sous 1 s est d'environ 170 ms sur la grande ferme, risque d'instabilité en CI.
- Au lancement, pendant la lecture ciblée d'un premier « Fait », les taps suivants ne font rien, sans message.
- Le JS de démarrage est à 70,8 Kio pour 71 : afficher avant la base demandera d'en libérer.

## Règles

- Afficher l'instantané avant l'ouverture de la base, en lecture seule, la ferme étant vérifiée d'après la dernière ferme choisie (à mémoriser avec la session) ; boutons actifs dès la base prête.
- Les « Fait » tapés pendant une lecture ciblée sont masqués tout de suite et traités dans l'ordre, chacun avec sa vérification.

## Critères d'acceptation

- [ ] e2e grande ferme, CPU ×4 : Aujourd'hui à froid sous 600 ms en médiane de 5.
- [ ] Test : trois « Fait » tapés à la suite au lancement → trois réalisés, aucun perdu, aucun en double.
- [ ] JS de démarrage sous le budget, non relevé.

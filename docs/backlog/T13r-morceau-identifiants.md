# T13r — L'éditeur de placement ne charge plus la règle « déjà fait »

**Objectif** : rendre de la marge au budget de l'éditeur de placement (62 octets après T13n) sans relever aucun budget.

**Dépend de** : T13n
**Périmètre** : `apps/web/vite.config.ts` (`MORCEAU_IDENTIFIANTS`), `apps/web/scripts/**` (tests de découpage s'il y en a), `apps/web/budget.json` (seulement pour **baisser** un budget si la mesure le permet)

## Constat (relecture T13n)

Depuis T13i, `packages/sync/src/fait-unique.ts` est rangé de force dans le morceau partagé `identifiants`, avec le générateur d'UUID. L'éditeur de placement charge ce morceau pour le seul UUID et paie tout `fait-unique.ts` (SQL de `chaines`, clé d'horodatage de T13n). Il est à 22,1 Kio pour un budget de 22,1.

## Règles

- L'éditeur ne charge plus `fait-unique.ts` ; le démarrage reste à 71 Kio ou moins, sans nouveau nom de fichier dans la table des dépendances du démarrage si c'était la raison de T13i (sinon, chiffrer le compromis dans la PR).
- Aucun budget relevé.

## Critères d'acceptation

- [ ] Test (sur le build) : le morceau chargé par l'éditeur ne contient pas le SQL de `chaines`.
- [ ] `pnpm budget` : éditeur de placement mesuré au moins 0,5 Kio sous son budget ; démarrage et vue 3D inchangés ou plus bas.
- [ ] `pnpm verif` passe en entier.

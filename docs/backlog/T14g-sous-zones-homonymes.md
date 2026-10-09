# T14g — Import : sous-zones homonymes sous deux zones différentes

**Objectif** : qu'une ligne d'import ne se range jamais en silence dans la mauvaise sous-zone. Relecture de T14f (9 octobre) : dans le parcellaire, une ligne qui donne seulement le nom d'une sous-zone (« Chapelle A », sans sa zone parente), alors que ce nom existe sous deux zones (« Chapelle A » du Tunnel 1 et du Tunnel 2), tombe dans la première trouvée (`zonesParNom`, `apps/web/src/ecrans/import/construction.ts`). Défaut antérieur à T14f.

**Dépend de** : T14f (fait)
**Périmètre** : `apps/web/src/ecrans/import/construction.ts` et ses tests

## Règles

- Un nom de zone ou de sous-zone donné seul, qui désigne plusieurs zones de la ferme, refuse la ligne : « Zone ambiguë : « Chapelle A » existe dans Tunnel 1 et Tunnel 2. Ajoutez la zone parente. » Jamais de choix silencieux, même règle que « Code ambigu » (T14f).
- Un nom unique reste désigné comme aujourd'hui ; la zone parente + sous-zone donnée en entier aussi.
- Même normalisation des noms qu'aujourd'hui.

## Critères d'acceptation

- [ ] Test : « Chapelle A » sous Tunnel 1 et Tunnel 2, ligne « Chapelle A / – / P9 » → refusée, message qui nomme les deux parentes.
- [ ] Test : « Tunnel 2 / Chapelle A / P9 » → désignée dans Tunnel 2.
- [ ] Test : nom unique → désigné comme avant (les tests de T14f restent verts).
- [ ] `pnpm verif` passe en entier.

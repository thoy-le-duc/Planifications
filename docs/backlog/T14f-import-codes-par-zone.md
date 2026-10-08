# T14f — Import : codes de planche comparés par zone

**Objectif** : que l'import reconnaisse une planche par sa zone et son code, comme le serveur l'exige depuis T10t (Q27). Aujourd'hui l'import compare les codes sur toute la ferme : une « P3 » du Tunnel 2 est marquée doublon si une « P3 » existe dans le Tunnel 1, alors que les deux planches sont légitimes. Un fichier d'import doit pouvoir décrire toute la ferme sans fausse alerte.

**Dépend de** : T10t (fait : unicité du code par zone côté serveur, planches retirées ne réservant plus leur code)
**Périmètre** : `apps/web/src/ecrans/import/construction.ts`, `apps/web/src/ecrans/import/contexte-base.ts`, `packages/core/src/import/**` (et leurs tests)

## Règles

- **Clé d'une planche** : la zone et le code, comparés sans casse et sans espaces autour (même normalisation que T10t, côté cœur et côté import).
- **Planches retirées** : une planche dont `actif_au` est renseigné et passé ne compte plus pour la recherche du code, comme côté serveur depuis T10t (décision D). Une planche retirée ne rend pas un code ambigu ni doublon.
- **Sans zone dans le fichier** : si le code existe dans une seule zone de la ferme, il désigne cette planche. S'il existe dans plusieurs zones, l'import refuse la ligne en la nommant : « Code ambigu : « P3 » existe dans plusieurs zones. Ajoutez la zone. ». Jamais de choix silencieux.
- **Avec zone dans le fichier** : la planche est trouvée par zone + code. Un code absent de cette zone est une création si le fichier la prévoit, sinon une erreur qui nomme la zone.
- **Doublon** : seulement deux lignes du fichier qui désignent la même planche (même zone, même code, sans casse ni espaces).
- **Séries et assolements** : la planche désignée est celle de la zone + code, jamais « le premier code trouvé ».
- Messages en français, sans jargon.

## Critères d'acceptation

- [ ] Test : ferme avec « P3 » dans Tunnel 1 et « P3 » dans Tunnel 2 ; une ligne « P3 / Tunnel 2 » désigne la planche du Tunnel 2, sans doublon.
- [ ] Test : « p3 » et « P3 » (espaces autour) dans la même zone → doublon signalé dans le fichier.
- [ ] Test : code « P3 » sans zone, présent dans deux zones → ligne refusée, message « Code ambigu » qui nomme le code ; présent dans une seule zone → désigné.
- [ ] Test : planche retirée (`actif_au` passé) avec le code « P5 » et une nouvelle « P5 » dans la même zone → la nouvelle est désignée, sans ambiguïté.
- [ ] Test : zone + code absent de la zone et prévu par le fichier → création ; sinon erreur nommant la zone.
- [ ] Les tests existants de l'import (`modele.test.ts`, `normalisation.test.ts`, `parcours.test.tsx`, `relecture.test.tsx`) passent ; seules les assertions sur les codes ambigus sont mises à jour, avec justification dans la PR.
- [ ] `pnpm verif` passe en entier. Démarrage JS inchangé.

## Risques

- Le contexte de l'import doit connaître les zones et leurs planches : vérifier que `contexte-base.ts` les charge pour la ferme active, sans requête supplémentaire par ligne.
- Un fichier qui ne donne jamais la zone et dont les codes sont repris dans plusieurs zones : le refus est voulu, mais le message doit proposer d'ajouter la colonne zone.
- Relecture à faire sur un fichier réel de Théophane avant la fusion, si possible.

**Hors périmètre** : fusion automatique de deux planches, renommage de codes, import hors ligne d'un plan cadastral, changement du contrat serveur de T10t.

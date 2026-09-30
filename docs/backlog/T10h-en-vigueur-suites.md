# T10h — « En vigueur » : performance et alignement (suites de T10g)

**Objectif** : la règle « en vigueur » de toute la chaîne (T10g) reste rapide sur un gros journal et identique partout.

**Dépend de** : T10g
**Périmètre** : `packages/db` (vue `evenements_en_vigueur`, index), `apps/web/src/ecrans/aujourdhui/calculs.ts`

## Constats (relecture T10g)

- **Vue lente** : la récursion de 0018 part de toutes les origines de toutes les fermes ; un filtre par ferme ou par id ne descend pas. Mesure : 4,2 s pour `WHERE id = …`, 1,4 s pour une ferme vide, sur 200 000 événements. Piste : colonne `origine_id` indexée (remplie à l'écriture sous verrou), ou montée par événement.
- **Deux règles sur le téléphone** : `EN_VIGUEUR` (semainier) garde l'ancienne règle entre frères ; à aligner sans dépasser 300 ms.
- **Historique partiel** : si l'origine et une correction sont hors de la fenêtre de 7 jours, une récolte annulée peut rester affichée (cas rare, le serveur refuse ensuite).

## Critères d'acceptation

- [ ] Vue : moins de 50 ms pour une ferme sur un journal de 200 000 événements (test d'intégration mesuré).
- [ ] Téléphone : même valeur en vigueur que le serveur sur une chaîne ramifiée, dans le semainier comme dans l'historique.
- [ ] Historique partiel : la récolte annulée n'apparaît pas.

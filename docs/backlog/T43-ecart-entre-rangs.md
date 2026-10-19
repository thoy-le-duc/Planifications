# T43 — Écart entre rangs : une vraie donnée de l'itinéraire, visible partout

**Objectif** : retour de Théophane (2026-10-19) après la mise à jour de la bibliothèque : « il manque l'écartement entre rangs, une information importante ». T42 ne fait que **calculer** un écart approximatif depuis la largeur de planche, et seulement dans le formulaire : ce n'est pas ce qu'il attend. Au champ, on règle le semoir ou le traceur sur un écart entre rangs choisi (ex. carotte 15 cm, laitue 30 cm), pas sur une division de la planche.

**Dépend de** : T42, T41b (mise à jour de la bibliothèque par nouvelle migration), T35a (disposition des rangs)
**Périmètre** : `packages/core` (densité de l'itinéraire, validation, sans changer les besoins en semences), `packages/db/bibliotheque/depart.json` et nouvelle migration de bibliothèque, `apps/web/src/ecrans/itineraires/**` (liste, lecture, formulaire, schéma des rangs), `apps/web/src/ecrans/serie/**` si l'instantané l'affiche, `apps/api/src/sync/**` si la validation serveur rejoue la densité, tests, `docs/modele-donnees.md`
**Priorité** : haute (retour d'usage).

## Règle

1. **Nouvelle donnée facultative** `ecartEntreRangsCm` dans la densité à l'écartement et au mètre linéaire (clé du jsonb `parametres`, comme `disposition` en T35a : absente = ancien comportement, aucune ligne réécrite, aucune migration de schéma). Bornes : 5 à 200 cm ; rangs × écart ≤ largeur de planche + une marge raisonnable n'est **pas** bloquant (simple avertissement à l'écran).
2. **Affichage partout où l'on voit la densité** : résumé de la liste des itinéraires (ex. « 4 rangs à 15 cm · 2 cm sur le rang »), vue de lecture, formulaire (champ saisissable, en cm, gros et facile au doigt), schéma des rangs (T35a) qui l'utilise. Sans valeur : l'écart calculé de T42, marqué « ≈ ».
3. **Copie et série** : « Adapter pour ma ferme » et l'instantané d'une série la recopient.
4. **Bibliothèque** : écart entre rangs renseigné pour les 46 itinéraires (valeurs usuelles de sources publiques déjà citées ou nouvelles, jamais la Masterclass), par une nouvelle migration de bibliothèque (mécanique de T41b).
5. Le serveur accepte la clé (et la valide comme le cœur) ; un vieux téléphone qui ne la connaît pas ne casse rien.

## Critères d'acceptation

- [ ] Tests cœur : valeur valide acceptée, hors bornes refusée, absente acceptée ; besoins en semences inchangés.
- [ ] Test serveur : itinéraire avec la clé accepté, valeur hors bornes refusée avec message en français.
- [ ] Tests d'écran : la liste, la lecture et le formulaire montrent l'écart entre rangs ; saisie et enregistrement ; « ≈ » quand il manque.
- [ ] Test : copie « Adapter pour ma ferme » et série gardent la valeur.
- [ ] Test d'intégration : migration de bibliothèque rejouable, aucune ligne de ferme touchée ; les 46 itinéraires ont une valeur.
- [ ] Démarrage dans le budget ; `pnpm verif` passe.

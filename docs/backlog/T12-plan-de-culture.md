# T12 — Plan de culture : créer et modifier une série

**Objectif** : planifier une série en quelques gestes, en voyant tout de suite ses dates, les conflits de place et les alertes de rotation.

**Dépend de** : T04, T05, T10e (le serveur accepte les séries), T11
**Périmètre** : `apps/web/src/ecrans/serie/**`, `apps/web/e2e/serie.e2e.ts`, et (décision du chef) `apps/web/src/ecrans/plan/**` (appui long), `apps/web/src/App.tsx`, `apps/web/src/donnees/amorcer.ts` (jeu d'amorçage)

## Règles

- Formulaire : culture (recherche dans la bibliothèque de la ferme), itinéraire (proposé selon la culture et la période), ancre (semis, plantation ou « récolte à partir de la semaine… »), emplacements et longueur.
- Dès qu'un champ change : dates recalculées (T02), besoins (T05), conflits (T03) et alertes de rotation (T04) affichés, sans bouton « calculer ».
- Une alerte rouge n'empêche pas d'enregistrer, mais demande une confirmation explicite ; la décision est gardée dans l'historique.
- Modifier une série crée une ligne de MODIFICATION ; annulation possible depuis l'historique.
- Création rapide depuis la vue 2D : appui long sur une case vide pré-remplit emplacement et semaine.

## Décisions du chef (2026-09-30, après l'étude du testeur)

- **Prérequis serveur** : T10e ouvre `serie` et `occupation` au téléphone. L'historique (`modification`) est écrit par le serveur seul.
- **Annulation** (la voie la plus simple et la plus robuste) :
  - comme dans T13, un bandeau « Annuler » (10 s) défait la dernière action, même hors ligne ;
  - l'historique complet vient du serveur ; une fois synchronisée, chaque ligne s'annule depuis l'historique ;
  - annuler une modification = un PATCH qui rétablit les valeurs de `modification.avant` ;
  - annuler une création = une suppression douce de la série et de ses occupations ;
  - annuler une annulation = une nouvelle modification.
- **Alerte rouge acceptée** : gardée dans `serie.rotation_acceptee` (T10e), donc visible dans l'historique.
- **Plusieurs planches** : une occupation par planche, chacune avec sa longueur (par défaut la longueur de la planche).
- **Plantations pérennes** (relecture T10e) : le serveur refuse toute modification d'une occupation qui n'est pas celle d'une série (plantation, couverture). L'écran ne propose donc jamais de modifier ou de supprimer ces occupations ; elles s'affichent en lecture seule.
- **Instantané** (relecture T10e) : le serveur recalcule les dates à partir des paramètres envoyés. L'écran envoie donc l'instantané fidèle de l'itinéraire choisi, jamais des durées modifiées à la main.
- **Gestes pour la batavia** : appui long, taper « bat », choisir Batavia, garder l'itinéraire proposé, choisir « récolte à partir de », régler la semaine, Enregistrer. Soit 7 gestes au plus.

## Critères d'acceptation

- [ ] Test Playwright : créer la batavia de T02 en moins de 8 gestes depuis la vue 2D ; dates affichées conformes à T02.
- [ ] Test : placer des choux sur une planche de la chapelle C3 (jeu de test de T04) affiche l'alerte rouge et demande confirmation.
- [ ] Test : modifier puis annuler une série restaure l'état initial.
- [ ] Formulaire affiché en moins de 300 ms, recalcul en moins de 100 ms (CPU ralenti ×4).

**Hors périmètre** : création de cultures et d'itinéraires (l'import T14 les fournit), plantations pérennes (ticket suivant).

### Décisions du chef (après les tests)

Les interprétations du testeur sont retenues :

1. **Historique.** Une entrée par ligne `modification` de la série. Un changement qui ne touche que les occupations s'annule par le bandeau seulement.
2. **Annuler une entrée ancienne** ramène à l'état d'avant son horodatage, donc défait aussi les entrées plus récentes. L'écran le dit avant de le faire.
3. **`rotation_acceptee.delai_ans`** vaut le délai minimal de l'alerte.
4. **Changer d'ancre** garde les dates. L'ancre tombe toujours le lundi de la semaine.
5. **Libellés.** « Fermer » plutôt que « Annuler » ; « Planifier la série » en création, « Enregistrer » en modification.
6. **Bouton « Nouvelle série »** sur Planches, pour l'accessibilité et la mesure des 300 ms.
7. **Itinéraire** proposé une seule fois, au choix de la culture.
8. **Planches seulement** pour l'instant : sans gouttières, avec `position_m` nul. Sans variété, la germination est comptée à 100 %.
9. **Test de T11 modifié.** Le détail d'une barre de série porte « Modifier la série ». Justifié dans la PR.

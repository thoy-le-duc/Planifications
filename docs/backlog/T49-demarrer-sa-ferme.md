# T49 — Démarrer sa ferme sans import : saisons, zones et planches à la main, parcours guidé

**Objectif** : retour de Théophane (2026-10-19), première vraie mise en route : « je n'ai pas compris comment créer une saison ; dans Aujourd'hui je ne peux rien faire, dans Planches je ne peux rien faire ». Constat : **aucun écran ne crée une saison, une zone ou une planche** ; seul l'import CSV (T14) le fait. Une ferme neuve qui n'a pas de tableur reste bloquée : l'écran Planches dit « Aucune saison dans cette ferme pour l'instant », le formulaire de série dit « ajoute la saison d'abord », sans moyen de le faire. Principe 6 du projet : une ferme opérationnelle en moins d'une heure.

**Dépend de** : T11 (plan), T12 (série), T14 (import), T28 (placement), T39 (créer sa ferme)
**Périmètre** : `apps/web/src/ecrans/ferme/**` (nouvelle section « Ma ferme : saisons, zones, planches »), `apps/web/src/ecrans/plan/EcranPlan.tsx` et `apps/web/src/ecrans/aujourdhui/**` (états vides qui guident), `packages/sync` (écritures si une porte manque), `packages/core` (validations existantes réutilisées), `apps/api/src/sync/**` si une vérification manque, tests et e2e, `docs/mise-en-ligne.md` (étape « Démarrer sa ferme »)
**Priorité** : haute (bloque le premier usage réel).

## Règle

1. **Saisons** (onglet Ferme) : liste, « Nouvelle saison » (nom proposé « 2026 », du 1er janvier au 31 décembre par défaut, modifiable), modifier, supprimer (douce) si aucune série. Une ferme neuve sans saison se voit **proposer la saison de l'année en cours en un tap**.
2. **Zones** (onglet Ferme) : liste, « Nouvelle zone » (nom, type d'abri : plein champ, tunnel, serre, hors-sol ; zone parente facultative), modifier, supprimer (douce) si vide.
3. **Planches** d'une zone : « Ajouter des planches » en lot : nombre, préfixe de code (« P » → P1…Pn, codes uniques dans la zone, Q27), longueur et largeur (m) communes ; puis modification unitaire (code, longueur, largeur, sorte planche/rang/gouttière, mise hors service). Réutiliser les validations du cœur et les règles du serveur.
4. **Parcours guidé** quand la ferme est vide : un bandeau « Démarrer votre ferme » en 4 étapes cochées (1. saison, 2. zones et planches, 3. itinéraires, 4. première série), présent sur Aujourd'hui et Planches tant qu'il manque une étape ; chaque étape mène à l'écran qui la fait. L'import CSV y est proposé comme raccourci (« vous avez déjà un tableur ? »).
5. **États vides** : Planches sans saison ou sans planche, et Aujourd'hui sans série, disent quoi faire et y mènent (bouton), au lieu d'un texte passif.
6. Toutes les écritures : locales, synchronisées, annulables (bandeau « Annuler » comme ailleurs), droits de la ferme respectés (gérant / équipier selon les règles existantes), hors ligne compris. Saisie au doigt, grands boutons. Démarrage de l'appli inchangé (écrans chargés à la demande).

## Critères d'acceptation

- [ ] Tests : créer, modifier, supprimer une saison ; refus lisibles (dates incohérentes, nom vide).
- [ ] Tests : créer une zone, ajouter 10 planches « P » de 30 × 0,8 m en un geste (codes P1…P10), refus d'un code en double dans la zone.
- [ ] Tests : bandeau « Démarrer votre ferme » avec les étapes cochées selon l'état réel ; disparaît quand une série existe.
- [ ] Tests : états vides de Planches et Aujourd'hui avec leur bouton.
- [ ] e2e : ferme neuve → saison en un tap → zone + 10 planches → itinéraire de la bibliothèque → nouvelle série → elle apparaît dans Planches et ses travaux dans Aujourd'hui (si possible sur la pile de synchro, sinon base locale simulée).
- [ ] Budgets (démarrage, temps d'affichage) tenus ; `pnpm verif` passe.

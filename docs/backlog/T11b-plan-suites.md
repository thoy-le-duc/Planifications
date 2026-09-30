# T11b — Planches : suites de la relecture

**Objectif** : fermer les écarts non bloquants trouvés par la relecture de T11 (vue 2D et base locale).

**Dépend de** : T11
**Périmètre** : `apps/web/src/donnees/**`, `apps/web/src/ecrans/plan/**`, `apps/web/vite.config.ts`, `apps/web/e2e/**`

## Règles

- **Ouvrir la base plus tôt.** Aujourd'hui, un tap sur Planches dans la première seconde après l'ouverture de l'appli s'affiche en 0,7 à 0,8 s, parce que la base locale n'est prête qu'à environ 740 ms (CPU ×4). Les étapes s'enchaînent l'une après l'autre (`import(appli.ts)`, effacement en attente, `indexedDB.databases()`, `import(base-appli.ts)`, PowerSync, WASM). Il faut les lancer en parallèle dès la lecture de la session, et viser un premier tap sous 300 ms même base non prête (réponse de Théophane à Q19 attendue).
- **Pages de diagnostic hors production.** `/diagnostic/amorcer.html` (T11) et `synchro.html` (T10) ne peuvent ni lire ni effacer les données d'un vrai utilisateur. Elles embarquent pourtant du code de test dans `dist/`, et une visite dépose environ 42 000 lignes dans l'IndexedDB du visiteur. Elles doivent sortir du build de production (build dédié aux tests, ou entrée conditionnée à un mode).
- **Double téléchargement à la première visite.** PowerSync et le WASM sont peut-être chargés une fois par la page, puis une fois par le précache. À mesurer, et à éviter si c'est confirmé.
- **Libellé des barres coupé à gauche.** Quand une barre commence avant la zone visible, son libellé est coupé (« spèce 34… »). Il faut le rendre collant à gauche à l'intérieur de la barre.
- **Plus de deux sortes de conflit sur une planche.** L'étiquette déborde alors sur la ligne suivante. La rendre propre (par exemple « Chevauche +2 ») et ajouter un test.
- **Zones supprimées.** `lireStructure`, `lireDebutDePlan` et la structure réservée pendant le début ne filtrent pas `zone.supprime_le`. À trancher avec le modèle de données.
- **Écarts avec la maquette Plan.** Il manque les puces de zone, le surtitre « TUNNEL 2 · 6 PLANCHES · 30 M » et la carte d'alerte sous la légende.
- **Marge des temps.** « Planches » (jusqu'à 313 ms) et la pire image au défilement (50,1 ms) ont dépassé une fois sur sept environ sous charge. Il faut trouver ce qui coûte (profil sur CPU ×4) plutôt que relever les budgets.

- **Focus rendu à la fermeture.** Quand la feuille des conflits ou le détail d'une série se ferme, le focus revient à l'étiquette ou à la barre qui l'a ouverte (ou à la ligne, si la virtualisation l'a retirée du DOM).
- **Hauteur réservée testée.** Un test vérifie que la hauteur réservée pendant le début égale celle du plan complet (zone sans emplacement, emplacement inactif).

- **Morceau introuvable après une mise à jour** (relecture T20) : une page restée ouverte sur l'ancienne version peut demander un écran dont le fichier a disparu. Écouter `vite:preloadError` et recharger la page, sans perdre une saisie en cours.
- **Garde-fou en plus de la médiane** (relecture T20) : faire échouer une mesure si sa plus haute valeur dépasse 1,5 fois le budget.

## Critères d'acceptation

- [ ] Un test par règle retenue.
- [ ] `pnpm verif` vert, dix passages de `plan.e2e.ts` sans dépassement.

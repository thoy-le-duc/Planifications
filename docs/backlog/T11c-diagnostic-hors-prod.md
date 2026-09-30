# T11c — Pages de test hors du site en production

**Objectif** : le site mis en ligne ne contient que l'appli. Les pages de mesure et de diagnostic n'existent que dans le build des tests, pour qu'aucune page de test ne puisse écrire dans une vraie ferme ni remplir le téléphone d'un visiteur.

**Dépend de** : T11, T10c
**Périmètre** : `apps/web/vite.config.ts`, `apps/web/package.json`, `apps/web/playwright*.config.ts`, `scripts/e2e-synchro.ts`, `apps/web/budget.json` (lecture), les e2e qui ouvrent ces pages, `.github/workflows/ci.yml` si besoin

## Constat (relectures T11 et T10c)

- `/diagnostic/synchro.html` (T10, T10c) utilise la vraie session et la vraie API. Elle **écrit** des récoltes et du stock dans la ferme passée en paramètre, après validation de l'utilisateur.
- `/diagnostic/amorcer.html` (T11) dépose environ 42 000 lignes dans l'IndexedDB du visiteur.
- `/mesures/sqlite.html` (T07) embarque du code de mesure.
- Toutes les trois sont dans `dist/` aujourd'hui : hors précache et hors navigation, mais servies en production.

## Règles

- **Build de production** (`pnpm build`, celui qu'on met en ligne) :
  - aucune page `mesures/` ni `diagnostic/` ;
  - aucun morceau `assets/mesures/` ni `assets/diagnostic/` ;
  - aucun code de test (générateur du jeu T07, amorçage).
- **Build des essais**, séparé (par exemple `vite build --mode essais` dans `dist-essais/`) : il contient ces pages, et c'est lui que servent `pnpm e2e` et `pnpm e2e:synchro`.
- Les budgets (`pnpm budget`) et les mesures de démarrage portent sur l'appli, identique dans les deux builds. Une vérification le prouve : l'entrée principale est la même.
- La garde existante reste active dans le build des essais : les pages de test n'enregistrent jamais de service worker.
- La CI construit les deux builds. Le build de production est vérifié par un test qui échoue s'il contient une page ou un morceau de test.

## Critères d'acceptation

- [ ] Un test sur le build de production : aucune page ni aucun morceau `mesures`/`diagnostic`, aucune chaîne propre au code de test.
- [ ] `pnpm e2e` et `pnpm e2e:synchro` passent sur le build des essais.
- [ ] L'entrée de l'appli est identique (même empreinte) dans les deux builds.

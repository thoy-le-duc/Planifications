# T44 — Migrations de la base de production lancées automatiquement après chaque fusion

**Objectif** : demande de Théophane (2026-10-19) : ne plus avoir à ouvrir Codespaces pour lancer `pnpm --filter @planif/db migrer` après chaque fusion qui apporte une migration (T41, T42, T42b, T43…).

**Dépend de** : T38a, T38b (mise en ligne), T41b (migrations de bibliothèque)
**Périmètre** : `.github/workflows/` (nouveau workflow), `packages/db` si un mode « vérifier sans appliquer » manque, `docs/mise-en-ligne.md`, `docs/boucle.md` (procédure de fusion), tests
**Priorité** : haute.

## Règle

1. **Nouveau workflow GitHub Actions « Migrations de production »**, déclenché **uniquement** quand la CI de `main` se termine en succès (`workflow_run` sur le workflow CI, branche `main`, conclusion `success`), plus un déclenchement manuel (`workflow_dispatch`). Jamais sur une PR, jamais sur une autre branche, jamais depuis un fork.
2. Il lance `pnpm --filter @planif/db migrer` avec l'adresse **directe** de Neon lue dans un **secret GitHub** (`DATABASE_URL_PRODUCTION`) que Théophane pose lui-même. La loop n'a jamais la valeur ; elle n'apparaît jamais dans les journaux (pas d'`echo`, masquage GitHub).
3. **Secret absent** : le workflow se termine en succès avec un message clair (« secret DATABASE_URL_PRODUCTION absent : rien à faire, voir docs/mise-en-ligne.md »), sans faire échouer la CI ni envoyer d'alerte.
4. Un seul lancement à la fois (`concurrency`, sans annuler celui en cours). Permissions minimales (`contents: read`). Actions épinglées par version.
5. Échec d'une migration : le workflow est rouge, le message de `migrer` (sans l'adresse) est dans le journal ; rien d'autre n'est tenté.
6. **Doc** : `docs/mise-en-ligne.md` ajoute une étape courte « Poser le secret DATABASE_URL_PRODUCTION » (où cliquer dans GitHub, coller l'adresse **directe**, sans `-pooler`), et remplace « relancer migrer depuis Codespaces » par « automatique ; à la main seulement en secours ». `docs/boucle.md` : après une fusion qui apporte une migration, vérifier que le workflow est vert.

## Critères d'acceptation

- [ ] Test (lecture du YAML) : déclencheurs exacts (workflow_run CI sur main + succès, workflow_dispatch), aucun `pull_request`, permissions `contents: read`, concurrency, secret lu par `secrets.DATABASE_URL_PRODUCTION`, aucune commande qui affiche la variable.
- [ ] Test : sans secret, l'étape s'arrête proprement (script testé, ex. `scripts/migrer-production.sh` ou équivalent Node).
- [ ] Doc mise à jour ; `pnpm verif` passe.

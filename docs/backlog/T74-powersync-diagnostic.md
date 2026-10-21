# T74 — Lier l'instance PowerSync par cli.yaml, et diagnostiquer le jeton

**Objectif** : T73 passait `ORG_ID` et `PROJECT_ID` en variables d'environnement, ce qui n'a aucun effet : dans `@powersync/cli-core@0.10.2` (`dist/command-types/CloudInstanceCommand.js`, `loadProject`), `org_id` et `project_id` ne sont lus que dans le `cli.yaml` du dossier de projet (seul `instance_id` accepte un drapeau ou `INSTANCE_ID`). En production, « Instance … was not found or is not accessible with the current token » revient donc toujours. Le jeton est probablement en cause, mais rien ne le prouve : le script doit le démontrer.

**Dépend de** : T67, T73
**Périmètre** : `scripts/deployer-regles-powersync.sh`, `docs/mise-en-ligne.md` (étape 3 bis et dépannage), `packages/db/src/regles-powersync-production.test.ts`
**Priorité** : haute. **Modèle** : Opus (déploiement).

## Règles

1. **Liaison par cli.yaml.** Organisation et projet fournis : le script copie `powersync/` dans un dossier temporaire (`mktemp -d`, supprimé par `trap`), y écrit un `cli.yaml` (`type: cloud`, `instance_id`, `org_id`, `project_id`, schéma `ResolvedCloudCLIConfig` de `@powersync/cli-schemas`) et lance la CLI avec `--directory` sur ce dossier. Le jeton n'y figure jamais. `powersync/` du dépôt n'est jamais modifié. Organisation et projet absents : comportement de T67 (dossier du dépôt, sans cli.yaml).
2. **Diagnostic si la CLI échoue**, sans jamais afficher le jeton : `powersync fetch instances --output json` (qui avale ses erreurs et sort 0 : on lit son avertissement « Failed to fetch cloud instances » et sa sortie JSON). Le script indique si le jeton est reconnu, le nombre d'instances visibles et leurs identifiants (organisation, projet, instance), et si l'instance attendue en fait partie.
   - `fetch instances` échoue : « jeton refusé : recréez-le ».
   - L'instance attendue n'est pas visible : « le jeton ne voit pas cette instance : recréez-le en étant connecté au compte et à l'organisation de l'instance ».
   - Visible : le jeton n'est pas en cause, relire les identifiants et le message de la CLI.
3. Guide : étape 3 bis et dépannage corrigés (les variables servent à écrire cli.yaml, pas à des variables d'environnement de la CLI).

## Critères d'acceptation

- [ ] Tests avec le faux pnpm : cli.yaml écrit (contenu exact, sans jeton), dossier temporaire supprimé, `powersync/` intact, comportement inchangé sans org/projet.
- [ ] Tests du diagnostic : jeton refusé, instance absente de la liste, instance présente, liste vide, aucune fuite du jeton.
- [ ] Guide à jour ; typage, lint et tests du paquet db verts ; `bash -n` sur le script.

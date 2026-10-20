# T67 — Déployer les règles de synchro PowerSync automatiquement

**Objectif** : depuis T44, les migrations s'appliquent seules après chaque fusion dans `main`. Mais les **règles de synchro** (`powersync/sync-config.yaml`) se déploient encore à la main, par copier-coller dans le tableau de bord PowerSync (guide, étape 3). Le 20/10, T60 et T54 les ont modifiées : sans le redéploiement manuel de Théophane, l'équipe et les produits fertilisants ne descendaient sur aucun téléphone, sans erreur visible. Il faut que ce soit automatique, et que l'oubli soit impossible.

**Dépend de** : T44 (migrations automatiques), T45 (CI)
**Périmètre** : `.github/workflows/**`, `scripts/**`, `powersync/**`, `docs/mise-en-ligne.md`, tests du dépôt sur les workflows
**Priorité** : haute (chaque ticket qui touche la synchro en dépend). **Modèle** : Opus (sécurité, déploiement).

## Règles

1. Trouver la voie **officielle** de PowerSync Cloud pour déployer des règles sans le tableau de bord (CLI ou API d'administration, jeton d'accès personnel) ; la documenter avec sa source. Si aucune voie officielle n'existe, s'arrêter et l'écrire dans `docs/questions.md`.
2. Workflow sur le modèle de T44 : après « Migrations de production » réussi sur `main` (les règles peuvent viser une table créée par la migration), dans l'environnement GitHub `production` limité à `main`. Validation des règles d'abord, déploiement ensuite ; échec visible (workflow rouge) si les règles sont refusées.
3. Secrets : jeton PowerSync et identifiants d'instance **uniquement** dans l'environnement `production`, posés par Théophane (jamais dans le dépôt ni dans une conversation). Sans secret : arrêt propre, en vert, avec un message clair (comme T44).
4. Garde-fou en CI : un test vérifie que toute table publiée par une migration (publication `powersync`) a bien son flux dans `sync-config.yaml`, et inversement.
5. Guide `docs/mise-en-ligne.md` : étape « 3 bis » pour créer le jeton et poser les secrets, pas à pas, comme l'étape 2 bis.

## Critères d'acceptation

- [ ] Workflow testé (script validé sans secret : sortie propre ; avec secret factice : refus clair).
- [ ] Test « publication ↔ flux » vert, et rouge si l'on retire un flux.
- [ ] Guide à jour ; `pnpm verif` passe.

## Voie retenue (recherche du 2026-10-20)

- **CLI officielle PowerSync**, paquet npm `powersync` (dépôt https://github.com/powersync-ja/powersync-cli), épinglée en **0.10.2** (publiée le 2026-10-01). Documentation : https://docs.powersync.com/tools/cli.
- Commande `powersync deploy sync-config --directory=powersync` : « [Cloud only] Deploy only local sync config to the linked Cloud instance » ; `--dry-run` valide sans déployer. Elle garde la configuration de l'instance (connexion, authentification) déjà déployée par le tableau de bord.
- Authentification en CI : jeton d'accès personnel dans `PS_ADMIN_TOKEN` (créé sur https://dashboard.powersync.com/account/access-tokens) et instance dans `INSTANCE_ID` (BSON ObjectID, 24 caractères hexadécimaux) ; organisation et projet déduits de l'instance (`--org-id` et `--project-id` sont dépréciés en 0.10.2). Vérifié dans le code publié de `powersync@0.10.2` et `@powersync/cli-core@0.10.2` (`utils/env.js`, `CloudInstanceCommand.js`, `commands/deploy/sync-config.js`).
- Secrets GitHub (environnement `production`) : `POWERSYNC_ADMIN_TOKEN` et `POWERSYNC_INSTANCE_ID`, passés à la CLI par `scripts/deployer-regles-powersync.sh`.

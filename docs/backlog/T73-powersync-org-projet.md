# T73 — Donner l'organisation et le projet PowerSync à la CLI

**Objectif** : au premier essai réel de T67, la CLI a répondu « Instance *** was not found or is not accessible with the current token. ». Sans `ORG_ID` ni `PROJECT_ID`, `powersync@0.10.2` appelle `getInstance` pour les déduire et remplace tout échec par ce message (`resolve-cloud-instance-link.js`) ; si les deux sont fournis, elle saute cet appel. Le script doit les transmettre, et le diagnostic doit nommer les vraies causes probables.

**Dépend de** : T67
**Périmètre** : `scripts/deployer-regles-powersync.sh`, `.github/workflows/regles-powersync.yml`, `docs/mise-en-ligne.md` (étape 3 bis), `packages/db/src/regles-powersync-production.test.ts`
**Priorité** : haute (le déploiement automatique des règles ne marche pas sans). **Modèle** : Opus (déploiement).

## Règles

1. Source : variables d'environnement GitHub `vars.POWERSYNC_ORG_ID` et `vars.POWERSYNC_PROJECT_ID` dans l'environnement `production` (pas des secrets : ce ne sont pas des données sensibles). Le workflow les passe au script dans les deux étapes.
2. Le script retire toujours `ORG_ID` et `PROJECT_ID` hérités de l'extérieur, puis ne pose que les valeurs lues de `POWERSYNC_ORG_ID` et `POWERSYNC_PROJECT_ID`.
3. Les deux fournis et bien formés (24 caractères hexadécimaux) : transmis à la CLI. Un seul des deux : refus qui nomme celui qui manque. Valeur mal formée : refus clair. Aucun des deux : comportement actuel (la CLI déduit).
4. Si la CLI échoue, le message rappelle les causes probables : jeton créé sous une autre organisation, jeton révoqué ou expiré, identifiants d'organisation, de projet ou d'instance erronés. Jamais le jeton.
5. Guide, étape 3 bis : ajouter les deux variables et expliquer où les lire dans l'adresse du tableau de bord (`/org/<ORG>/project/<PROJET>/<INSTANCE>/`).

## Critères d'acceptation

- [ ] Tests du script avec le faux pnpm : transmission des deux identifiants, refus d'une valeur mal formée, refus d'un seul des deux, comportement inchangé sans eux, aucune reprise d'un `ORG_ID` ou `PROJECT_ID` déjà posés.
- [ ] Workflow : `vars.POWERSYNC_ORG_ID` et `vars.POWERSYNC_PROJECT_ID` dans les deux étapes, aucun nouveau secret.
- [ ] Guide à jour ; typage, lint et tests du paquet db verts.

#!/usr/bin/env bash
# T67 : règles de synchro (powersync/sync-config.yaml) déployées sur PowerSync Cloud par
# .github/workflows/regles-powersync.yml, après chaque « Migrations de production » réussi sur main
# (les règles peuvent viser une table que la migration vient de créer), ou à la main en secours.
#
#   bash scripts/deployer-regles-powersync.sh valider    # validation seule (--dry-run)
#   bash scripts/deployer-regles-powersync.sh deployer   # déploiement (la CLI revalide avant)
#
# Voie officielle : la CLI PowerSync (paquet npm `powersync`, https://docs.powersync.com/tools/cli,
# https://github.com/powersync-ja/powersync-cli), commande `deploy sync-config`, qui ne touche
# qu'aux règles et garde la connexion à Neon et l'authentification réglées dans le tableau de bord.
# Elle lit le jeton personnel dans PS_ADMIN_TOKEN et l'instance dans INSTANCE_ID. Sans ORG_ID ni
# PROJECT_ID, elle les déduit de l'instance par un appel d'API dont tout échec devient « Instance
# … was not found or is not accessible with the current token » (T73) : on les lui donne donc.
#
# - Secrets POWERSYNC_ADMIN_TOKEN et POWERSYNC_INSTANCE_ID absents ou vides : rien à faire, succès.
#   Jamais de repli sur PS_ADMIN_TOKEN ou INSTANCE_ID déjà posés ailleurs.
# - Un seul des deux, ou une valeur mal formée : refus, sans afficher la valeur.
# - T73 : variables (non secrètes) POWERSYNC_ORG_ID et POWERSYNC_PROJECT_ID de l'environnement
#   production, transmises à la CLI comme ORG_ID et PROJECT_ID. Les deux ou aucune : un seul, ou une
#   valeur mal formée (24 caractères hexadécimaux), est refusé. Aucune : la CLI déduit, comme avant.
#   Jamais de reprise d'un ORG_ID ou PROJECT_ID déjà posés ailleurs.
# - Règles refusées par PowerSync : sortie non nulle, le workflow passe au rouge.
#
# La CLI est figée dans scripts/powersync-cli/ : version exacte en devDependency et pnpm-lock.yaml
# (dépendances transitives et empreintes comprises), hors de l'espace de travail pnpm. Le workflow
# l'installe avant, sans secret : `pnpm --dir scripts/powersync-cli install --frozen-lockfile
# --ignore-workspace --ignore-scripts`. Pour changer de version : modifier package.json, lancer
# `pnpm install --ignore-workspace` dans ce dossier, et le justifier dans la PR (et dans le guide).
#
# Ce script n'affiche jamais les secrets : pas d'écho des variables, pas de traçage du shell.
set -euo pipefail
set +x

cd "$(dirname "$0")/.."
racine="$(pwd)"

mode="${1:-}"
case "$mode" in
  valider) options=(--dry-run) ;;
  deployer) options=() ;;
  *)
    echo "usage : bash scripts/deployer-regles-powersync.sh valider|deployer" >&2
    exit 2
    ;;
esac

# Jamais lues par la CLI depuis l'extérieur de ce script : ni jeton ou instance posés ailleurs, ni
# contexte auto-hébergé (API_URL), ni identifiants d'organisation ou de projet hérités.
unset PS_ADMIN_TOKEN INSTANCE_ID API_URL ORG_ID PROJECT_ID

jeton="${POWERSYNC_ADMIN_TOKEN:-}"
instance="${POWERSYNC_INSTANCE_ID:-}"
organisation="${POWERSYNC_ORG_ID:-}"
projet="${POWERSYNC_PROJECT_ID:-}"
# Les valeurs ne passent plus que par les variables locales ci-dessus, puis à la seule CLI.
unset POWERSYNC_ADMIN_TOKEN POWERSYNC_INSTANCE_ID POWERSYNC_ORG_ID POWERSYNC_PROJECT_ID

if [ -z "$jeton" ] && [ -z "$instance" ]; then
  echo "secrets POWERSYNC_ADMIN_TOKEN et POWERSYNC_INSTANCE_ID absents : rien à faire, voir docs/mise-en-ligne.md (étape 3 bis)"
  exit 0
fi
if [ -z "$instance" ]; then
  echo "secret POWERSYNC_INSTANCE_ID absent (POWERSYNC_ADMIN_TOKEN est posé) : poser les deux, voir docs/mise-en-ligne.md (étape 3 bis)" >&2
  exit 1
fi
if [ -z "$jeton" ]; then
  echo "secret POWERSYNC_ADMIN_TOKEN absent (POWERSYNC_INSTANCE_ID est posé) : poser les deux, voir docs/mise-en-ligne.md (étape 3 bis)" >&2
  exit 1
fi

# Identifiant d'instance : un BSON ObjectID, 24 caractères hexadécimaux (ce que la CLI exige).
instance_bien_formee() {
  local LC_ALL=C
  [[ $instance =~ ^[0-9a-fA-F]{24}$ ]]
}
# Jeton : une seule ligne de caractères ASCII imprimables, sans blanc (un copier-coller qui
# emporte une espace ou un retour à la ligne est refusé ici plutôt que par l'API).
jeton_bien_forme() {
  local LC_ALL=C
  [[ $jeton =~ ^[!-~]+$ ]]
}

if ! instance_bien_formee; then
  echo "secret POWERSYNC_INSTANCE_ID mal formé : 24 caractères hexadécimaux attendus (l'identifiant de l'instance, sans espace ni retour à la ligne), voir docs/mise-en-ligne.md (étape 3 bis)" >&2
  exit 1
fi
if ! jeton_bien_forme; then
  echo "secret POWERSYNC_ADMIN_TOKEN mal formé : une seule ligne sans espace attendue (le jeton copié depuis PowerSync), voir docs/mise-en-ligne.md (étape 3 bis)" >&2
  exit 1
fi

# T73 : organisation et projet, les deux ou aucun (identifiants d'un tableau de bord, non secrets).
if [ -n "$organisation" ] && [ -z "$projet" ]; then
  echo "variable POWERSYNC_PROJECT_ID absente (POWERSYNC_ORG_ID est posée) : poser les deux ou aucune, voir docs/mise-en-ligne.md (étape 3 bis)" >&2
  exit 1
fi
if [ -z "$organisation" ] && [ -n "$projet" ]; then
  echo "variable POWERSYNC_ORG_ID absente (POWERSYNC_PROJECT_ID est posée) : poser les deux ou aucune, voir docs/mise-en-ligne.md (étape 3 bis)" >&2
  exit 1
fi
identifiant_bien_forme() {
  local LC_ALL=C
  [[ $1 =~ ^[0-9a-fA-F]{24}$ ]]
}
if [ -n "$organisation" ] && ! identifiant_bien_forme "$organisation"; then
  echo "variable POWERSYNC_ORG_ID mal formée : 24 caractères hexadécimaux attendus (l'organisation, lue dans l'adresse du tableau de bord PowerSync), voir docs/mise-en-ligne.md (étape 3 bis)" >&2
  exit 1
fi
if [ -n "$projet" ] && ! identifiant_bien_forme "$projet"; then
  echo "variable POWERSYNC_PROJECT_ID mal formée : 24 caractères hexadécimaux attendus (le projet, lu dans l'adresse du tableau de bord PowerSync), voir docs/mise-en-ligne.md (étape 3 bis)" >&2
  exit 1
fi

if [ "$mode" = valider ]; then
  echo "Règles de synchro : validation par la CLI PowerSync figée (deploy sync-config --dry-run), rien n'est déployé."
else
  echo "Règles de synchro : déploiement par la CLI PowerSync figée (deploy sync-config)."
fi

# `pnpm --dir … exec` lance la commande depuis scripts/powersync-cli : le dossier des règles est
# donc donné en chemin absolu.
# Avec l'organisation et le projet, la CLI saute l'appel qui les déduit de l'instance.
export PS_ADMIN_TOKEN="$jeton" INSTANCE_ID="$instance"
if [ -n "$organisation" ]; then
  export ORG_ID="$organisation" PROJECT_ID="$projet"
fi
if ! pnpm --dir scripts/powersync-cli exec powersync deploy sync-config --directory="$racine/powersync" "${options[@]}"; then
  {
    echo "La CLI PowerSync a échoué : voir son message juste au-dessus. Causes probables :"
    echo "  - règles refusées par PowerSync (rien n'est déployé) ;"
    echo "  - « Instance … was not found or is not accessible with the current token » : jeton créé sous une autre organisation que celle de l'instance, jeton révoqué ou expiré ;"
    echo "  - identifiants erronés : POWERSYNC_INSTANCE_ID (secret), POWERSYNC_ORG_ID et POWERSYNC_PROJECT_ID (variables), à relire dans l'adresse du tableau de bord ;"
    echo "  - PowerSync injoignable."
    echo "Voir docs/mise-en-ligne.md (étape 3 bis)."
  } >&2
  exit 1
fi

if [ "$mode" = valider ]; then
  echo "Règles de synchro valides."
else
  echo "Règles de synchro déployées."
fi

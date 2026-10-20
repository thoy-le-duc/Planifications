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
# Elle lit le jeton personnel dans PS_ADMIN_TOKEN et l'instance dans INSTANCE_ID ; l'organisation
# et le projet se déduisent de l'instance.
#
# - Secrets POWERSYNC_ADMIN_TOKEN et POWERSYNC_INSTANCE_ID absents ou vides : rien à faire, succès.
#   Jamais de repli sur PS_ADMIN_TOKEN ou INSTANCE_ID déjà posés ailleurs.
# - Un seul des deux, ou une valeur mal formée : refus, sans afficher la valeur.
# - Règles refusées par PowerSync : sortie non nulle, le workflow passe au rouge.
#
# Ce script n'affiche jamais les secrets : pas d'écho des variables, pas de traçage du shell.
set -euo pipefail
set +x

# Version exacte de la CLI, jamais `latest` : la relever se justifie dans la PR (et dans le guide).
CLI_POWERSYNC='powersync@0.10.2'

cd "$(dirname "$0")/.."

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

if [ "$mode" = valider ]; then
  echo "Règles de synchro : validation par $CLI_POWERSYNC (deploy sync-config --dry-run), rien n'est déployé."
else
  echo "Règles de synchro : déploiement par $CLI_POWERSYNC (deploy sync-config)."
fi

if ! PS_ADMIN_TOKEN="$jeton" INSTANCE_ID="$instance" \
  pnpm dlx "$CLI_POWERSYNC" deploy sync-config --directory=powersync "${options[@]}"; then
  echo "Règles de synchro refusées par PowerSync, ou PowerSync injoignable : voir le message de la CLI juste au-dessus." >&2
  exit 1
fi

if [ "$mode" = valider ]; then
  echo "Règles de synchro valides."
else
  echo "Règles de synchro déployées."
fi

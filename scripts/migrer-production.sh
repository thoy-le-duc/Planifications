#!/usr/bin/env bash
# T44 : migrations de la base de production, lancées par .github/workflows/migrations-production.yml
# après chaque CI verte de main (ou à la main, en secours).
#
# - Secret DATABASE_URL_PRODUCTION absent ou vide : rien à faire, sortie en succès.
#   On ne se rabat jamais sur DATABASE_URL (en CI, c'est la base jetable des tests).
# - Sinon : pnpm --filter @planif/db migrer sur cette adresse. Un échec sort en non-zéro avec le
#   message de migrer, qui ne contient pas l'adresse (GitHub masque en plus la valeur du secret).
#
# Ce script n'affiche jamais l'adresse : pas d'écho de la variable, pas de traçage du shell.
set -euo pipefail
set +x

cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL_PRODUCTION:-}" ]; then
  echo "secret DATABASE_URL_PRODUCTION absent : rien à faire, voir docs/mise-en-ligne.md"
  exit 0
fi

echo "Migrations de production : lancement de pnpm --filter @planif/db migrer."
DATABASE_URL="$DATABASE_URL_PRODUCTION" pnpm --filter @planif/db migrer

#!/bin/bash
# Prépare une session Claude Code on the web : dépendances du monorepo
# et Chromium préinstallé pour les tests Playwright.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
fi

# Pas de téléchargement de navigateur : Chromium est déjà dans l'image.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
pnpm install --frozen-lockfile --prefer-offline

if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export CHROMIUM_PATH=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCTIONS_DIR="$ROOT_DIR/firebase/kangsain-functions/functions"

if command -v npm >/dev/null 2>&1; then
  NPM_CMD=(npm)
elif [[ -x "$FUNCTIONS_DIR/node_modules/npm/bin/npm-cli.js" ]]; then
  NODE_BIN="${NODE_BIN:-node}"
  NPM_CMD=("$NODE_BIN" "$FUNCTIONS_DIR/node_modules/npm/bin/npm-cli.js")
else
  echo "npm is required for the first bootstrap on this machine." >&2
  echo "Install Node.js/npm, then run this script again." >&2
  exit 1
fi

cd "$FUNCTIONS_DIR"
"${NPM_CMD[@]}" install
"${NPM_CMD[@]}" run typecheck
"${NPM_CMD[@]}" run build
echo "KangsaIN Firebase tools are ready."
